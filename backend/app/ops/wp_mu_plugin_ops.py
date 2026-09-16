import os

from app.ops import ssh_ops

# mu-plugins have no install/activate step of their own - any .php file that
# sits directly in wp-content/mu-plugins/ (not a subfolder) is auto-loaded by
# WordPress on EVERY request, unconditionally. Unlike a regular plugin there
# is no `wp plugin deactivate` escape hatch if it's broken, so this is by far
# the highest-blast-radius "install" op in the app - hence the mandatory
# php -l lint before the file ever lands somewhere WordPress will load it,
# and the automatic rollback (delete) if the site breaks right after.
#
# Verification is done with `wp eval` (a real WordPress bootstrap, which
# loads mu-plugins itself), NOT an HTTP request - found + fixed 2026-08-20
# after a real deploy to go88vn.games silently broke the site: it declared a
# function that collided with an existing mu-plugin, but the post-deploy
# HTTP check saw HTTP 200 anyway because LiteSpeed Cache served a stale
# cached homepage instead of re-executing PHP. wp-cli has no such cache
# layer in front of it, so it can't be fooled the same way.

# $1 = domain, $2 = remote .php file (already uploaded via ssh_ops.put_file),
# $3 = target filename inside wp-content/mu-plugins/
INSTALL_MU_PLUGIN_SCRIPT = """#!/bin/bash
DOMAIN="$1"
REMOTE_FILE="$2"
TARGET_FILENAME="$3"
if [[ ! -f "/etc/wptt/vhost/.$DOMAIN.conf" ]]; then
    echo "RESULT|FAIL|not_found|domain not found on server"
    rm -f "$REMOTE_FILE"
    exit 10
fi
PATH_WP="/usr/local/lsws/$DOMAIN/html"
if [[ ! -f "$PATH_WP/wp-load.php" ]]; then
    echo "RESULT|FAIL|not_wp|not a WordPress site"
    rm -f "$REMOTE_FILE"
    exit 12
fi
[[ -f /etc/wptt/php/php-cli-domain-config ]] && \\
    . /etc/wptt/php/php-cli-domain-config "$DOMAIN" 2>/dev/null || true
PHP_BIN="${PHP_BINARY:-$(command -v php)}"
if [[ -z "$PHP_BIN" || ! -x "$PHP_BIN" ]]; then
    echo "RESULT|FAIL|no_php|no PHP binary found to lint with"
    rm -f "$REMOTE_FILE"
    exit 13
fi
WP_REAL_BIN=$(command -v wp)
wp() {
    if [[ -n "${User_name_vhost:-}" ]]; then
        runuser -u "$User_name_vhost" -- "$PHP_BIN" "$WP_REAL_BIN" "$@"
    else
        "$PHP_BIN" "$WP_REAL_BIN" "$@"
    fi
}

bootstrap_ok() {
    [[ "$(wp eval "echo 'BOOT_OK';" --allow-root --path="$PATH_WP" 2>/dev/null)" == "BOOT_OK" ]]
}

if ! bootstrap_ok; then
    echo "RESULT|FAIL|broken_before|site không bootstrap được TRƯỚC khi deploy - không liên quan lần này, kiểm tra site trước"
    rm -f "$REMOTE_FILE"
    exit 14
fi

LINT_OUT=$("$PHP_BIN" -l "$REMOTE_FILE" 2>&1)
if [[ $? -ne 0 ]]; then
    echo "RESULT|FAIL|lint|${LINT_OUT:0:200}"
    rm -f "$REMOTE_FILE"
    exit 15
fi

MU_DIR="$PATH_WP/wp-content/mu-plugins"
mkdir -p "$MU_DIR"
OWNER=$(stat -c '%U' "$PATH_WP/wp-config.php" 2>/dev/null)
if [[ -n "$OWNER" && "$OWNER" != "root" ]]; then
    chown "$OWNER:$OWNER" "$MU_DIR"
fi

cp "$REMOTE_FILE" "$MU_DIR/$TARGET_FILENAME"
chmod 644 "$MU_DIR/$TARGET_FILENAME"
if [[ -n "$OWNER" && "$OWNER" != "root" ]]; then
    chown "$OWNER:$OWNER" "$MU_DIR/$TARGET_FILENAME"
fi
rm -f "$REMOTE_FILE"

if bootstrap_ok; then
    echo "RESULT|OK|$DOMAIN|$TARGET_FILENAME"
    exit 0
fi

# Broke it (e.g. redeclared a function an existing mu-plugin already
# defines) - roll back immediately, don't wait for a human to notice.
rm -f "$MU_DIR/$TARGET_FILENAME"
if bootstrap_ok; then
    echo "RESULT|ROLLBACK|$DOMAIN|$TARGET_FILENAME|site không bootstrap được ngay sau khi deploy - đã tự động xoá, site đã hồi phục"
else
    echo "RESULT|ROLLBACK_FAILED|$DOMAIN|$TARGET_FILENAME|site không bootstrap được ngay sau khi deploy - đã tự xoá NHƯNG site vẫn chưa hồi phục, kiểm tra ngay"
fi
"""


def _connect_or_fail(ip, profile, log, label):
    user, key, err = ssh_ops.establish_connection(ip, profile)
    if not user:
        log(f"[fail] {label}: {err}")
        return None, None, err
    return user, key, None


def install_mu_plugin(entries: list[dict], mu_plugin: dict, log, dry_run: bool = False) -> list[dict]:
    """entries: [{"domain", "ip", "profile"}], mu_plugin: {"label", "path",
    "filename"} - a single library entry (routers/mu_plugins.py) deployed to
    every domain. Sequential, same reasoning as install_plugin_zip/
    install_theme_zip: installs commonly land on the same physical server."""
    target_filename = os.path.basename(mu_plugin["filename"])
    log(f"{'[dry-run] Would deploy' if dry_run else 'Deploying'} mu-plugin \"{mu_plugin['label']}\" "
        f"({target_filename}) to {len(entries)} domain(s)")
    results = []
    for e in entries:
        domain, ip = e.get("domain", "?"), e.get("ip", "?")
        label = f"{domain} ({ip})"
        try:
            profile = e["profile"]

            if dry_run:
                results.append({"domain": domain, "ip": ip, "status": "DRYRUN", "note": "no changes made"})
                continue

            user, key, err = _connect_or_fail(ip, profile, log, label)
            if not user:
                results.append({"domain": domain, "ip": ip, "status": "FAIL", "note": err})
                continue

            remote_file = f"/tmp/muplugin_{domain}_{os.path.basename(mu_plugin['path'])}"
            uploaded, msg = ssh_ops.put_file(ip, user, key, mu_plugin["path"], remote_file)
            if not uploaded:
                log(f"[fail] {label}: upload failed - {msg}")
                results.append({"domain": domain, "ip": ip, "status": "FAIL", "note": f"upload failed ({msg})"})
                continue

            rc, output = ssh_ops.run_remote(
                ip, user, key, INSTALL_MU_PLUGIN_SCRIPT,
                args=[domain, remote_file, target_filename], use_sudo=True, timeout=60,
            )
            for line in output.splitlines():
                log(f"    {line}")

            result_line = next((l for l in output.splitlines() if l.startswith("RESULT|")), None)
            if not result_line:
                log(f"[fail] {label}: no result (exit {rc})")
                results.append({"domain": domain, "ip": ip, "status": "FAIL", "note": f"no result (exit {rc})"})
                continue

            parts = result_line.split("|")
            status = parts[1]

            if status == "OK":
                log(f"[ ok ] {label}: {target_filename} đã đặt vào mu-plugins/, site bootstrap OK")
                results.append({"domain": domain, "ip": ip, "status": "OK", "note": ""})
            elif status in ("ROLLBACK", "ROLLBACK_FAILED"):
                note = parts[4] if len(parts) > 4 else ""
                log(f"[{'ok' if status == 'ROLLBACK' else 'fail'}] {label}: {note}")
                results.append({"domain": domain, "ip": ip, "status": status, "note": note})
            else:
                note = parts[3] if len(parts) > 3 else f"exit {rc}"
                log(f"[fail] {label}: {note}")
                results.append({"domain": domain, "ip": ip, "status": "FAIL", "note": note})
        except Exception as exc:
            log(f"[fail] {label}: unexpected error - {exc}")
            results.append({"domain": domain, "ip": ip, "status": "FAIL", "note": f"unexpected error: {exc}"})
    return results
