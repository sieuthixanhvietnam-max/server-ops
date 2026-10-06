from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.ops import ssh_ops

# Incident response for the wp2shell backdoor (CVE-2026-63030 / CVE-2026-60137):
# the exploit itself is a WordPress CORE bug (patched via plugin_update's
# `wp core update`, nothing to do with this file) that plants a persistent
# administrator account as its backdoor. Covers 2 tiers, tagged separately
# in the output so the audit trail says which signature matched:
#   - "chac_chan" (certain): username `w2s_<hex>` or email ending
#     `@wp2shell.local` - the tool's own published signature.
#   - "nghi_van" (suspect): bare 12-20 char lowercase-hex username with no
#     w2s_/wp2shell.local marker. Same tool with the signature dropped,
#     most likely (same sites, timestamps right after the "chắc chắn"
#     wave, same random-hex-local-part @gmail.com email style - see the
#     session's 2026-10-06 investigation) - but less certain, hence the
#     separate tag.
#
# Re-checks live via wp-cli at execution time rather than trusting a
# point-in-time scan - safe to re-run on an already-cleaned domain (matches
# nothing, no-op) and immune to any domain's state having changed since an
# earlier audit.
BACKDOOR_SCRIPT = """#!/bin/bash
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

wp user list --role=administrator --path="$PATH_WP" --allow-root --fields=ID,user_login,user_email --format=csv 2>/dev/null | tail -n +2 | while IFS=, read -r id login email; do
    reason=""
    if [[ "$login" =~ ^w2s_[0-9a-f]+$ ]] || [[ "$email" == *"@wp2shell.local" ]]; then
        reason="chac_chan"
    elif [[ "$login" =~ ^[0-9a-f]{12,20}$ ]]; then
        reason="nghi_van"
    fi
    if [[ -n "$reason" ]]; then
        post_count=$(wp post list --author="$id" --post_status=any --format=count --path="$PATH_WP" --allow-root 2>/dev/null)
        if [[ -z "$post_count" ]]; then post_count=0; fi
        if [[ "$post_count" -gt 0 ]]; then
            echo "SKIP|$login|$email|$reason|$post_count bai viet - can xem tay"
        elif wp user delete "$id" --yes --path="$PATH_WP" --allow-root >/dev/null 2>&1; then
            echo "DELETED|$login|$email|$reason|"
        else
            echo "FAIL|$login|$email|$reason|xoa khong thanh cong"
        fi
    fi
done
"""

# wp-cli bootstraps all of WP core + active plugins per invocation (not a
# cheap SQL query) - same reasoning/cap as wp_user_ops.USERS_PER_SERVER_WORKERS.
BACKDOOR_PER_SERVER_WORKERS = 5


def remove_backdoor_users(
    entries: list[dict], log, on_start=None, on_finish=None,
    workers_per_server: int = BACKDOOR_PER_SERVER_WORKERS,
) -> list[dict]:
    """entries: [{"domain", "ip", "profile", "server_name"}]. Returns, per
    entry: {"domain", "server_name", "ip", "status", "deleted": [...],
    "skipped": [...], "note"} - deleted/skipped are lists of
    {"username", "email", "reason", "note"} ("reason" is "chac_chan" or
    "nghi_van", see BACKDOOR_SCRIPT's header comment)."""
    results: list[dict | None] = [None] * len(entries)

    def _one(idx: int, e: dict) -> None:
        domain, ip, profile = e["domain"], e["ip"], e["profile"]
        label = f"{domain} ({ip})"
        if on_start:
            on_start(domain)

        def _finish(status: str, note: str, deleted=None, skipped=None) -> None:
            results[idx] = {
                "domain": domain, "server_name": e["server_name"], "ip": ip,
                "status": status, "deleted": deleted or [], "skipped": skipped or [], "note": note,
            }
            if on_finish:
                on_finish(domain, "success" if status != "FAIL" else "failed", note)

        user, key, err = ssh_ops.establish_connection(ip, profile)
        if not user:
            log(f"[fail] {label}: {err}")
            _finish("FAIL", err or "không kết nối được SSH")
            return

        try:
            rc, output = ssh_ops.run_remote(ip, user, key, BACKDOOR_SCRIPT, args=[domain], timeout=60)
        except Exception as exc:
            log(f"[fail] {label}: unexpected error: {exc}")
            _finish("FAIL", f"unexpected error: {exc}")
            return

        if output.startswith("ERR|"):
            _, _, note = output.strip().splitlines()[0].split("|", 2)
            log(f"[fail] {label}: {note}")
            _finish("FAIL", note)
            return
        if rc != 0:
            note = output.strip()[:160] or f"exit {rc}"
            log(f"[fail] {label}: {note}")
            _finish("FAIL", note)
            return

        deleted, skipped = [], []
        for line in output.strip().splitlines():
            parts = line.split("|")
            if len(parts) < 4:
                continue
            kind, login, email, reason = parts[0], parts[1], parts[2], parts[3]
            note = parts[4] if len(parts) > 4 else ""
            if kind == "DELETED":
                deleted.append({"username": login, "email": email, "reason": reason, "note": note})
            elif kind == "SKIP":
                skipped.append({"username": login, "email": email, "reason": reason, "note": note})
            elif kind == "FAIL":
                skipped.append({"username": login, "email": email, "reason": reason, "note": note or "xoá thất bại"})

        if deleted or skipped:
            log(f"[ ok ] {label}: xoá {len(deleted)}, bỏ qua {len(skipped)}")
        _finish("OK", "", deleted, skipped)

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
