import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.config import settings
from app.ops import cf_ops, firewall_ops, ssh_ops, verify_ops
from app.ops.validation import is_valid_domain

# Ported from a working manual script (migrate1.py) that already moved
# real sites ali_enterprise -> gcp_enterprise. Two fixes made while porting:
#
# 1. Domain/IP values are passed as $1/$2/... positional args (shlex-quoted
#    by ssh_ops.run_remote), never f-string-interpolated into the script
#    text - matches every other *_SCRIPT in this codebase (see the header
#    comment in wp_ops.py for why).
# 2. The DB dump used to land at $WP_PATH/giatuan-wptangtoc.sql, i.e. INSIDE
#    the served webroot (html/), and was never cleaned up on the SOURCE
#    server after rsync - a raw SQL dump (passwords included) sitting in a
#    publicly-served path for the duration of the transfer. Moved one level
#    up (still inside the domain dir rsync copies wholesale, just outside
#    html/, so it's never web-accessible) and now removed on both sides via
#    `trap ... EXIT` so it's gone even if a step fails midway.

# No args. Runs on SOURCE. Generates a per-server SSH keypair on demand
# (idempotent) and prints its pubkey - this is the identity temporarily
# trusted on the destination for the rsync transfer, not this app's own
# management-plane SSH key.
GET_PUBKEY_SCRIPT = """#!/bin/bash
if [[ ! -f /root/.ssh/id_ed25519 ]]; then
    ssh-keygen -t ed25519 -f /root/.ssh/id_ed25519 -N "" -q
fi
cat /root/.ssh/id_ed25519.pub
"""

# $1 = pubkey. Runs on DEST. Some fresh cloud images only have an
# authorized_keys under the default cloud-init user (e.g. ubuntu), not
# root - bootstrap root's from that if root's doesn't exist yet.
ADD_PUBKEY_SCRIPT = """#!/bin/bash
PUBKEY="$1"
mkdir -p /root/.ssh
chmod 700 /root/.ssh
if [[ ! -f /root/.ssh/authorized_keys && -f /home/ubuntu/.ssh/authorized_keys ]]; then
    cp /home/ubuntu/.ssh/authorized_keys /root/.ssh/authorized_keys
    chmod 600 /root/.ssh/authorized_keys
fi
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
if ! grep -qF "$PUBKEY" /root/.ssh/authorized_keys; then
    echo "$PUBKEY" >> /root/.ssh/authorized_keys
    echo "KEY_ADDED"
else
    echo "KEY_EXISTS"
fi
"""

# $1 = pubkey. Runs on DEST. grep -vF (literal match) instead of sed avoids
# having to escape the slashes/dots in an ssh-ed25519 pubkey string.
REMOVE_PUBKEY_SCRIPT = """#!/bin/bash
PUBKEY="$1"
if [[ -f /root/.ssh/authorized_keys ]]; then
    grep -vF "$PUBKEY" /root/.ssh/authorized_keys > /root/.ssh/authorized_keys.tmp 2>/dev/null || true
    mv /root/.ssh/authorized_keys.tmp /root/.ssh/authorized_keys
fi
echo "KEY_REMOVED"
"""

# $1 = domain, $2 = dest ip, $3 = dest ssh user (rsync's own transfer,
# always root - separate from whatever user this app's management SSH
# used to reach dest). Runs on SOURCE via the temp trust set up above.
RSYNC_SCRIPT = """#!/bin/bash
set -euo pipefail
DOMAIN="$1"
DST_IP="$2"
DST_USER="$3"
WP_PATH="/usr/local/lsws/$DOMAIN/html"
SQL_FILE="/usr/local/lsws/$DOMAIN/giatuan-wptangtoc.sql"

trap 'rm -f "$SQL_FILE"' EXIT

echo "[1/3] Checking WordPress at $WP_PATH..."
if [[ ! -f "$WP_PATH/wp-config.php" ]]; then
    echo "RESULT|FAIL|wp-config.php not found"
    exit 1
fi

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

echo "[2/3] Reading DB credentials..."
DB_USER=$(wp config get DB_USER --path="$WP_PATH" --allow-root 2>/dev/null)
DB_PASS=$(wp config get DB_PASSWORD --path="$WP_PATH" --allow-root 2>/dev/null)
DB_NAME=$(wp config get DB_NAME --path="$WP_PATH" --allow-root 2>/dev/null)

if [[ -z "$DB_USER" ]]; then
    echo "RESULT|FAIL|Cannot get DB credentials"
    exit 1
fi

mariadb-dump -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" > "$SQL_FILE" 2>/dev/null \\
  || mysqldump -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" > "$SQL_FILE"

SIZE=$(du -k "$SQL_FILE" | cut -f1)
if [[ "$SIZE" -lt 5 ]]; then
    echo "RESULT|FAIL|DB dump too small (${SIZE}KB)"
    exit 1
fi

echo "[3/3] Rsyncing $DOMAIN -> $DST_IP..."
rsync -avzh \\
    --exclude="/$DOMAIN/bin" --exclude="/$DOMAIN/sbin" \\
    --exclude="/$DOMAIN/lib" --exclude="/$DOMAIN/lib64" \\
    --exclude="/$DOMAIN/usr" --exclude="/$DOMAIN/dev" \\
    --exclude="/$DOMAIN/etc" --exclude="/$DOMAIN/tmp" \\
    --exclude="/$DOMAIN/var" --exclude="/$DOMAIN/passwd" \\
    --exclude="/$DOMAIN/html/phpmyadmin" \\
    --exclude="/$DOMAIN/html/quan-ly-files" \\
    --exclude="/$DOMAIN/.cron_spool" --exclude="/$DOMAIN/.bash*" \\
    --exclude="/$DOMAIN/.lsns" --exclude="/$DOMAIN/luucache" \\
    --exclude="/$DOMAIN/logs" --exclude="/$DOMAIN/backup-website" \\
    -e "ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null" \\
    "/usr/local/lsws/$DOMAIN" "$DST_USER@$DST_IP:/usr/local/lsws"

echo "RESULT|OK|rsync done"
"""

# $1 = domain. Runs on DEST after rsync landed the domain dir (including
# the sibling SQL dump) there. Mirrors wptt's own site-creation steps
# instead of hand-rolling vhost/DB setup, same reasoning as CLONE_SCRIPT.
IMPORT_SCRIPT = """#!/bin/bash
set -euo pipefail
DOMAIN="$1"
WP_PATH="/usr/local/lsws/$DOMAIN/html"
SQL_FILE="/usr/local/lsws/$DOMAIN/giatuan-wptangtoc.sql"

if [[ ! -f "$WP_PATH/wp-config.php" ]]; then
    echo "RESULT|FAIL|wp-config.php not found on dst (rsync may have failed)"
    exit 1
fi
if [[ ! -f "$SQL_FILE" ]]; then
    echo "RESULT|FAIL|SQL file not found: $SQL_FILE"
    exit 1
fi

SQL_SIZE=$(du -k "$SQL_FILE" | cut -f1)
if [[ "$SQL_SIZE" -lt 5 ]]; then
    echo "RESULT|FAIL|SQL file too small (${SQL_SIZE}KB) - dump may be corrupt"
    exit 1
fi
echo "  SQL ready: ${SQL_SIZE}KB"

if [[ ! -f "/etc/wptt/vhost/.$DOMAIN.conf" ]]; then
    echo "[1/5] Creating vhost for $DOMAIN..."
    bash /etc/wptt/domain/wptt-themwebsite "$DOMAIN" >/dev/null 2>&1
    rm -f "$WP_PATH/index.html" 2>/dev/null || true
else
    echo "[1/5] Vhost already exists for $DOMAIN - skipping wptt-themwebsite"
fi

if [[ ! -f "/etc/wptt/vhost/.$DOMAIN.conf" ]]; then
    echo "RESULT|FAIL|wptt-themwebsite failed - vhost config not created"
    exit 1
fi

echo "[2/5] Loading DB credentials..."
unset DB_Name_web DB_User_web DB_Password_web User_name_vhost phien_ban_php_domain
unset database_admin_username database_admin_password

. "/etc/wptt/vhost/.$DOMAIN.conf" 2>/dev/null
. "/etc/wptt/.wptt.conf" 2>/dev/null

if [[ -z "${DB_Name_web:-}" || -z "${DB_User_web:-}" || -z "${DB_Password_web:-}" ]]; then
    echo "RESULT|FAIL|Cannot load DB credentials from vhost config"
    exit 1
fi
if [[ -z "${database_admin_username:-}" || -z "${database_admin_password:-}" ]]; then
    echo "RESULT|FAIL|Cannot load admin credentials from /etc/wptt/.wptt.conf"
    exit 1
fi
echo "  DB_Name=${DB_Name_web}"

# DB_Password_web can be AES-encrypted (wptt-themwebsite encrypts it before
# writing to the vhost conf; wptt-ket-noi decrypts it via wptt_giai_ma before
# writing wp-config.php). CREATE USER below needs the same decrypted plaintext
# - using the raw value literally sets the MySQL password to the ciphertext
# string itself, which then never matches what wp-config.php actually has,
# breaking every fresh migrate with "Error establishing a database connection"
# (site-trang.com only worked by coincidence - its old, pre-encryption conf
# stores a plain password, so there was nothing to decrypt).
. /etc/wptt/core-functions 2>/dev/null
if declare -F wptt_giai_ma >/dev/null 2>&1; then
    DB_Password_plain=$(wptt_giai_ma "$DB_Password_web" 2>/dev/null)
fi
[[ -z "${DB_Password_plain:-}" ]] && DB_Password_plain="$DB_Password_web"

TEMP_CNF=$(mktemp)
chmod 600 "$TEMP_CNF"
cat >"$TEMP_CNF" <<MARIADB_EOF
[client]
user=${database_admin_username}
password=${database_admin_password}
host=localhost
max_allowed_packet=1G
default-character-set=utf8mb4

[mysqldump]
quick
quote-names
max_allowed_packet=1G
MARIADB_EOF
trap 'rm -f "$TEMP_CNF" "$SQL_FILE"' EXIT

echo "[3/5] Preparing database ${DB_Name_web}..."
mariadb --defaults-extra-file="$TEMP_CNF" --ssl-verify-server-cert=false \\
    -e "DROP DATABASE IF EXISTS \\`${DB_Name_web}\\`; \\
        CREATE DATABASE \\`${DB_Name_web}\\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null

mariadb --defaults-extra-file="$TEMP_CNF" --ssl-verify-server-cert=false \\
    -e "DROP USER IF EXISTS '${DB_User_web}'@'localhost'; \\
        CREATE USER '${DB_User_web}'@'localhost' IDENTIFIED BY '${DB_Password_plain}'; \\
        GRANT ALL PRIVILEGES ON \\`${DB_Name_web}\\`.* TO '${DB_User_web}'@'localhost'; \\
        FLUSH PRIVILEGES;" 2>/dev/null

echo "  Importing SQL (${SQL_SIZE}KB)..."
(
    echo "SET FOREIGN_KEY_CHECKS=0; SET UNIQUE_CHECKS=0; SET AUTOCOMMIT=0;"
    cat "$SQL_FILE"
    echo "COMMIT; SET FOREIGN_KEY_CHECKS=1; SET UNIQUE_CHECKS=1; SET AUTOCOMMIT=1;"
) | mariadb --defaults-extra-file="$TEMP_CNF" --ssl-verify-server-cert=false \\
    "${DB_Name_web}" 2>/dev/null
echo "  SQL imported OK"

echo "[4/5] Fixing wp-config.php (wptt-ket-noi)..."
if ! bash /etc/wptt/db/wptt-ket-noi "$DOMAIN" >/dev/null 2>&1; then
    echo "  [warn] wptt-ket-noi exited non-zero for $DOMAIN - not treated as fatal here,"
    echo "  the [6/6] check below verifies the actual outcome (a non-zero exit here isn't"
    echo "  a fully trusted signal on its own, but silently discarding it like before is worse)"
fi

echo "[5/5] Fixing permissions (wptt-phanquyen)..."
if ! bash /etc/wptt/wptt-phanquyen "$DOMAIN" >/dev/null 2>&1; then
    echo "  [warn] wptt-phanquyen exited non-zero for $DOMAIN"
fi

rm -rf "/usr/local/lsws/$DOMAIN/luucache" 2>/dev/null || true

# [6/6] Real outcome check, not trusting wptt-ket-noi's exit code alone: this
# is the same class of bug as the DB_Password_web/AES incident (job #2788) -
# re-reads whatever wp-config.php actually ended up with and tries to log in
# with it, instead of assuming the earlier steps worked because they didn't
# error. Also re-checks the vhost conf file itself still exists, since its
# disappearance after a successful [1/5] is the still-unexplained failure
# mode found in production 2026-09 (202 domains needed manual repair) -
# this at least turns a silent recurrence into an immediate RESULT|FAIL
# instead of a days-later discovery via the backup script.
echo "[6/6] Verifying vhost + DB credentials actually work..."
if [[ ! -f "/etc/wptt/vhost/.$DOMAIN.conf" ]]; then
    echo "RESULT|FAIL|vhost config disappeared after import (was present at step 1, gone now)"
    exit 1
fi

WP_DB_NAME=$(grep -oP "define\\(\\s*'DB_NAME',\\s*'\\K[^']+" "$WP_PATH/wp-config.php" 2>/dev/null || true)
WP_DB_USER=$(grep -oP "define\\(\\s*'DB_USER',\\s*'\\K[^']+" "$WP_PATH/wp-config.php" 2>/dev/null || true)
WP_DB_PASS=$(grep -oP "define\\(\\s*'DB_PASSWORD',\\s*'\\K[^']+" "$WP_PATH/wp-config.php" 2>/dev/null || true)
if [[ -z "$WP_DB_NAME" || -z "$WP_DB_USER" || -z "$WP_DB_PASS" ]]; then
    echo "RESULT|FAIL|wp-config.php missing DB credentials after wptt-ket-noi"
    exit 1
fi
if ! mariadb -u "$WP_DB_USER" -p"$WP_DB_PASS" -h localhost "$WP_DB_NAME" -e "SELECT 1;" >/dev/null 2>&1; then
    echo "RESULT|FAIL|wp-config.php DB credentials do not authenticate (wptt-ket-noi did not apply correctly)"
    exit 1
fi

echo "RESULT|OK|$DOMAIN imported successfully (DB: ${DB_Name_web}, SQL: ${SQL_SIZE}KB)"
"""


def _throttled_rsync_logger(log):
    """Streams rsync's own output into the job log at most ~1 line every 2s,
    instead of every line - rsync -avzh emits one line per transferred file
    (confirmed in production: 16,477 of 16,503 total log lines for one real
    migrate job were exactly this, ~99.8% noise of no operational value),
    so logging every line as it streams would just flood the log live
    instead of in one batch at the end - same problem, different timing.
    RESULT|... lines always pass through immediately regardless of the
    throttle, since callers scan the log text for them synchronously right
    after the call returns."""
    last_logged = [0.0]

    def _on_line(line):
        now = time.monotonic()
        if line.startswith("RESULT|") or now - last_logged[0] >= 2:
            log(f"    {line}")
            last_logged[0] = now

    return _on_line


def _connect_or_fail(ip, profile, log, label):
    user, key, err = ssh_ops.establish_connection(ip, profile)
    if not user:
        log(f"[fail] {label}: {err}")
        return None, None, err
    return user, key, None


def migrate_wpsite(
    entries: list[dict], log, dry_run: bool = False,
    on_start=lambda domain: None, on_finish=lambda domain, status, note="": None,
) -> list[dict]:
    """entries: [{"domain", "source_ip", "source_profile", "dest_ip", "dest_profile"}]

    Grouped by (source_ip, dest_ip) pair - each pair does a one-time setup
    (temporary SSH trust from source to dest, GCP firewall whitelist if the
    destination needs one - see firewall_ops) then migrates every domain
    in the pair sequentially (DB dump + full file rsync is I/O-heavy, same
    reasoning as clone/restore), then a one-time teardown in `finally` so
    the temp trust/firewall hole never outlives the job even on failure.
    Different pairs share nothing and run fully in parallel."""
    results: list[dict | None] = [None] * len(entries)

    groups = defaultdict(list)
    for idx, e in enumerate(entries):
        groups[(e.get("source_ip", "?"), e.get("dest_ip", "?"))].append((idx, e))

    def _run_group(group: list[tuple[int, dict]]) -> None:
        first = group[0][1]
        source_ip, dest_ip = first["source_ip"], first["dest_ip"]
        source_profile, dest_profile = first["source_profile"], first["dest_profile"]
        # Echoed back on every result row so the frontend's "Xoá nguồn"
        # button can disambiguate remove-wpsite's server pick without a
        # second lookup - see RemoveWpsiteRequest.server_names in jobs.py.
        source_server_name = first.get("source_server_name", "")

        valid = []
        for idx, e in group:
            domain = e.get("domain", "?")
            if not is_valid_domain(domain):
                log(f"[fail] {domain}: invalid domain format")
                results[idx] = {"domain": domain, "source_ip": source_ip, "dest_ip": dest_ip, "source_server": source_server_name,
                                  "status": "FAIL", "note": "invalid domain format"}
                on_finish(domain, "failed", "invalid domain format")
                continue
            valid.append((idx, e))
        if not valid:
            return

        if dry_run:
            for idx, e in valid:
                domain = e["domain"]
                log(f"[dry-run] would migrate {domain}: {source_ip} -> {dest_ip}")
                results[idx] = {"domain": domain, "source_ip": source_ip, "dest_ip": dest_ip, "source_server": source_server_name,
                                  "status": "DRYRUN", "note": "no changes made"}
            return

        try:
            src_user, src_key, err = _connect_or_fail(source_ip, source_profile, log, f"source {source_ip}")
            if not src_user:
                for idx, e in valid:
                    results[idx] = {"domain": e["domain"], "source_ip": source_ip, "dest_ip": dest_ip, "source_server": source_server_name,
                                      "status": "FAIL", "note": f"source connect failed: {err}"}
                    on_finish(e["domain"], "failed", f"source connect failed: {err}")
                return

            dst_user, dst_key, err = _connect_or_fail(dest_ip, dest_profile, log, f"dest {dest_ip}")
            if not dst_user:
                for idx, e in valid:
                    results[idx] = {"domain": e["domain"], "source_ip": source_ip, "dest_ip": dest_ip, "source_server": source_server_name,
                                      "status": "FAIL", "note": f"dest connect failed: {err}"}
                    on_finish(e["domain"], "failed", f"dest connect failed: {err}")
                return

            # ---- SETUP (once per pair): temporary SSH trust source -> dest ----
            log(f"[info] {source_ip} -> {dest_ip}: setting up temporary SSH trust...")
            rc, pubkey_out = ssh_ops.run_remote(source_ip, src_user, src_key, GET_PUBKEY_SCRIPT,
                                                  use_sudo=True, timeout=30)
            pubkey = next((l for l in pubkey_out.splitlines() if l.startswith("ssh-")), None)
            if rc != 0 or not pubkey:
                for idx, e in valid:
                    results[idx] = {"domain": e["domain"], "source_ip": source_ip, "dest_ip": dest_ip, "source_server": source_server_name,
                                      "status": "FAIL", "note": "could not get source SSH pubkey"}
                    on_finish(e["domain"], "failed", "could not get source SSH pubkey")
                return

            rc, _out = ssh_ops.run_remote(dest_ip, dst_user, dst_key, ADD_PUBKEY_SCRIPT,
                                            args=[pubkey], use_sudo=True, timeout=30)
            if rc != 0:
                for idx, e in valid:
                    results[idx] = {"domain": e["domain"], "source_ip": source_ip, "dest_ip": dest_ip, "source_server": source_server_name,
                                      "status": "FAIL", "note": "could not add source key to dest authorized_keys"}
                    on_finish(e["domain"], "failed", "could not add source key to dest authorized_keys")
                return
            log(f"[ ok ] {source_ip} -> {dest_ip}: SSH trust established")

            if not firewall_ops.add_ip(dest_profile, source_ip, log):
                for idx, e in valid:
                    results[idx] = {"domain": e["domain"], "source_ip": source_ip, "dest_ip": dest_ip, "source_server": source_server_name,
                                      "status": "FAIL", "note": "could not open destination GCP firewall for source IP"}
                    on_finish(e["domain"], "failed", "could not open destination firewall for source IP")
                ssh_ops.run_remote(dest_ip, dst_user, dst_key, REMOVE_PUBKEY_SCRIPT,
                                     args=[pubkey], use_sudo=True, timeout=30)
                return

            try:
                # ---- MIGRATE DOMAINS (bounded parallel - see
                # ssh_migrate_workers/wptt_create_lock for why this is safe:
                # rsync runs freely in parallel, IMPORT_SCRIPT is serialized
                # per destination IP since it can call wptt-themwebsite,
                # which mutates shared server state) ----
                migrated_ok: list[tuple[int, str]] = []
                migrated_ok_lock = threading.Lock()

                def _migrate_one(idx: int, e: dict) -> None:
                    domain = e["domain"]
                    label = f"{domain} ({source_ip} -> {dest_ip})"
                    log(f"[step] {label}: migrating...")
                    on_start(domain)

                    rc, out = ssh_ops.run_remote_streaming(
                        source_ip, src_user, src_key, RSYNC_SCRIPT,
                        args=[domain, dest_ip, "root"], use_sudo=True,
                        timeout=settings.ssh_restore_timeout,
                        on_line=_throttled_rsync_logger(log),
                    )
                    if "RESULT|OK" not in out:
                        err_line = next((l for l in out.splitlines() if "RESULT|FAIL" in l), f"exit {rc}")
                        log(f"[fail] {label}: rsync failed - {err_line}")
                        results[idx] = {"domain": domain, "source_ip": source_ip, "dest_ip": dest_ip, "source_server": source_server_name,
                                          "status": "FAIL", "note": f"rsync: {err_line}"}
                        on_finish(domain, "failed", f"rsync: {err_line}")
                        return

                    with ssh_ops.wptt_create_lock(dest_ip):
                        rc, out = ssh_ops.run_remote(
                            dest_ip, dst_user, dst_key, IMPORT_SCRIPT,
                            args=[domain], use_sudo=True, timeout=600,
                        )
                    for line in out.splitlines():
                        log(f"    {line}")
                    if "RESULT|OK" not in out:
                        err_line = next((l for l in out.splitlines() if "RESULT|FAIL" in l), f"exit {rc}")
                        log(f"[fail] {label}: import failed - {err_line}")
                        results[idx] = {"domain": domain, "source_ip": source_ip, "dest_ip": dest_ip, "source_server": source_server_name,
                                          "status": "FAIL", "note": f"import: {err_line}"}
                        on_finish(domain, "failed", f"import: {err_line}")
                        return

                    log(f"[ ok ] {label}: files + DB migrated")
                    with migrated_ok_lock:
                        migrated_ok.append((idx, domain))

                with ThreadPoolExecutor(max_workers=settings.ssh_migrate_workers) as domain_pool:
                    domain_futures = [domain_pool.submit(_migrate_one, idx, e) for idx, e in valid]
                    for f in as_completed(domain_futures):
                        f.result()

                if not migrated_ok:
                    return

                # ---- RESTART LSWS ONCE (debounced against other jobs on the
                # same server - see ssh_ops.restart_litespeed) ----
                ssh_ops.restart_litespeed(dest_ip, dst_user, dst_key, log)

                # ---- VERIFY FIRST (before touching DNS) ----
                # check_http_via_ssh curls the destination directly over SSH
                # with --resolve, so it works regardless of what public DNS
                # currently points at - no need to cut over first to check.
                # Verifying before the DNS change means a site that's broken
                # on the destination (e.g. the 7mcn.mobile PHP hang incident)
                # never gets real traffic pointed at it in the first place;
                # the source keeps serving it untouched until re-run.
                #
                # Uses poll_http_via_ssh_batch (retries up to 90s, all domains
                # concurrently) instead of one immediate single-shot check per
                # domain, run sequentially - a single 10s curl right after
                # LSWS restart was catching brand-new HTTPS vhosts still cold
                # (real first-connect latency seen live: ~14s) as false
                # "không phản hồi", skipping their DNS cutover for nothing.
                # Safe to key results by domain string here specifically
                # because every domain in migrated_ok shares this same
                # dest_ip (one _run_group call = one source/dest pair) - a
                # duplicate domain string within the group really is the
                # same target, so coalescing its result is correct, unlike
                # results[] below which stays keyed by idx.
                unique_domains = sorted({domain for _, domain in migrated_ok})
                batch_results = verify_ops.poll_http_via_ssh_batch(
                    [{"ip": dest_ip, "user": dst_user, "key": dst_key, "domain": d} for d in unique_domains],
                )
                verify_results: dict[int, dict] = {}
                for idx, domain in migrated_ok:
                    verify_results[idx] = batch_results[domain]
                    log(f"[{'ok' if verify_results[idx]['ok'] else 'warn'}] {domain}: {verify_results[idx]['note']}")

                # ---- DNS (bulk, reuses cf_ops.change_ip) - only for domains
                # that verified OK ----
                verified_domains = [d for idx, d in migrated_ok if verify_results[idx]["ok"]]
                cf_results = {r["domain"]: r for r in cf_ops.change_ip(verified_domains, dest_ip, log, dry_run=False)} if verified_domains else {}

                # ---- BUILD RESULTS ----
                for idx, domain in migrated_ok:
                    verify = verify_results[idx]
                    if verify["ok"]:
                        cf = cf_results.get(domain, {"status": "error", "note": "no result"})
                        results[idx] = {
                            "domain": domain, "source_ip": source_ip, "dest_ip": dest_ip, "source_server": source_server_name,
                            "status": "OK",
                            "cf_dns": cf.get("status", "?"), "verify": verify,
                            "note": "",
                        }
                        on_finish(domain, "success", verify["note"])
                    else:
                        note = "site không phản hồi HTTP sau migrate - DNS KHÔNG đổi, nguồn vẫn phục vụ traffic. Kiểm tra rồi chạy lại."
                        results[idx] = {
                            "domain": domain, "source_ip": source_ip, "dest_ip": dest_ip, "source_server": source_server_name,
                            "status": "PARTIAL",
                            "cf_dns": "skipped - site chưa lên, không đổi DNS để tránh gây gián đoạn", "verify": verify,
                            "note": note,
                        }
                        # Files+DB did complete - "PARTIAL" is a verification
                        # caveat (site not responding, DNS deliberately left
                        # untouched), not a failed migration, so this counts
                        # as a finished target for progress-bar purposes.
                        on_finish(domain, "success", note)
            finally:
                # ---- CLEANUP (always, even on error) ----
                log(f"[info] {source_ip} -> {dest_ip}: cleaning up temporary access...")
                ssh_ops.run_remote(dest_ip, dst_user, dst_key, REMOVE_PUBKEY_SCRIPT,
                                     args=[pubkey], use_sudo=True, timeout=30)
                firewall_ops.remove_ip(dest_profile, source_ip, log)
        except Exception as exc:
            log(f"[fail] {source_ip} -> {dest_ip}: unexpected error - {exc}")
            for idx, e in valid:
                if results[idx] is None:
                    results[idx] = {"domain": e["domain"], "source_ip": source_ip, "dest_ip": dest_ip, "source_server": source_server_name,
                                      "status": "FAIL", "note": f"unexpected error: {exc}"}
                    on_finish(e["domain"], "failed", f"unexpected error: {exc}")

    with ThreadPoolExecutor(max_workers=max(1, len(groups))) as pool:
        futures = [pool.submit(_run_group, group) for group in groups.values()]
        for future in as_completed(futures):
            future.result()

    return results
