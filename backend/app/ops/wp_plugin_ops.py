import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.config import settings
from app.ops import ssh_ops, verify_ops

# Adapted from the standalone plugintasks.py CLI script (python3/plugintasks.py).
# Domain-exists check uses the same /etc/wptt/vhost/.$DOMAIN.conf convention as
# wp_ops.py (CLONE_SCRIPT/REMOVE_SCRIPT) instead of the original script's
# wp-config.php probe, and every script sources wptt's own
# php-cli-domain-config first, then overrides the `wp` command as a function
# that runs it via `runuser -u "$User_name_vhost"` on the resolved
# $PHP_BINARY - matches how wptt's own scripts do it (e.g.
# wordpress/passwd-wp). Two separate bugs this fixes at once, both found +
# fixed 2026-08-20:
#   1. `wp` here is a self-executing phar (`#!/usr/bin/env php` shebang), so
#      the WP_CLI_PHP env var everyone expects to work does NOT actually
#      change which PHP it runs under (confirmed empirically against a
#      domain pinned to a non-default PHP version) - it silently ran under
#      the server's default PHP instead of the domain's configured version
#      on boxes hosting more than one PHP version.
#   2. Every wp-cli call ran as root (SSH connects as root, --allow-root),
#      never dropping to the site's own system user - any file wp-cli or a
#      plugin hook created during the call ended up root-owned, silently
#      breaking that site's own uploads/theme/plugin writes afterward
#      (confirmed live: wp-content/uploads/<year>/<month> owned by root on
#      2 real domains, explains "could not move uploaded file" errors on
#      Media/Theme/Plugin uploads). runuser prevents this at the source
#      instead of relying on chown-after-the-fact patches.
# (The source line itself used to reference a filename,
# wptt-php-service-cli-theo-domain, that doesn't exist on any server - the
# `-f` check just silently failed and the whole PHP-version block was a
# no-op until that got fixed too.)

CHECK_SCRIPT = """#!/bin/bash
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
wp plugin list --path="$PATH_WP" --allow-root --format=csv 2>&1
"""

# $1 = domain, $2 = action (activate|deactivate), $3.. = plugin slugs
TOGGLE_SCRIPT = """#!/bin/bash
DOMAIN="$1"
ACTION="$2"
shift 2
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
if [[ ! -f "$PATH_WP/wp-load.php" ]]; then
    echo "ERR|not_wp|not a WordPress site"
    exit 12
fi
for plugin in "$@"; do
    OUT=$(wp plugin "$ACTION" "$plugin" --path="$PATH_WP" --allow-root 2>&1)
    RC=$?
    if [[ $RC -eq 0 || "$OUT" == *"already"* ]]; then
        echo "OK|$plugin|"
    elif [[ "$OUT" == *"not found"* || "$OUT" == *"could not be found"* ]]; then
        echo "SKIP|$plugin|not installed"
    else
        echo "FAIL|$plugin|${OUT:0:120}"
    fi
done
rm -rf "/usr/local/lsws/$DOMAIN/luucache"/* 2>/dev/null || true
"""

# $1 = domain, $2.. = WP.org slugs
INSTALL_WP_SCRIPT = """#!/bin/bash
DOMAIN="$1"
shift
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
if [[ ! -f "$PATH_WP/wp-load.php" ]]; then
    echo "ERR|not_wp|not a WordPress site"
    exit 12
fi
for slug in "$@"; do
    OUT=$(wp plugin install "$slug" --activate --force --allow-root --path="$PATH_WP" 2>&1)
    RC=$?
    if [[ $RC -eq 0 || "$OUT" == *"Success"* ]]; then
        echo "OK|$slug|"
    else
        echo "FAIL|$slug|${OUT:0:120}"
    fi
done
OWNER=$(stat -c '%U' "$PATH_WP/wp-config.php" 2>/dev/null)
if [[ -n "$OWNER" && "$OWNER" != "root" ]]; then
    chown -R "$OWNER:$OWNER" "$PATH_WP/wp-content/plugins/" 2>/dev/null || true
fi
rm -rf "/usr/local/lsws/$DOMAIN/luucache"/* 2>/dev/null || true
"""

# $1 = domain, $2 = remote zip path (already uploaded via ssh_ops.put_file)
INSTALL_ZIP_SCRIPT = """#!/bin/bash
DOMAIN="$1"
REMOTE_ZIP="$2"
if [[ ! -f "/etc/wptt/vhost/.$DOMAIN.conf" ]]; then
    echo "ERR|not_found|domain not found on server"
    rm -f "$REMOTE_ZIP"
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
if [[ ! -f "$PATH_WP/wp-load.php" ]]; then
    echo "ERR|not_wp|not a WordPress site"
    rm -f "$REMOTE_ZIP"
    exit 12
fi
OUT=$(wp plugin install "$REMOTE_ZIP" --activate --force --allow-root --path="$PATH_WP" 2>&1)
RC=$?
if [[ $RC -ne 0 && "$OUT" != *"Success"* ]]; then
    echo "FAIL||${OUT:0:200}"
    rm -f "$REMOTE_ZIP"
    exit 1
fi
OWNER=$(stat -c '%U' "$PATH_WP/wp-config.php" 2>/dev/null)
if [[ -n "$OWNER" && "$OWNER" != "root" ]]; then
    PLUGIN_FOLDER=$(unzip -Z1 "$REMOTE_ZIP" 2>/dev/null | head -1 | cut -d/ -f1)
    if [[ -n "$PLUGIN_FOLDER" ]]; then
        chown -R "$OWNER:$OWNER" "$PATH_WP/wp-content/plugins/$PLUGIN_FOLDER/" 2>/dev/null || true
    fi
fi
rm -rf "/usr/local/lsws/$DOMAIN/luucache"/* 2>/dev/null || true
rm -f "$REMOTE_ZIP"
echo "OK||installed"
"""

# $1 = domain, $2 = remote zip path (already uploaded via ssh_ops.put_file) -
# deliberately no --activate: installing a theme swaps what visitors see the
# instant it activates, so this only unpacks it into wp-content/themes/ and
# leaves the site's current theme running - activate separately when ready.
INSTALL_THEME_ZIP_SCRIPT = """#!/bin/bash
DOMAIN="$1"
REMOTE_ZIP="$2"
if [[ ! -f "/etc/wptt/vhost/.$DOMAIN.conf" ]]; then
    echo "ERR|not_found|domain not found on server"
    rm -f "$REMOTE_ZIP"
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
if [[ ! -f "$PATH_WP/wp-load.php" ]]; then
    echo "ERR|not_wp|not a WordPress site"
    rm -f "$REMOTE_ZIP"
    exit 12
fi
OUT=$(wp theme install "$REMOTE_ZIP" --force --allow-root --path="$PATH_WP" 2>&1)
RC=$?
if [[ $RC -ne 0 && "$OUT" != *"Success"* ]]; then
    echo "FAIL||${OUT:0:200}"
    rm -f "$REMOTE_ZIP"
    exit 1
fi
OWNER=$(stat -c '%U' "$PATH_WP/wp-config.php" 2>/dev/null)
if [[ -n "$OWNER" && "$OWNER" != "root" ]]; then
    THEME_FOLDER=$(unzip -Z1 "$REMOTE_ZIP" 2>/dev/null | head -1 | cut -d/ -f1)
    if [[ -n "$THEME_FOLDER" ]]; then
        chown -R "$OWNER:$OWNER" "$PATH_WP/wp-content/themes/$THEME_FOLDER/" 2>/dev/null || true
    fi
fi
rm -f "$REMOTE_ZIP"
echo "OK||installed"
"""

# $1 = domain
UPDATE_SCRIPT = """#!/bin/bash
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
if [[ ! -f "$PATH_WP/wp-load.php" ]]; then
    echo "ERR|not_wp|not a WordPress site"
    exit 12
fi
echo "== plugin update =="
wp plugin update --all --allow-root --path="$PATH_WP" 2>&1
echo "== core update =="
wp core update --allow-root --path="$PATH_WP" 2>&1
CORE_VERSION=$(wp core version --path="$PATH_WP" --allow-root 2>/dev/null)
echo "CORE_VERSION|$CORE_VERSION"
OWNER=$(stat -c '%U' "$PATH_WP/wp-config.php" 2>/dev/null)
if [[ -n "$OWNER" && "$OWNER" != "root" ]]; then
    chown -R "$OWNER:$OWNER" "$PATH_WP/wp-content/plugins/" 2>/dev/null || true
fi
rm -rf "/usr/local/lsws/$DOMAIN/luucache"/* 2>/dev/null || true
"""

# $1 = domain - deactivate+reactivate everything, used when a site fails its
# post-update HTTP check (a broken plugin update is the usual cause).
ROLLBACK_SCRIPT = """#!/bin/bash
DOMAIN="$1"
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
wp plugin deactivate --all --allow-root --path="$PATH_WP" 2>/dev/null
sleep 2
wp plugin activate --all --allow-root --path="$PATH_WP" 2>/dev/null
rm -rf "/usr/local/lsws/$DOMAIN/luucache"/* 2>/dev/null || true
"""


def _connect_or_fail(ip, profile, log, label):
    user, key, err = ssh_ops.establish_connection(ip, profile)
    if not user:
        log(f"[fail] {label}: {err}")
        return None, None, err
    return user, key, None


def _parse_result_lines(output: str, log):
    """Lines of the form `STATUS|item|note` emitted by TOGGLE/INSTALL_WP
    scripts. Returns (ok, fail) item name lists."""
    ok, fail = [], []
    for line in output.splitlines():
        parts = line.split("|")
        if len(parts) < 2 or parts[0] not in ("OK", "FAIL", "SKIP"):
            continue
        status, item, note = parts[0], parts[1], parts[2] if len(parts) > 2 else ""
        if status in ("OK", "SKIP"):
            ok.append(item if status == "OK" else f"{item} ({note})")
        else:
            fail.append(f"{item}: {note}")
            log(f"    [fail] {item}: {note}")
    return ok, fail


def check_plugins(entries: list[dict], log) -> list[dict]:
    """entries: [{"domain", "ip", "profile"}]"""
    log(f"Checking plugins on {len(entries)} domain(s)...")

    def _one(e):
        domain, ip, profile = e["domain"], e["ip"], e["profile"]
        label = f"{domain} ({ip})"
        user, key, err = _connect_or_fail(ip, profile, log, label)
        if not user:
            return {"domain": domain, "ip": ip, "status": "FAIL", "plugins": [], "note": err}

        rc, output = ssh_ops.run_remote(ip, user, key, CHECK_SCRIPT, args=[domain], timeout=60)
        if output.startswith("ERR|"):
            _, _, note = output.strip().splitlines()[0].split("|", 2)
            log(f"[fail] {label}: {note}")
            return {"domain": domain, "ip": ip, "status": "FAIL", "plugins": [], "note": note}
        if rc != 0:
            log(f"[fail] {label}: exit {rc}")
            return {"domain": domain, "ip": ip, "status": "FAIL", "plugins": [],
                     "note": output.strip()[:160] or f"exit {rc}"}

        plugins = []
        for line in output.strip().splitlines()[1:]:
            parts = line.split(",")
            if len(parts) >= 3:
                plugins.append({"name": parts[0].strip(), "status": parts[1].strip(),
                                  "version": parts[3].strip() if len(parts) > 3 else ""})
        log(f"[ ok ] {label}: {len(plugins)} plugin(s)")
        return {"domain": domain, "ip": ip, "status": "OK", "plugins": plugins, "note": ""}

    results = [None] * len(entries)
    with ThreadPoolExecutor(max_workers=settings.ssh_plugin_workers) as pool:
        futures = {pool.submit(_one, e): idx for idx, e in enumerate(entries)}
        for future in as_completed(futures):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception as exc:
                e = entries[idx]
                results[idx] = {"domain": e["domain"], "ip": e["ip"], "status": "FAIL",
                                  "plugins": [], "note": str(exc)}
    return results


def _toggle_plugins(entries: list[dict], plugins: list[str], action: str, log, dry_run: bool) -> list[dict]:
    verb = "kích hoạt" if action == "activate" else "tắt"
    log(f"{'[dry-run] Would ' + verb if dry_run else verb.capitalize()} {len(plugins)} plugin(s) "
        f"on {len(entries)} domain(s): {', '.join(plugins)}")

    def _one(e):
        domain, ip, profile = e["domain"], e["ip"], e["profile"]
        label = f"{domain} ({ip})"
        if dry_run:
            return {"domain": domain, "ip": ip, "status": "DRYRUN", "ok": [], "fail": [], "note": "no changes made"}

        user, key, err = _connect_or_fail(ip, profile, log, label)
        if not user:
            return {"domain": domain, "ip": ip, "status": "FAIL", "ok": [], "fail": [], "note": err}

        rc, output = ssh_ops.run_remote(
            ip, user, key, TOGGLE_SCRIPT, args=[domain, action, *plugins], use_sudo=True, timeout=60,
        )
        if output.startswith("ERR|"):
            _, _, note = output.strip().splitlines()[0].split("|", 2)
            log(f"[fail] {label}: {note}")
            return {"domain": domain, "ip": ip, "status": "FAIL", "ok": [], "fail": [], "note": note}

        ok, fail = _parse_result_lines(output, log)
        status = "OK" if not fail else ("FAIL" if not ok else "PARTIAL")
        log(f"[{status.lower()}] {label}: {len(ok)} ok, {len(fail)} fail")

        # Activating a buggy plugin (or deactivating one a theme silently
        # depends on) can white-screen the site even when wp-cli itself
        # reports success for every plugin.
        http_status, ok_after = verify_ops.check_http_via_ssh(ip, user, key, domain)
        verify_note = f"site OK (HTTP {http_status})" if ok_after else f"site DOWN sau khi {verb} (HTTP {http_status})"
        log(f"[{'ok' if ok_after else 'warn'}] {label}: {verify_note}")

        return {"domain": domain, "ip": ip, "status": status, "ok": ok, "fail": fail, "note": "",
                 "verify": {"http_status": http_status, "ok": ok_after, "note": verify_note}}

    results = [None] * len(entries)
    with ThreadPoolExecutor(max_workers=settings.ssh_plugin_workers) as pool:
        futures = {pool.submit(_one, e): idx for idx, e in enumerate(entries)}
        for future in as_completed(futures):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception as exc:
                e = entries[idx]
                results[idx] = {"domain": e["domain"], "ip": e["ip"], "status": "FAIL",
                                  "ok": [], "fail": [], "note": str(exc)}
    return results


def deactivate_plugins(entries: list[dict], plugins: list[str], log, dry_run: bool = False) -> list[dict]:
    return _toggle_plugins(entries, plugins, "deactivate", log, dry_run)


def activate_plugins(entries: list[dict], plugins: list[str], log, dry_run: bool = False) -> list[dict]:
    return _toggle_plugins(entries, plugins, "activate", log, dry_run)


def install_plugins_wp(entries: list[dict], slugs: list[str], log, dry_run: bool = False) -> list[dict]:
    log(f"{'[dry-run] Would install' if dry_run else 'Installing'} {len(slugs)} plugin(s) from WP.org "
        f"on {len(entries)} domain(s): {', '.join(slugs)}")

    def _one(e):
        domain, ip, profile = e["domain"], e["ip"], e["profile"]
        label = f"{domain} ({ip})"
        if dry_run:
            return {"domain": domain, "ip": ip, "status": "DRYRUN", "ok": [], "fail": [], "note": "no changes made"}

        user, key, err = _connect_or_fail(ip, profile, log, label)
        if not user:
            return {"domain": domain, "ip": ip, "status": "FAIL", "ok": [], "fail": [], "note": err}

        rc, output = ssh_ops.run_remote(
            ip, user, key, INSTALL_WP_SCRIPT, args=[domain, *slugs], use_sudo=True, timeout=180,
        )
        if output.startswith("ERR|"):
            _, _, note = output.strip().splitlines()[0].split("|", 2)
            log(f"[fail] {label}: {note}")
            return {"domain": domain, "ip": ip, "status": "FAIL", "ok": [], "fail": [], "note": note}

        ok, fail = _parse_result_lines(output, log)
        status = "OK" if not fail else ("FAIL" if not ok else "PARTIAL")
        log(f"[{status.lower()}] {label}: {len(ok)} ok, {len(fail)} fail")

        http_status, ok_after = verify_ops.check_http_via_ssh(ip, user, key, domain)
        verify_note = f"site OK (HTTP {http_status})" if ok_after else f"site DOWN sau khi cài (HTTP {http_status})"
        log(f"[{'ok' if ok_after else 'warn'}] {label}: {verify_note}")

        return {"domain": domain, "ip": ip, "status": status, "ok": ok, "fail": fail, "note": "",
                 "verify": {"http_status": http_status, "ok": ok_after, "note": verify_note}}

    results = [None] * len(entries)
    with ThreadPoolExecutor(max_workers=settings.ssh_plugin_workers) as pool:
        futures = {pool.submit(_one, e): idx for idx, e in enumerate(entries)}
        for future in as_completed(futures):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception as exc:
                e = entries[idx]
                results[idx] = {"domain": e["domain"], "ip": e["ip"], "status": "FAIL",
                                  "ok": [], "fail": [], "note": str(exc)}
    return results


def install_plugin_zip(entries: list[dict], zips: list[dict], log, dry_run: bool = False) -> list[dict]:
    """entries: [{"domain", "ip", "profile"}], zips: [{"label", "path"}] - one
    or more library entries (routers/plugin_zips.py), each installed on every
    domain in order. "label" is the clean, human-facing name (the library's
    original filename) - "path" is the actual on-disk file, which has a
    uuid-prefixed name to avoid collisions between library entries.
    Sequential on purpose: each domain gets every zip scp'd up fresh, and
    installs commonly land on the same physical server, so running these
    concurrently would pile CPU/DB load from several installs onto one box
    at once."""
    zip_names = [z["label"] for z in zips]
    log(f"{'[dry-run] Would install' if dry_run else 'Installing'} {len(zips)} zip(s) "
        f"({', '.join(zip_names)}) on {len(entries)} domain(s)")
    results = []
    for e in entries:
        domain, ip = e.get("domain", "?"), e.get("ip", "?")
        label = f"{domain} ({ip})"
        try:
            profile = e["profile"]

            if dry_run:
                results.append({"domain": domain, "ip": ip, "status": "DRYRUN", "ok": [], "fail": [], "note": "no changes made"})
                continue

            user, key, err = _connect_or_fail(ip, profile, log, label)
            if not user:
                results.append({"domain": domain, "ip": ip, "status": "FAIL", "ok": [], "fail": [], "note": err})
                continue

            http_before, ok_before = verify_ops.check_http_via_ssh(ip, user, key, domain)

            ok, fail = [], []
            for z in zips:
                zip_name, zip_local_path = z["label"], z["path"]
                remote_zip = f"/tmp/pluginzip_{domain}_{os.path.basename(zip_local_path)}"
                uploaded, msg = ssh_ops.put_file(ip, user, key, zip_local_path, remote_zip)
                if not uploaded:
                    log(f"[fail] {label}: upload {zip_name} failed - {msg}")
                    fail.append(f"{zip_name}: upload failed ({msg})")
                    continue
                log(f"[ ok ] {label}: uploaded {zip_name}")

                rc, output = ssh_ops.run_remote(
                    ip, user, key, INSTALL_ZIP_SCRIPT, args=[domain, remote_zip], use_sudo=True, timeout=120,
                )
                for line in output.splitlines():
                    log(f"    {line}")

                if output.startswith("OK|"):
                    log(f"[ ok ] {label}: {zip_name} installed")
                    ok.append(zip_name)
                elif output.startswith("ERR|") or output.startswith("FAIL|"):
                    note = output.strip().splitlines()[0].split("|", 2)[-1]
                    log(f"[fail] {label}: {zip_name} - {note}")
                    fail.append(f"{zip_name}: {note}")
                else:
                    log(f"[fail] {label}: {zip_name} exit {rc}")
                    fail.append(f"{zip_name}: exit {rc}")

            status = "OK" if not fail else ("FAIL" if not ok else "PARTIAL")
            log(f"[{status.lower()}] {label}: {len(ok)} ok, {len(fail)} fail")

            # A zip installing "OK" per WP-CLI doesn't mean the site is
            # still up - a bad plugin can white-screen the whole site.
            http_after, ok_after = verify_ops.check_http_via_ssh(ip, user, key, domain)
            if ok_after:
                verify_note = f"site OK (HTTP {http_after})"
            elif not ok_before:
                verify_note = f"site đã down từ trước khi cài (HTTP {http_before}) - không liên quan lần cài này"
            else:
                verify_note = f"site DOWN sau khi cài (HTTP {http_after}) - có thể do plugin vừa cài, kiểm tra ngay"
            log(f"[{'ok' if ok_after else 'warn'}] {label}: {verify_note}")

            results.append({"domain": domain, "ip": ip, "status": status, "ok": ok, "fail": fail, "note": "",
                              "verify": {"http_status": http_after, "ok": ok_after, "note": verify_note}})
        except Exception as exc:
            # See wp_ops.clone_wpsite for why this guard exists - one bad
            # entry must never abort the whole batch and erase every other
            # domain's already-collected result.
            log(f"[fail] {label}: unexpected error - {exc}")
            results.append({"domain": domain, "ip": ip, "status": "FAIL", "ok": [], "fail": [],
                              "note": f"unexpected error: {exc}"})
    return results


def install_theme_zip(entries: list[dict], zips: list[dict], log, dry_run: bool = False) -> list[dict]:
    """Same shape as install_plugin_zip, but themes are never installed with
    --activate (see INSTALL_THEME_ZIP_SCRIPT) - the site's current theme
    keeps serving traffic unchanged, so there's nothing for an HTTP
    before/after check here to catch. Sequential for the same reason as
    install_plugin_zip: avoid piling installs onto one physical server."""
    zip_names = [z["label"] for z in zips]
    log(f"{'[dry-run] Would install' if dry_run else 'Installing'} {len(zips)} theme(s) "
        f"({', '.join(zip_names)}) on {len(entries)} domain(s)")
    results = []
    for e in entries:
        domain, ip = e.get("domain", "?"), e.get("ip", "?")
        label = f"{domain} ({ip})"
        try:
            profile = e["profile"]

            if dry_run:
                results.append({"domain": domain, "ip": ip, "status": "DRYRUN", "ok": [], "fail": [], "note": "no changes made"})
                continue

            user, key, err = _connect_or_fail(ip, profile, log, label)
            if not user:
                results.append({"domain": domain, "ip": ip, "status": "FAIL", "ok": [], "fail": [], "note": err})
                continue

            ok, fail = [], []
            for z in zips:
                zip_name, zip_local_path = z["label"], z["path"]
                remote_zip = f"/tmp/themezip_{domain}_{os.path.basename(zip_local_path)}"
                uploaded, msg = ssh_ops.put_file(ip, user, key, zip_local_path, remote_zip)
                if not uploaded:
                    log(f"[fail] {label}: upload {zip_name} failed - {msg}")
                    fail.append(f"{zip_name}: upload failed ({msg})")
                    continue
                log(f"[ ok ] {label}: uploaded {zip_name}")

                rc, output = ssh_ops.run_remote(
                    ip, user, key, INSTALL_THEME_ZIP_SCRIPT, args=[domain, remote_zip], use_sudo=True, timeout=120,
                )
                for line in output.splitlines():
                    log(f"    {line}")

                if output.startswith("OK|"):
                    log(f"[ ok ] {label}: {zip_name} installed (chưa activate)")
                    ok.append(zip_name)
                elif output.startswith("ERR|") or output.startswith("FAIL|"):
                    note = output.strip().splitlines()[0].split("|", 2)[-1]
                    log(f"[fail] {label}: {zip_name} - {note}")
                    fail.append(f"{zip_name}: {note}")
                else:
                    log(f"[fail] {label}: {zip_name} exit {rc}")
                    fail.append(f"{zip_name}: exit {rc}")

            status = "OK" if not fail else ("FAIL" if not ok else "PARTIAL")
            log(f"[{status.lower()}] {label}: {len(ok)} ok, {len(fail)} fail")
            results.append({"domain": domain, "ip": ip, "status": status, "ok": ok, "fail": fail, "note": ""})
        except Exception as exc:
            log(f"[fail] {label}: unexpected error - {exc}")
            results.append({"domain": domain, "ip": ip, "status": "FAIL", "ok": [], "fail": [],
                              "note": f"unexpected error: {exc}"})
    return results


def _extract_summary(section: str) -> str:
    for line in section.splitlines():
        if line.strip().lower().startswith("success:"):
            return line.strip()
    return "-"


def update_plugins(entries: list[dict], log, dry_run: bool = False) -> list[dict]:
    """Sequential on purpose - see install_plugin_zip. Update is also the
    riskiest op here (touches every plugin + WP core), so domains are rolled
    through one at a time with an HTTP check before/after and an automatic
    rollback (deactivate all -> reactivate all) if a site goes down."""
    log(f"{'[dry-run] Would update' if dry_run else 'Updating'} plugins + WP core on {len(entries)} domain(s)")
    results = []
    for e in entries:
        domain, ip = e.get("domain", "?"), e.get("ip", "?")
        label = f"{domain} ({ip})"
        try:
            profile = e["profile"]

            if dry_run:
                results.append({"domain": domain, "ip": ip, "status": "DRYRUN",
                                  "http_before": None, "http_after": None, "rolled_back": False,
                                  "plugin_summary": "-", "core_summary": "-", "core_version": None,
                                  "note": "no changes made"})
                continue

            status_before, ok_before = verify_ops.check_http_external(domain)
            if not ok_before:
                log(f"[skip] {label}: HTTP {status_before} - site already down before update")
                results.append({"domain": domain, "ip": ip, "status": "SKIP",
                                  "http_before": status_before, "http_after": None, "rolled_back": False,
                                  "plugin_summary": "-", "core_summary": "-", "core_version": None,
                                  "note": f"site already down: HTTP {status_before}"})
                continue
            log(f"[info] {label}: HTTP {status_before} OK before update")

            user, key, err = _connect_or_fail(ip, profile, log, label)
            if not user:
                results.append({"domain": domain, "ip": ip, "status": "FAIL",
                                  "http_before": status_before, "http_after": None, "rolled_back": False,
                                  "plugin_summary": "-", "core_summary": "-", "core_version": None, "note": err})
                continue

            rc, output = ssh_ops.run_remote(ip, user, key, UPDATE_SCRIPT, args=[domain], use_sudo=True, timeout=300)
            for line in output.splitlines():
                log(f"    {line}")

            if output.startswith("ERR|"):
                note = output.strip().splitlines()[0].split("|", 2)[-1]
                log(f"[fail] {label}: {note}")
                results.append({"domain": domain, "ip": ip, "status": "FAIL",
                                  "http_before": status_before, "http_after": None, "rolled_back": False,
                                  "plugin_summary": "-", "core_summary": "-", "core_version": None, "note": note})
                continue

            plugin_section, _, rest = output.partition("== core update ==")
            core_section, _, _ = rest.partition("CORE_VERSION|")
            core_version = None
            for line in output.splitlines():
                if line.startswith("CORE_VERSION|"):
                    core_version = line.split("|", 1)[1].strip() or None

            time.sleep(3)
            status_after, ok_after = verify_ops.check_http_external(domain)

            if ok_after:
                log(f"[ ok ] {label}: HTTP {status_after} OK after update")
                results.append({"domain": domain, "ip": ip, "status": "OK",
                                  "http_before": status_before, "http_after": status_after, "rolled_back": False,
                                  "plugin_summary": _extract_summary(plugin_section),
                                  "core_summary": _extract_summary(core_section), "core_version": core_version,
                                  "note": ""})
                continue

            log(f"[fail] {label}: HTTP {status_after} - site down after update, rolling back...")
            rb_user, rb_key = user, key
            ssh_ops.run_remote(ip, rb_user, rb_key, ROLLBACK_SCRIPT, args=[domain], use_sudo=True, timeout=60)
            time.sleep(2)
            status_rb, ok_rb = verify_ops.check_http_external(domain)
            rolled_back = ok_rb
            if ok_rb:
                log(f"[warn] {label}: HTTP {status_rb} OK after rollback")
            else:
                log(f"[fail] {label}: HTTP {status_rb} - still down after rollback, needs manual check")

            results.append({"domain": domain, "ip": ip, "status": "ROLLBACK",
                              "http_before": status_before, "http_after": status_after, "rolled_back": rolled_back,
                              "plugin_summary": _extract_summary(plugin_section),
                              "core_summary": _extract_summary(core_section), "core_version": core_version,
                              "note": f"site down after update (HTTP {status_after})"
                                      + (" - rolled back OK" if rolled_back else " - rollback did not recover site")})
        except Exception as exc:
            log(f"[fail] {label}: unexpected error - {exc}")
            results.append({"domain": domain, "ip": ip, "status": "FAIL",
                              "http_before": None, "http_after": None, "rolled_back": False,
                              "plugin_summary": "-", "core_summary": "-", "core_version": None,
                              "note": f"unexpected error: {exc}"})
    return results
