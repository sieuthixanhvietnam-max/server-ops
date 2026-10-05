from concurrent.futures import ThreadPoolExecutor, as_completed

from app.ops import ssh_ops, verify_ops

# Every "Tạo WordPress mới" clone is sourced from exactly one of the ~25
# <server_name>.wp-template.site templates (one per server/PIC, each the
# server's wptt Website_chinh). A defect baked into one of these - wrong WP
# core version, a plugin left active that shouldn't be, a drifted theme -
# propagates into every site cloned from it afterward, so this module exists
# to make that state visible: per-template detail for the create-wpsite
# picker's info panel, and a batch call to compare all of them at once and
# flag whichever one disagrees with the rest.
#
# Same wp() wrapper (source php-cli-domain-config, run as the vhost's own
# system user under its pinned PHP_BINARY) as wp_plugin_ops.CHECK_SCRIPT -
# see that module's 2026-08-20 note for why this is required instead of
# WP_CLI_PHP. Kept as its own script/module rather than extending
# CHECK_SCRIPT in place so plugin_check's existing result shape (used by
# PluginResultPanel) doesn't have to grow unrelated fields.
INFO_SCRIPT = """#!/bin/bash
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
echo "CORE|$(wp core version --path="$PATH_WP" --allow-root 2>/dev/null)"
echo "PHP|$(wp eval 'echo PHP_VERSION;' --path="$PATH_WP" --allow-root 2>/dev/null)"
echo "THEME|$(wp theme list --status=active --path="$PATH_WP" --allow-root --field=name 2>/dev/null)"
echo "PLUGINS"
wp plugin list --path="$PATH_WP" --allow-root --format=csv 2>&1
"""


def get_template_info(entries: list[dict], workers: int = verify_ops.VERIFY_WORKERS) -> list[dict]:
    """entries: [{"domain", "ip", "profile"}]. Returns, per entry:
    {"domain", "ip", "status", "core_version", "php_version", "theme",
    "plugins": [{"name","status","version"}], "note"}."""

    def _one(e: dict) -> dict:
        domain, ip, profile = e["domain"], e["ip"], e["profile"]
        user, key, err = ssh_ops.establish_connection(ip, profile)
        if not user:
            return {"domain": domain, "ip": ip, "status": "FAIL", "core_version": "", "php_version": "",
                     "theme": "", "plugins": [], "note": err or "không kết nối được SSH"}

        rc, output = ssh_ops.run_remote(ip, user, key, INFO_SCRIPT, args=[domain], timeout=60)
        if output.startswith("ERR|"):
            _, _, note = output.strip().splitlines()[0].split("|", 2)
            return {"domain": domain, "ip": ip, "status": "FAIL", "core_version": "", "php_version": "",
                     "theme": "", "plugins": [], "note": note}
        if rc != 0:
            return {"domain": domain, "ip": ip, "status": "FAIL", "core_version": "", "php_version": "",
                     "theme": "", "plugins": [], "note": output.strip()[:160] or f"exit {rc}"}

        lines = output.strip().splitlines()
        fields = {"CORE": "", "PHP": "", "THEME": ""}
        plugin_lines: list[str] = []
        past_marker = False
        for line in lines:
            if line == "PLUGINS":
                past_marker = True
                continue
            if past_marker:
                plugin_lines.append(line)
                continue
            key_, _, value = line.partition("|")
            if key_ in fields:
                fields[key_] = value.strip()

        plugins = []
        for line in plugin_lines[1:]:  # [0] is the CSV header row
            parts = line.split(",")
            if len(parts) >= 3:
                plugins.append({"name": parts[0].strip(), "status": parts[1].strip(),
                                 "version": parts[3].strip() if len(parts) > 3 else ""})

        return {
            "domain": domain, "ip": ip, "status": "OK",
            "core_version": fields["CORE"], "php_version": fields["PHP"], "theme": fields["THEME"],
            "plugins": plugins, "note": "",
        }

    results: list[dict] = [None] * len(entries)  # type: ignore[list-item]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_one, e): idx for idx, e in enumerate(entries)}
        for future in as_completed(futures):
            results[futures[future]] = future.result()
    return results
