from concurrent.futures import ThreadPoolExecutor, as_completed

from app.config import settings
from app.ops import ssh_ops, verify_ops

# Lightweight, per-domain WordPress maintenance actions. Unlike
# wp_plugin_ops.update_plugins/install_plugin_zip or wp_restore_ops's real
# restore, these are cheap (cache clear, comment cleanup) and carry no risk
# of overloading a shared server, so every domain is processed in parallel.

# $1 = domain
CLEAR_CACHE_SCRIPT = """#!/bin/bash
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
rm -rf "$PATH_WP/wp-content/cache/litespeed/full/" 2>/dev/null || true
wp cache flush --allow-root --path="$PATH_WP" >/dev/null 2>&1
rm -rf "/usr/local/lsws/$DOMAIN/luucache"/* 2>/dev/null || true
echo "RESULT|OK"
"""

# $1 = domain, $2 = disable_new (1|0), $3 = dry_run (1|0)
CLEAR_COMMENTS_SCRIPT = """#!/bin/bash
DOMAIN="$1"
DISABLE_NEW="$2"
DRY_RUN="$3"
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
IDS=$(wp comment list --format=ids --allow-root --path="$PATH_WP" 2>/dev/null)
COUNT=0
[[ -n "$IDS" ]] && COUNT=$(echo "$IDS" | wc -w)

if [[ "$DRY_RUN" == "1" ]]; then
    echo "RESULT|DRYRUN|$COUNT"
    exit 0
fi

if [[ -n "$IDS" ]]; then
    wp comment delete $IDS --force --allow-root --path="$PATH_WP" >/dev/null 2>&1
fi
if [[ "$DISABLE_NEW" == "1" ]]; then
    wp option update default_comment_status closed --allow-root --path="$PATH_WP" >/dev/null 2>&1
fi
echo "RESULT|OK|$COUNT"
"""


# $1 = domain, $2 = dry_run (1|0) - runs wptt's own wptt-phanquyen, the
# exact tool used to fix cakhiatv.ch/gem88a.co.com and the 2026-08-20
# fleet-wide sweep (186 domains across 22 servers had root-owned files under
# wp-content because wp-cli used to run as root - see wp_ops.py's runuser
# fix). Proven safe to re-run on an already-correct domain (no-op).
FIX_PERMISSIONS_SCRIPT = """#!/bin/bash
DOMAIN="$1"
DRY_RUN="$2"
if [[ ! -f "/etc/wptt/vhost/.$DOMAIN.conf" ]]; then
    echo "ERR|not_found|domain not found on server"
    exit 10
fi
PATH_WP="/usr/local/lsws/$DOMAIN/html"
[[ -f /etc/wptt/php/php-cli-domain-config ]] && \\
    . /etc/wptt/php/php-cli-domain-config "$DOMAIN" 2>/dev/null || true
if [[ -z "${User_name_vhost:-}" ]]; then
    echo "ERR|no_user|không xác định được user hệ thống của site"
    exit 11
fi
BEFORE=$(find "$PATH_WP" -not -user "$User_name_vhost" 2>/dev/null | wc -l)

if [[ "$DRY_RUN" == "1" ]]; then
    echo "RESULT|DRYRUN|$BEFORE"
    exit 0
fi

bash /etc/wptt/wptt-phanquyen "$DOMAIN" >/tmp/phanquyen-$DOMAIN.log 2>&1
AFTER=$(find "$PATH_WP" -not -user "$User_name_vhost" 2>/dev/null | wc -l)
echo "RESULT|OK|$BEFORE|$AFTER"
"""


def _connect_or_fail(ip, profile, log, label):
    user, key, err = ssh_ops.establish_connection(ip, profile)
    if not user:
        log(f"[fail] {label}: {err}")
        return None, None, err
    return user, key, None


def _err_note(output: str) -> str:
    first = output.strip().splitlines()[0] if output.strip() else ""
    parts = first.split("|", 2)
    return parts[-1] if len(parts) > 1 else first or "unknown error"


def clear_cache(entries: list[dict], log) -> list[dict]:
    """entries: [{"domain", "ip", "profile"}]. Clears every caching layer
    this app knows about for the domain: the LiteSpeed Cache plugin's page
    cache, the WordPress object cache, and the OpenLiteSpeed-level luucache
    (the last one is already swept by other mutating ops elsewhere in this
    app - included here too so this action is a complete "clear everything"
    for an operator who just wants a site to stop serving stale pages)."""
    log(f"Đang xoá cache cho {len(entries)} domain...")

    def _one(e):
        domain, ip, profile = e["domain"], e["ip"], e["profile"]
        label = f"{domain} ({ip})"
        user, key, err = _connect_or_fail(ip, profile, log, label)
        if not user:
            return {"domain": domain, "ip": ip, "status": "FAIL", "note": err}

        rc, output = ssh_ops.run_remote(ip, user, key, CLEAR_CACHE_SCRIPT, args=[domain], use_sudo=True, timeout=30)
        if output.startswith("ERR|"):
            note = _err_note(output)
            log(f"[fail] {label}: {note}")
            return {"domain": domain, "ip": ip, "status": "FAIL", "note": note}
        if output.strip().startswith("RESULT|OK"):
            log(f"[ ok ] {label}: đã xoá cache")
            # A broken object-cache plugin can white-screen a site on flush -
            # confirm it's still up rather than trusting the script's exit alone.
            http_status, ok = verify_ops.check_http_via_ssh(ip, user, key, domain)
            verify_note = f"site OK (HTTP {http_status})" if ok else f"site DOWN sau khi xoá cache (HTTP {http_status})"
            log(f"[{'ok' if ok else 'warn'}] {label}: {verify_note}")
            return {"domain": domain, "ip": ip, "status": "OK", "note": "",
                     "verify": {"http_status": http_status, "ok": ok, "note": verify_note}}
        log(f"[fail] {label}: exit {rc}")
        return {"domain": domain, "ip": ip, "status": "FAIL", "note": f"exit {rc}"}

    results = [None] * len(entries)
    with ThreadPoolExecutor(max_workers=settings.ssh_plugin_workers) as pool:
        futures = {pool.submit(_one, e): idx for idx, e in enumerate(entries)}
        for future in as_completed(futures):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception as exc:
                e = entries[idx]
                results[idx] = {"domain": e["domain"], "ip": e["ip"], "status": "FAIL", "note": str(exc)}
    return results


def clear_comments(entries: list[dict], log, disable_new: bool, dry_run: bool = False) -> list[dict]:
    """entries: [{"domain", "ip", "profile"}]. dry_run=True only counts
    existing comments - deletes nothing. disable_new sets
    default_comment_status=closed after deleting (only when dry_run=False)."""
    verb = "Đang đếm" if dry_run else "Đang xoá"
    log(f"{verb} comment cho {len(entries)} domain...")

    def _one(e):
        domain, ip, profile = e["domain"], e["ip"], e["profile"]
        label = f"{domain} ({ip})"
        user, key, err = _connect_or_fail(ip, profile, log, label)
        if not user:
            return {"domain": domain, "ip": ip, "status": "FAIL", "comment_count": 0, "note": err}

        rc, output = ssh_ops.run_remote(
            ip, user, key, CLEAR_COMMENTS_SCRIPT,
            args=[domain, "1" if disable_new else "0", "1" if dry_run else "0"],
            use_sudo=True, timeout=60,
        )
        if output.startswith("ERR|"):
            note = _err_note(output)
            log(f"[fail] {label}: {note}")
            return {"domain": domain, "ip": ip, "status": "FAIL", "comment_count": 0, "note": note}

        result_line = next((l for l in output.splitlines() if l.startswith("RESULT|")), None)
        if not result_line:
            log(f"[fail] {label}: no result (exit {rc})")
            return {"domain": domain, "ip": ip, "status": "FAIL", "comment_count": 0, "note": f"no result (exit {rc})"}

        parts = result_line.split("|")
        count = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
        if dry_run:
            log(f"[ ok ] {label}: {count} comment sẽ bị xoá")
            return {"domain": domain, "ip": ip, "status": "DRYRUN", "comment_count": count, "note": "chưa xoá gì"}
        log(f"[ ok ] {label}: đã xoá {count} comment")
        return {"domain": domain, "ip": ip, "status": "OK", "comment_count": count, "note": ""}

    results = [None] * len(entries)
    with ThreadPoolExecutor(max_workers=settings.ssh_plugin_workers) as pool:
        futures = {pool.submit(_one, e): idx for idx, e in enumerate(entries)}
        for future in as_completed(futures):
            idx = futures[future]
            try:
                results[idx] = future.result()
            except Exception as exc:
                e = entries[idx]
                results[idx] = {"domain": e["domain"], "ip": e["ip"], "status": "FAIL", "comment_count": 0, "note": str(exc)}
    return results


def fix_permissions(entries: list[dict], log, dry_run: bool = False) -> list[dict]:
    """entries: [{"domain", "ip", "profile"}]. Recursive chown over a whole
    site is I/O-heavy - same reasoning as
    wp_plugin_ops.update_plugins/wp_restore_ops.restore_wpsite - domains run
    one at a time, never in parallel against the same server.
    dry_run=True only counts files with the wrong owner, changes nothing."""
    verb = "Đang đếm file bị sai chủ cho" if dry_run else "Đang phân quyền lại"
    log(f"{verb} {len(entries)} domain (tuần tự)...")
    results = []
    for e in entries:
        domain, ip = e.get("domain", "?"), e.get("ip", "?")
        label = f"{domain} ({ip})"
        try:
            profile = e["profile"]
            user, key, err = _connect_or_fail(ip, profile, log, label)
            if not user:
                results.append({"domain": domain, "ip": ip, "status": "FAIL", "before": 0, "after": 0, "note": err})
                continue

            ok_before, http_before = True, 0
            if not dry_run:
                http_before, ok_before = verify_ops.check_http_via_ssh(ip, user, key, domain)

            rc, output = ssh_ops.run_remote(
                ip, user, key, FIX_PERMISSIONS_SCRIPT, args=[domain, "1" if dry_run else "0"],
                use_sudo=True, timeout=300,
            )
            if output.startswith("ERR|"):
                note = _err_note(output)
                log(f"[fail] {label}: {note}")
                results.append({"domain": domain, "ip": ip, "status": "FAIL", "before": 0, "after": 0, "note": note})
                continue

            result_line = next((l for l in output.splitlines() if l.startswith("RESULT|")), None)
            if not result_line:
                log(f"[fail] {label}: no result (exit {rc})")
                results.append({"domain": domain, "ip": ip, "status": "FAIL", "before": 0, "after": 0,
                                  "note": f"no result (exit {rc})"})
                continue

            parts = result_line.split("|")
            if dry_run:
                before = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
                note = "đúng chủ hết rồi" if before == 0 else "chưa sửa gì (dry-run)"
                log(f"[ ok ] {label}: {before} file bị sai chủ")
                results.append({"domain": domain, "ip": ip, "status": "DRYRUN", "before": before, "after": before, "note": note})
                continue

            before = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
            after = int(parts[3]) if len(parts) > 3 and parts[3].isdigit() else 0
            log(f"[ ok ] {label}: {before} -> {after} file bị sai chủ")

            # wptt-phanquyen also resets chmod bits (not just ownership) -
            # confirm the site is still up rather than trusting the script's
            # exit code alone.
            http_after, ok_after = verify_ops.check_http_via_ssh(ip, user, key, domain)
            if ok_after:
                verify_note = f"site OK (HTTP {http_after})"
            elif not ok_before:
                verify_note = f"site đã down từ trước (HTTP {http_before}) - không liên quan lần này"
            else:
                verify_note = f"site DOWN sau khi phân quyền (HTTP {http_after}) - kiểm tra ngay"
            log(f"[{'ok' if ok_after else 'warn'}] {label}: {verify_note}")

            results.append({
                "domain": domain, "ip": ip, "status": "OK" if after == 0 else "PARTIAL",
                "before": before, "after": after, "note": "",
                "verify": {"http_status": http_after, "ok": ok_after, "note": verify_note},
            })
        except Exception as exc:
            log(f"[fail] {label}: unexpected error - {exc}")
            results.append({"domain": domain, "ip": ip, "status": "FAIL", "before": 0, "after": 0,
                              "note": f"unexpected error: {exc}"})
    return results
