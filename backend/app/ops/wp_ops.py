from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.ops import cf_ops, ssh_ops, verify_ops
from app.ops.validation import is_valid_domain

# NOTE: unlike the original servertasks.py, domain/target/password values are
# NEVER interpolated into these script strings. They are passed as
# positional parameters ($1, $2, ...) via ssh_ops.run_remote(args=[...]),
# which shlex-quotes each value before it ever reaches a remote shell. That
# is what makes this safe against a domain like `a.com"; rm -rf /` - see
# ssh_ops.run_remote's docstring.

CLONE_SCRIPT = """#!/bin/bash
set -o pipefail
SOURCE="$1"
TARGET="$2"
LOG="/tmp/clone-$TARGET.log"

echo "[step] Checking source..."
if [[ ! -f "/etc/wptt/vhost/.$SOURCE.conf" ]]; then
    echo "[fail] source $SOURCE not found on server"
    exit 1
fi
echo "[ ok] source $SOURCE found"

if [[ -f "/etc/wptt/vhost/.$TARGET.conf" ]]; then
    echo "[step] Target $TARGET exists - removing first (via wptt-xoa-website)..."
    if [[ -f /etc/wptt/.wptt.conf ]]; then
        . /etc/wptt/.wptt.conf
        if [[ "$TARGET" == "$Website_chinh" ]]; then
            echo "[fail] $TARGET is the primary website - refusing to remove"
            exit 11
        fi
    fi

    # 'nhan-ban' tells wptt's own delete tool this removal is immediately
    # followed by a re-clone (matches how wptt-sao-chep-website's own
    # built-in overwrite path calls it) - it skips the interactive
    # backup/SSL-deletion prompts (never reached anyway since $1 isn't the
    # menu sentinel "98", but this also leaves backup/SSL files in place for
    # the upcoming clone rather than deleting and immediately recreating
    # them. Delegating here (instead of hand-rolling drop-db/rm-rf/sed
    # ourselves, as before) picks up wptt's own chroot-bind-mount unmount
    # and OpenLiteSpeed namespace teardown steps - both documented by wptt's
    # author as fixes for a previously fatal bug in exactly this
    # remove-then-reclone scenario.
    bash /etc/wptt/domain/wptt-xoa-website "$TARGET" 'nhan-ban' >/tmp/xoa-$TARGET.log 2>&1

    if [[ -f "/etc/wptt/vhost/.$TARGET.conf" ]]; then
        echo "[fail] wptt-xoa-website did not remove $TARGET - see /tmp/xoa-$TARGET.log"
        exit 12
    fi
    echo "[ ok] $TARGET removed"
else
    echo "[skip] $TARGET does not exist - fresh clone"
fi

echo "[step] Starting clone $SOURCE -> $TARGET..."
nohup bash /etc/wptt/wptt-sao-chep-website "$SOURCE" "$TARGET" >> "$LOG" 2>&1 &
PID=$!
echo "[ ok] clone dispatched  PID $PID  log: $LOG"
echo "PID $PID"
"""

REMOVE_SCRIPT = """#!/bin/bash
set -o pipefail
DOMAIN="$1"

if [[ ! -f "/etc/wptt/vhost/.$DOMAIN.conf" ]]; then
    echo "RESULT|NOTFOUND|$DOMAIN|domain not found"
    exit 10
fi
if [[ ! -f /etc/wptt/.wptt.conf ]]; then
    echo "RESULT|FAIL|$DOMAIN|missing .wptt.conf"
    exit 12
fi
. /etc/wptt/.wptt.conf
if [[ "$DOMAIN" = "$Website_chinh" ]]; then
    echo "RESULT|FAIL|$DOMAIN|primary website - refusing to remove"
    exit 11
fi

# No 'nhan-ban' here (unlike CLONE_SCRIPT's overwrite path) - this is a
# permanent removal, not immediately followed by a re-clone, so wptt's own
# tool also cleans up backups/SSL certs. Still safe non-interactively: $1 is
# the real domain (never the menu sentinel "98"), so wptt-xoa-website never
# hits an interactive prompt on this path - confirmed by reading its source.
bash /etc/wptt/domain/wptt-xoa-website "$DOMAIN" >/tmp/xoa-$DOMAIN.log 2>&1

if [[ -f "/etc/wptt/vhost/.$DOMAIN.conf" ]]; then
    echo "RESULT|FAIL|$DOMAIN|wptt-xoa-website did not remove domain - see /tmp/xoa-$DOMAIN.log"
    exit 13
fi

echo "RESULT|OK|$DOMAIN|removed at $(date '+%Y-%m-%d %H:%M:%S')"
"""

CHANGEPASS_SCRIPT = """#!/bin/bash
set -o pipefail
DOMAIN="$1"
NEW_PASSWORD="$2"
ADMIN_USERNAME="$3"

[[ -f /etc/wptt/.wptt.conf ]] && . /etc/wptt/.wptt.conf 2>/dev/null || true

if [[ ! -f "/etc/wptt/vhost/.$DOMAIN.conf" ]]; then
    echo "RESULT|FAIL|$DOMAIN|-|-|domain not configured"
    exit 1
fi
if [[ ! -f "/usr/local/lsws/$DOMAIN/html/wp-load.php" ]]; then
    echo "RESULT|FAIL|$DOMAIN|-|-|not a WordPress site"
    exit 1
fi

path="/usr/local/lsws/$DOMAIN/html"
[[ -f /etc/wptt/php/php-cli-domain-config ]] && \
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
    echo "RESULT|FAIL|$DOMAIN|-|-|wp-cli missing"
    exit 1
fi

if [[ -z "$ADMIN_USERNAME" ]]; then
    mapfile -t admin_users < <(wp user list --role=administrator --fields=user_login \
        --allow-root --path="$path" 2>/dev/null | sed '1d' | sort -uV)
    if [[ ${#admin_users[@]} -eq 0 ]]; then
        echo "RESULT|FAIL|$DOMAIN|-|-|no admin user"
        exit 1
    fi
    CURRENT_ADMIN="${admin_users[0]}"
else
    user_check=$(wp user get "$ADMIN_USERNAME" --field=user_login \
        --allow-root --path="$path" 2>/dev/null)
    if [[ -z "$user_check" ]]; then
        echo "RESULT|FAIL|$DOMAIN|$ADMIN_USERNAME|-|user not found"
        exit 1
    fi
    CURRENT_ADMIN="$ADMIN_USERNAME"
fi

if wp user update "$CURRENT_ADMIN" --user_pass="$NEW_PASSWORD" \
    --path="$path" --allow-root >/dev/null 2>&1; then
    echo "RESULT|OK|$DOMAIN|$CURRENT_ADMIN|$NEW_PASSWORD|"
else
    echo "RESULT|FAIL|$DOMAIN|$CURRENT_ADMIN|-|wp update failed"
    exit 1
fi
"""


def _connect_or_fail(ip, profile, log, label):
    user, key, err = ssh_ops.establish_connection(ip, profile)
    if not user:
        log(f"[fail] {label}: {err}")
        return None, None, err
    return user, key, None


# CLONE_SCRIPT's copy step (nohup'd wptt-sao-chep-website: new system user,
# new DB, full file copy) is heavy I/O/CPU work that runs unthrottled in the
# background on the TARGET SERVER, independent of how our own dispatch loop
# is paced - "sequential dispatch" only means the SSH round-trip to kick each
# one off is sequential (a couple seconds each), not that the copies
# themselves run one at a time. A batch aimed at the same server all starts
# copying at once with zero coordination between them, since nothing here or
# in the remote tool tracks "how many clones are already running on this
# box." Seen in production: a batch of source domains all cloning onto one
# Alibaba server overloaded it badly enough that SSH itself stopped
# responding. Capped per *target server* (not globally - different servers
# have no reason to wait on each other), sized conservatively per provider
# from vCPU/RAM headroom (Ali 8c/16GB, GCP 16c/32GB) since there's no
# telemetry yet on where the real ceiling is (disk I/O rather than CPU is
# the likely limiter, which doesn't scale with core count) - tune from
# observed load next time, not guesswork.
_CLONE_CONCURRENCY_BY_PROFILE_PREFIX = {"ali": 2, "gcp": 3}
_DEFAULT_CLONE_CONCURRENCY = 2


def _clone_concurrency(profile: str) -> int:
    for prefix, n in _CLONE_CONCURRENCY_BY_PROFILE_PREFIX.items():
        if profile.startswith(prefix):
            return n
    return _DEFAULT_CLONE_CONCURRENCY


def clone_wpsite(entries: list[dict], log, dry_run: bool = False) -> list[dict]:
    """entries: [{"profile", "ip", "source", "target"}]

    Per target server: dispatch+verify in small chunks (see
    _clone_concurrency) so no more than a few clones are ever copying in the
    background on the same box at once - the next chunk for that server
    isn't dispatched until the previous one has come up (or the 90s wait
    times out). Across DIFFERENT servers there's no such constraint, so each
    server's chunk pipeline runs in its own thread, fully in parallel with
    every other server's."""
    results: list[dict | None] = [None] * len(entries)

    def _dispatch_one(idx: int, e: dict) -> dict | None:
        """Runs the SSH dispatch + DNS update for one entry. Returns a
        pending-verify dict on successful dispatch, or None once this
        entry's final result has already been written to `results[idx]`
        (validation failure, dry-run, connect failure, script failure, or an
        unexpected exception)."""
        source, target, ip = e.get("source", "?"), e.get("target", "?"), e.get("ip", "?")
        label = f"{source} -> {target} ({ip})"
        try:
            profile = e["profile"]

            if not is_valid_domain(source) or not is_valid_domain(target):
                log(f"[fail] {label}: invalid domain format")
                results[idx] = {"source": source, "target": target, "ip": ip,
                                  "status": "FAIL", "note": "invalid domain format"}
                return None

            if dry_run:
                log(f"[dry-run] would clone {label} then update Cloudflare A -> {ip}")
                results[idx] = {"source": source, "target": target, "ip": ip,
                                  "status": "DRYRUN", "note": "no changes made"}
                return None

            user, key, err = _connect_or_fail(ip, profile, log, label)
            if not user:
                results[idx] = {"source": source, "target": target, "ip": ip,
                                  "status": "FAIL", "note": err}
                return None

            rc, output = ssh_ops.run_remote(
                # 180s (was 60s): wptt-xoa-website's removal path now runs
                # inside this call when overwriting an existing target - it
                # does more work than the old hand-rolled cleanup (chroot
                # unmount, OLS namespace teardown, certbot revoke over the
                # network), so the old 60s margin got tighter, not looser.
                ip, user, key, CLONE_SCRIPT, args=[source, target], use_sudo=True, timeout=180
            )
            for line in output.splitlines():
                log(f"    {line}")

            if rc == 0:
                log(f"[ ok ] {label}: clone dispatched")
                dns_status, dns_note = cf_ops.update_domain_ip(target, ip, log)
                note = "clone dispatched (runs in background on server)"
                if dns_status == "error":
                    note += f"; DNS NOT updated: {dns_note}"

                return {
                    "idx": idx, "source": source, "target": target, "ip": ip,
                    "user": user, "key": key, "note": note,
                    "dns_status": dns_status, "dns_note": dns_note,
                }
            elif rc == 11:
                log(f"[fail] {label}: target is primary website, refused")
                results[idx] = {"source": source, "target": target, "ip": ip,
                                  "status": "FAIL", "note": "target is primary website"}
            else:
                reason = next(
                    (l.replace("[fail]", "").strip() for l in output.splitlines() if "[fail]" in l),
                    f"exit {rc}",
                )
                log(f"[fail] {label}: {reason}")
                results[idx] = {"source": source, "target": target, "ip": ip,
                                  "status": "FAIL", "note": reason}
            return None
        except Exception as exc:
            # A single entry's unexpected error (bad SSH connection, malformed
            # API response, etc.) must never abort the whole batch - without
            # this, one bad entry among N would raise past this loop, the job
            # would be marked "failed" with an empty result_json (job_service.
            # run_job only ever writes result_json on the success path), and
            # the frontend (gated on job.status === 'success') would show NO
            # results at all - not even for entries that already succeeded.
            log(f"[fail] {label}: unexpected error - {exc}")
            results[idx] = {"source": source, "target": target, "ip": ip,
                              "status": "FAIL", "note": f"unexpected error: {exc}"}
            return None

    def _verify_chunk(pending: list[dict]) -> None:
        # wptt-sao-chep-website (the clone tool dispatched above) does NOT
        # restart LiteSpeed itself after writing the new vhost config,
        # unlike wptt-themwebsite (create-wpsite) - confirmed live
        # 2026-08-21: a freshly cloned domain had working files/DB but
        # 404'd indefinitely because the already-running lshttpd workers
        # never picked up the new vhost. wptt's own server-side cron
        # eventually restarts LiteSpeed on its own (every 3 min, if it
        # notices a newer .htaccess), but that's slower than this
        # function's 90s poll budget, hence restarting explicitly here.
        # All entries in one chunk share the same server (chunks are
        # carved out of a per-IP group in _run_server_group), so one
        # restart covers the whole chunk. ssh_ops.restart_litespeed
        # debounces this against other jobs hitting the same server
        # around the same time (see its docstring for why that matters -
        # colliding with wptt's own cron logged a scary but harmless
        # "Fatal error in configuration" for the admin console).
        first = pending[0]
        ssh_ops.restart_litespeed(first["ip"], first["user"], first["key"], log)

        log(f"[info] đang chờ {len(pending)} site lên (tối đa 90s, kiểm tra song song)...")
        verify_by_target = verify_ops.poll_http_via_ssh_batch(
            [{"ip": p["ip"], "user": p["user"], "key": p["key"], "domain": p["target"]} for p in pending]
        )
        for p in pending:
            verify = verify_by_target.get(p["target"], {"http_status": 0, "ok": False, "note": "không kiểm tra được"})
            label = f"{p['source']} -> {p['target']} ({p['ip']})"
            log(f"[{'ok' if verify['ok'] else 'info'}] {label}: {verify['note']}")
            results[p["idx"]] = {
                "source": p["source"], "target": p["target"], "ip": p["ip"],
                "status": "OK", "note": p["note"],
                "dns_status": p["dns_status"], "dns_note": p["dns_note"],
                "verify": verify,
            }

    def _run_server_group(group: list[tuple[int, dict]]) -> None:
        concurrency = _clone_concurrency(group[0][1].get("profile", ""))
        for i in range(0, len(group), concurrency):
            chunk = group[i:i + concurrency]
            pending = [p for idx, e in chunk if (p := _dispatch_one(idx, e))]
            if pending:
                _verify_chunk(pending)

    groups = defaultdict(list)
    for idx, e in enumerate(entries):
        groups[e.get("ip", "?")].append((idx, e))

    with ThreadPoolExecutor(max_workers=max(1, len(groups))) as pool:
        futures = [pool.submit(_run_server_group, group) for group in groups.values()]
        for future in as_completed(futures):
            future.result()  # surface any escaped exception instead of swallowing it

    return results


def remove_wpsite(entries: list[dict], log, dry_run: bool = False) -> list[dict]:
    """entries: [{"profile", "ip", "domain"}]"""
    results = []
    for e in entries:
        domain, ip = e.get("domain", "?"), e.get("ip", "?")
        label = f"{domain} ({ip})"
        try:
            profile = e["profile"]

            if not is_valid_domain(domain):
                log(f"[fail] {label}: invalid domain format")
                results.append({"domain": domain, "ip": ip, "status": "FAIL", "note": "invalid domain format"})
                continue

            if dry_run:
                log(f"[dry-run] would remove {label} (drop DB, delete files, revoke SSL)")
                results.append({"domain": domain, "ip": ip, "status": "DRYRUN", "note": "no changes made"})
                continue

            user, key, err = _connect_or_fail(ip, profile, log, label)
            if not user:
                results.append({"domain": domain, "ip": ip, "status": "FAIL", "note": err})
                continue

            rc, output = ssh_ops.run_remote(
                # 180s (was 60s) - same reasoning as CLONE_SCRIPT above.
                ip, user, key, REMOVE_SCRIPT, args=[domain], use_sudo=True, timeout=180
            )
            result_line = next((l for l in output.splitlines() if l.startswith("RESULT|")), None)
            if result_line:
                parts = result_line.split("|")
                status, note = (parts[1], parts[3]) if len(parts) > 3 else ("FAIL", "unexpected output")
            else:
                status, note = "FAIL", f"no result (exit {rc})"

            status_out = {"OK": "OK", "NOTFOUND": "SKIP"}.get(status, "FAIL")
            log(f"[{status_out.lower()}] {label}: {note}")
            result = {"domain": domain, "ip": ip, "status": status_out, "note": note}

            if status_out == "OK":
                # Confirm the vhost is really gone rather than trusting the
                # script's exit status alone - a partially-failed cleanup
                # (e.g. webroot deleted but the vhost config line still
                # there) can leave the domain still answering with a
                # broken/stale response instead of truly disappearing.
                http_status, still_up = verify_ops.check_http_via_ssh(ip, user, key, domain)
                verify = (
                    {"http_status": http_status, "gone": True, "note": "đã gỡ - không còn phản hồi"}
                    if not still_up
                    else {"http_status": http_status, "gone": False, "note": f"vẫn còn phản hồi HTTP {http_status} - kiểm tra lại vhost"}
                )
                log(f"[{'ok' if verify['gone'] else 'fail'}] {label}: {verify['note']}")
                result["verify"] = verify

            results.append(result)
        except Exception as exc:
            log(f"[fail] {label}: unexpected error - {exc}")
            results.append({"domain": domain, "ip": ip, "status": "FAIL", "note": f"unexpected error: {exc}"})
    return results


def change_wppass(entries: list[dict], log, dry_run: bool = False) -> list[dict]:
    """entries: [{"profile", "ip", "domain", "new_password", "server_name"}].
    server_name is echoed back on every result row (not used for the SSH
    call itself, which only needs ip/profile) so the caller can auto-save
    (domain, server_name) -> credentials without re-resolving it."""
    results = []
    for e in entries:
        domain, ip = e.get("domain", "?"), e.get("ip", "?")
        server_name = e.get("server_name", "?")
        label = f"{domain} ({ip})"
        try:
            profile, password = e["profile"], e["new_password"]

            if not is_valid_domain(domain):
                log(f"[fail] {label}: invalid domain format")
                results.append({"domain": domain, "ip": ip, "server_name": server_name, "admin": "-",
                                  "status": "FAIL", "note": "invalid domain format"})
                continue

            if dry_run:
                log(f"[dry-run] would change admin password for {label}")
                results.append({"domain": domain, "ip": ip, "server_name": server_name, "admin": "-",
                                  "status": "DRYRUN", "note": "no changes made"})
                continue

            user, key, err = _connect_or_fail(ip, profile, log, label)
            if not user:
                results.append({"domain": domain, "ip": ip, "server_name": server_name, "admin": "-",
                                  "status": "FAIL", "note": err})
                continue

            rc, output = ssh_ops.run_remote(
                ip, user, key, CHANGEPASS_SCRIPT, args=[domain, password, ""], use_sudo=True, timeout=30
            )
            result_line = next((l for l in output.splitlines() if l.startswith("RESULT|")), None)
            if result_line:
                parts = result_line.split("|")
                status = parts[1] if len(parts) > 1 else "FAIL"
                admin = parts[3] if len(parts) > 3 else "-"
                note = parts[5] if len(parts) > 5 else ""
            else:
                status, admin, note = "FAIL", "-", f"no result (exit {rc})"

            if status == "OK":
                log(f"[ ok ] {label}: admin={admin}")
                # WP-CLI reporting success doesn't guarantee the site itself
                # is still healthy - confirm it's still serving before
                # handing the new password to whoever's waiting on it.
                http_status, ok = verify_ops.check_http_via_ssh(ip, user, key, domain)
                verify = {"http_status": http_status, "ok": ok,
                           "note": f"site vẫn sống (HTTP {http_status})" if ok else f"site không phản hồi (HTTP {http_status}) sau khi đổi mật khẩu"}
                log(f"[{'ok' if ok else 'warn'}] {label}: {verify['note']}")
                results.append({"domain": domain, "ip": ip, "server_name": server_name, "admin": admin,
                                  "status": "OK", "note": "password updated", "new_password": password,
                                  "verify": verify})
            else:
                log(f"[fail] {label}: {note}")
                results.append({"domain": domain, "ip": ip, "server_name": server_name, "admin": admin,
                                  "status": "FAIL", "note": note})
        except Exception as exc:
            log(f"[fail] {label}: unexpected error - {exc}")
            results.append({"domain": domain, "ip": ip, "server_name": server_name, "admin": "-",
                              "status": "FAIL", "note": f"unexpected error: {exc}"})
    return results
