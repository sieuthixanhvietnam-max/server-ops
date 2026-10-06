from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.ops import ssh_ops

# Same wp() wrapper (source php-cli-domain-config, run as the vhost's own
# system user under its pinned PHP_BINARY) as wp_plugin_ops.CHECK_SCRIPT and
# wp_template_ops.INFO_SCRIPT - see wp_plugin_ops's 2026-08-20 note for why
# this is required instead of WP_CLI_PHP.
USERNAMES_SCRIPT = """#!/bin/bash
DOMAIN="$1"
if [[ ! -f "/etc/wptt/vhost/.$DOMAIN.conf" ]]; then
    echo "ERR|not_found|domain not found on server"
    exit 10
fi
PATH_WP="/usr/local/lsws/$DOMAIN/html"
[[ -f /etc/wptt/php/php-cli-domain-config ]] && \\
    . /etc/wptt/php/php-cli-domain-config "$DOMAIN" 2>/dev/null || true
WP_REAL_BIN=$(command -v wp)
wp() {
    if [[ -n "${User_name_vhost:-}" ]]; then
        if [[ -n "${PHP_BINARY:-}" && -f "$PHP_BINARY" ]]; then
            runuser -u "$User_name_vhost" -- "$PHP_BINARY" "$WP_REAL_BIN" "$@"
        else
            runuser -u "$User_name_vhost" -- "$WP_REAL_BIN" "$@"
        fi
    elif [[ -n "${PHP_BINARY:-}" && -f "$PHP_BINARY" ]]; then
        "$PHP_BINARY" "$WP_REAL_BIN" "$@"
    else
        "$WP_REAL_BIN" "$@"
    fi
}
if ! command -v wp &>/dev/null; then
    echo "ERR|no_wpcli|wp-cli missing"
    exit 11
fi
if [[ ! -f "$PATH_WP/wp-load.php" ]]; then
    echo "ERR|not_wp|not a WordPress site"
    exit 12
fi
wp user list --role=administrator --path="$PATH_WP" --allow-root --field=user_login 2>/dev/null
"""

# Read-only (wp user list), but a wp-cli call still bootstraps the full WP
# core + active plugins just to answer it - not free the way a plain SQL
# query would be. Capped per-server (not globally) so the server with the
# most domains (~120) doesn't get ~120 simultaneous WP bootstraps at once;
# different servers have no shared bottleneck and run fully in parallel,
# same reasoning as wp_ops.clone_wpsite's per-IP grouping.
USERS_PER_SERVER_WORKERS = 5


def get_admin_usernames(
    entries: list[dict], log, on_start=None, on_finish=None,
    workers_per_server: int = USERS_PER_SERVER_WORKERS,
) -> list[dict]:
    """entries: [{"domain", "ip", "profile", "server_name"}]. Returns, per
    entry: {"domain", "server_name", "ip", "status", "usernames": [...],
    "note"} - usernames is every WP user with the administrator role,
    empty if the site has none (or on any failure)."""
    results: list[dict | None] = [None] * len(entries)

    def _one(idx: int, e: dict) -> None:
        domain, ip, profile = e["domain"], e["ip"], e["profile"]
        label = f"{domain} ({ip})"
        if on_start:
            on_start(domain)

        def _fail(note: str) -> None:
            log(f"[fail] {label}: {note}")
            results[idx] = {"domain": domain, "server_name": e["server_name"], "ip": ip,
                              "status": "FAIL", "usernames": [], "note": note}
            if on_finish:
                on_finish(domain, "failed", note)

        user, key, err = ssh_ops.establish_connection(ip, profile)
        if not user:
            _fail(err or "không kết nối được SSH")
            return

        try:
            rc, output = ssh_ops.run_remote(ip, user, key, USERNAMES_SCRIPT, args=[domain], timeout=30)
        except Exception as exc:
            _fail(f"unexpected error: {exc}")
            return

        if output.startswith("ERR|"):
            _, _, note = output.strip().splitlines()[0].split("|", 2)
            _fail(note)
            return
        if rc != 0:
            _fail(output.strip()[:160] or f"exit {rc}")
            return

        usernames = [line.strip() for line in output.strip().splitlines() if line.strip()]
        note = "" if usernames else "không có user admin"
        log(f"[ ok ] {label}: {len(usernames)} admin")
        results[idx] = {"domain": domain, "server_name": e["server_name"], "ip": ip,
                          "status": "OK", "usernames": usernames, "note": note}
        if on_finish:
            on_finish(domain, "success", note)

    groups: dict[str, list[tuple[int, dict]]] = defaultdict(list)
    for idx, e in enumerate(entries):
        groups[e["ip"]].append((idx, e))

    def _run_group(group: list[tuple[int, dict]]) -> None:
        with ThreadPoolExecutor(max_workers=workers_per_server) as pool:
            futures = [pool.submit(_one, idx, e) for idx, e in group]
            for future in as_completed(futures):
                future.result()

    with ThreadPoolExecutor(max_workers=max(1, len(groups))) as pool:
        futures = [pool.submit(_run_group, group) for group in groups.values()]
        for future in as_completed(futures):
            future.result()

    return results
