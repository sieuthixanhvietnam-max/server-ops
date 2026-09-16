from concurrent.futures import ThreadPoolExecutor, as_completed

from app.config import settings
from app.ops import ssh_ops, verify_ops

# Adapted from the standalone wptt-restore-r2.sh CLI script
# (python3/wptt-restore-r2.sh). Key differences from the original:
#   - The interactive `read -p "Xác nhận restore?"` prompt is removed - the
#     app's own ConfirmDangerModal is the confirmation gate instead, and a
#     one-shot SSH command can't service an interactive stdin prompt anyway.
#   - A final `RESULT|...` line is appended so the Python side can parse the
#     outcome reliably, same convention as wp_ops.py's REMOVE_SCRIPT.
#   - R2 credentials (including DB_ADMIN_PASS) are read from
#     /etc/wptt/backup-r2.conf ON THE TARGET SERVER, exactly like the
#     original script - this app never stores or transmits them.

# $1 = domain, $2 = source_server, $3 = date (empty = latest)
VERIFY_SCRIPT = """#!/bin/bash
DOMAIN="$1"
SRC_SERVER="$2"
DATE="$3"
if [[ ! -f /etc/wptt/backup-r2.conf ]]; then
    echo "ERR|no_config|backup-r2.conf not found on this server"
    exit 10
fi
if ! command -v rclone &>/dev/null; then
    echo "ERR|no_rclone|rclone not found on this server"
    exit 11
fi
source /etc/wptt/backup-r2.conf
export RCLONE_CONFIG_R2_TYPE="s3"
export RCLONE_CONFIG_R2_PROVIDER="Cloudflare"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"

if [[ -z "$DATE" ]]; then
    DATE=$(rclone lsd "r2:$R2_BUCKET/$SRC_SERVER/$DOMAIN/" 2>/dev/null | awk '{print $NF}' | sort -r | head -1)
    [[ -z "$DATE" ]] && { echo "ERR|not_found|no backup found for $DOMAIN on $SRC_SERVER"; exit 12; }
fi

R2_PATH="r2:$R2_BUCKET/$SRC_SERVER/$DOMAIN/$DATE"
LISTING=$(rclone ls "$R2_PATH/" 2>/dev/null)
if [[ -z "$LISTING" ]]; then
    echo "ERR|not_found|backup not found at $R2_PATH"
    exit 13
fi
echo "DATE_USED|$DATE"
echo "LISTING_START"
echo "$LISTING"
echo "LISTING_END"
"""

# $1 = domain, $2 = source_server, $3 = date (empty = latest)
RESTORE_SCRIPT = """#!/bin/bash
set -uo pipefail
CONFIG_FILE="/etc/wptt/backup-r2.conf"
if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "RESULT|FAIL|no_config|backup-r2.conf not found"
    exit 10
fi
source "$CONFIG_FILE"
for VAR in R2_BUCKET R2_ENDPOINT R2_ACCESS_KEY R2_SECRET_KEY; do
    [[ -z "${!VAR:-}" ]] && { echo "RESULT|FAIL|no_config|$VAR not set in $CONFIG_FILE"; exit 10; }
done
DB_ADMIN_USER="${DB_ADMIN_USER:-wordpressadmin}"
DB_ADMIN_PASS="${DB_ADMIN_PASS:-}"
[[ -z "$DB_ADMIN_PASS" ]] && { echo "RESULT|FAIL|no_config|DB_ADMIN_PASS not set in $CONFIG_FILE"; exit 10; }

TMP_BASE="/tmp/wptt-restore"
export RCLONE_CONFIG_R2_TYPE="s3"
export RCLONE_CONFIG_R2_PROVIDER="Cloudflare"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
export RCLONE_CONFIG_R2_ACL="private"

DOMAIN="$1"
SRC_SERVER="$2"
DATE="$3"

command -v rclone &>/dev/null || { echo "RESULT|FAIL|no_rclone|rclone not found"; exit 11; }

if [[ -z "$DATE" ]]; then
    DATE=$(rclone lsd "r2:$R2_BUCKET/$SRC_SERVER/$DOMAIN/" 2>/dev/null | awk '{print $NF}' | sort -r | head -1)
    [[ -z "$DATE" ]] && { echo "RESULT|FAIL|not_found|no backup found for $DOMAIN on $SRC_SERVER"; exit 12; }
fi

R2_PATH="r2:$R2_BUCKET/$SRC_SERVER/$DOMAIN/$DATE"
rclone ls "$R2_PATH/" --quiet &>/dev/null || { echo "RESULT|FAIL|not_found|backup not found: $R2_PATH"; exit 12; }

cleanup() { rm -rf "$TMP_BASE/$DOMAIN" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
mkdir -p "$TMP_BASE/$DOMAIN"

echo "[step] Downloading from R2 ($R2_PATH)..."
rclone copy "$R2_PATH/" "$TMP_BASE/$DOMAIN/" 2>&1
if [[ ! -f "$TMP_BASE/$DOMAIN/db.sql.gz" ]]; then
    echo "RESULT|FAIL|download|db.sql.gz not found after download"; exit 20
fi
if [[ ! -f "$TMP_BASE/$DOMAIN/files.tar.gz" ]]; then
    echo "RESULT|FAIL|download|files.tar.gz not found after download"; exit 20
fi
echo "[ ok ] Downloaded: DB=$(du -h $TMP_BASE/$DOMAIN/db.sql.gz | cut -f1) Files=$(du -h $TMP_BASE/$DOMAIN/files.tar.gz | cut -f1)"

echo "[step] Creating vhost..."
WP_PATH="/usr/local/lsws/$DOMAIN/html"
if [[ ! -f "/etc/wptt/vhost/.$DOMAIN.conf" ]]; then
    bash /etc/wptt/domain/wptt-themwebsite "$DOMAIN" >/dev/null 2>&1
    if [[ ! -f "/etc/wptt/vhost/.$DOMAIN.conf" ]]; then
        echo "RESULT|FAIL|vhost|wptt-themwebsite failed"; exit 21
    fi
    echo "[ ok ] Vhost created"
else
    echo "[warn] Vhost exists - overwriting"
fi

unset DB_Name_web DB_User_web DB_Password_web
source "/etc/wptt/vhost/.$DOMAIN.conf" 2>/dev/null
source "/etc/wptt/.wptt.conf" 2>/dev/null
if [[ -z "${DB_Name_web:-}" ]]; then
    echo "RESULT|FAIL|vhost|cannot load DB credentials"; exit 21
fi
echo "[ ok ] DB credentials loaded: $DB_Name_web"

echo "[step] Extracting files..."
tar -xzf "$TMP_BASE/$DOMAIN/files.tar.gz" -C / --overwrite 2>&1 | tail -5
if [[ ! -f "$WP_PATH/wp-config.php" ]]; then
    echo "RESULT|FAIL|extract|wp-config.php not found after extract"; exit 22
fi
echo "[ ok ] Files extracted"

echo "[step] Importing database..."
TEMP_CNF=$(mktemp)
chmod 600 "$TEMP_CNF"
cat > "$TEMP_CNF" << MARIADB_EOF
[client]
user=$DB_ADMIN_USER
password=$DB_ADMIN_PASS
host=localhost
max_allowed_packet=1G
default-character-set=utf8mb4
MARIADB_EOF

mariadb --defaults-extra-file="$TEMP_CNF" --ssl-verify-server-cert=false \
    -e "DROP DATABASE IF EXISTS \\`$DB_Name_web\\`;
        CREATE DATABASE \\`$DB_Name_web\\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
        DROP USER IF EXISTS '$DB_User_web'@'localhost';
        CREATE USER '$DB_User_web'@'localhost' IDENTIFIED BY '$DB_Password_web';
        GRANT ALL PRIVILEGES ON \\`$DB_Name_web\\`.* TO '$DB_User_web'@'localhost';
        FLUSH PRIVILEGES;" 2>&1

(
    echo "SET FOREIGN_KEY_CHECKS=0; SET UNIQUE_CHECKS=0; SET AUTOCOMMIT=0;"
    gunzip -c "$TMP_BASE/$DOMAIN/db.sql.gz"
    echo "COMMIT; SET FOREIGN_KEY_CHECKS=1; SET UNIQUE_CHECKS=1; SET AUTOCOMMIT=1;"
) | mariadb --defaults-extra-file="$TEMP_CNF" --ssl-verify-server-cert=false "$DB_Name_web" 2>&1

IMPORT_RC=$?
rm -f "$TEMP_CNF"
if [[ $IMPORT_RC -ne 0 ]]; then
    echo "RESULT|FAIL|db_import|mariadb import exited $IMPORT_RC"; exit 23
fi
echo "[ ok ] Database imported"

echo "[step] Fixing wp-config..."
bash /etc/wptt/db/wptt-ket-noi "$DOMAIN" >/dev/null 2>&1 || true
echo "[ ok ] wp-config fixed"

echo "[step] Fixing permissions + clearing cache..."
bash /etc/wptt/wptt-phanquyen "$DOMAIN" >/dev/null 2>&1 || true
rm -rf "/usr/local/lsws/$DOMAIN/luucache" 2>/dev/null || true
echo "[ ok ] Done"

TABLE_PREFIX=$(grep -E '^\\$table_prefix\\s*=' "$WP_PATH/wp-config.php" 2>/dev/null \
    | sed "s/.*'\\([^']*\\)'.*/\\1/" | head -1 || true)
[[ -z "${TABLE_PREFIX:-}" ]] && TABLE_PREFIX="wp_"
TABLE_COUNT=$(mariadb -u "$DB_User_web" -p"$DB_Password_web" "$DB_Name_web" -e "SHOW TABLES;" 2>/dev/null | wc -l)
SITEURL=$(mariadb -u "$DB_User_web" -p"$DB_Password_web" "$DB_Name_web" \
    -e "SELECT option_value FROM \\`${TABLE_PREFIX}options\\` WHERE option_name='siteurl';" 2>/dev/null | tail -1 || echo "unknown")

echo "RESULT|OK|$DOMAIN|$DATE|$DB_Name_web|$TABLE_COUNT|$SITEURL"
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


def _verify_backup_one(ip: str, profile: str, domain: str, source_server: str, date: str, log) -> dict:
    label = f"{domain} (nguồn: {source_server}, ngày: {date or 'mới nhất'})"
    user, key, err = _connect_or_fail(ip, profile, log, label)
    if not user:
        return {"status": "FAIL", "date_used": None, "listing": [], "note": err}

    rc, output = ssh_ops.run_remote(
        ip, user, key, VERIFY_SCRIPT, args=[domain, source_server, date or ""], timeout=30,
    )
    if output.startswith("ERR|"):
        note = _err_note(output)
        log(f"[fail] {label}: {note}")
        return {"status": "FAIL", "date_used": None, "listing": [], "note": note}
    if "LISTING_START" not in output:
        log(f"[fail] {label}: no output (exit {rc})")
        return {"status": "FAIL", "date_used": None, "listing": [], "note": f"no output (exit {rc})"}

    date_used = None
    listing = []
    in_block = False
    for line in output.splitlines():
        stripped = line.strip()
        if stripped.startswith("DATE_USED|"):
            date_used = stripped.split("|", 1)[1]
            continue
        if stripped == "LISTING_START":
            in_block = True
            continue
        if stripped == "LISTING_END":
            break
        if in_block and stripped:
            listing.append(stripped)

    log(f"[ ok ] {label}: backup tồn tại - {len(listing)} file")
    return {"status": "OK", "date_used": date_used, "listing": listing, "note": ""}


def _restore_wpsite_one(ip: str, profile: str, domain: str, source_server: str, date: str, log) -> dict:
    label = f"{domain} -> server đích ({ip})"
    user, key, err = _connect_or_fail(ip, profile, log, label)
    if not user:
        return {"domain": domain, "status": "FAIL", "note": err}

    rc, output = ssh_ops.run_remote(
        ip, user, key, RESTORE_SCRIPT, args=[domain, source_server, date or ""],
        use_sudo=True, timeout=settings.ssh_restore_timeout,
    )
    for line in output.splitlines():
        log(f"    {line}")

    result_line = next((l for l in output.splitlines() if l.startswith("RESULT|")), None)
    if not result_line:
        log(f"[fail] {label}: no result (exit {rc})")
        return {"domain": domain, "status": "FAIL", "note": f"no result (exit {rc})"}

    parts = result_line.split("|")
    if parts[1] == "OK" and len(parts) >= 7:
        _, _, dom, date_used, db_name, table_count, siteurl = parts
        log(f"[ ok ] {label}: {table_count} bảng, {siteurl}")

        # The restore command already runs synchronously (blocks for up to
        # ssh_restore_timeout) - unlike clone, a single check right after is
        # enough, no polling needed. This is the highest-stakes op in the
        # whole app (full DB drop + reimport from a backup that could be
        # stale/corrupt), so knowing immediately whether the site actually
        # came back up matters more here than almost anywhere else.
        http_status, ok = verify_ops.check_http_via_ssh(ip, user, key, dom)
        verify = {"http_status": http_status, "ok": ok,
                   "note": f"site sống lại OK (HTTP {http_status})" if ok else f"site KHÔNG phản hồi (HTTP {http_status}) sau restore - kiểm tra ngay"}
        log(f"[{'ok' if ok else 'fail'}] {label}: {verify['note']}")

        return {
            "domain": dom, "status": "OK", "date_used": date_used, "db_name": db_name,
            "table_count": table_count, "siteurl": siteurl, "note": "", "verify": verify,
        }

    note = parts[3] if len(parts) > 3 else "restore failed"
    log(f"[fail] {label}: {note}")
    return {"domain": domain, "status": "FAIL", "note": note}


def restore_wpsite(entries: list[dict], log, dry_run: bool = False) -> list[dict]:
    """entries: [{"domain", "source_server", "date", "ip", "profile"}]

    dry_run=True: only verifies each backup exists on R2 (rclone ls) - safe
    to run in parallel, nothing on the destination server is touched.

    dry_run=False: the real, destructive restore - runs ONE DOMAIN AT A TIME
    on purpose. Each restore downloads a full site backup and does a DROP +
    re-import of its database; running several concurrently against the same
    destination server would pile CPU/disk-I/O/MariaDB load all at once,
    same reasoning as wp_plugin_ops.update_plugins/install_plugin_zip."""
    if dry_run:
        log(f"[dry-run] Đang xác minh backup cho {len(entries)} domain...")
        results = [None] * len(entries)
        with ThreadPoolExecutor(max_workers=settings.ssh_restore_workers) as pool:
            futures = {
                pool.submit(
                    _verify_backup_one, e["ip"], e["profile"], e["domain"], e["source_server"], e.get("date") or "", log,
                ): idx
                for idx, e in enumerate(entries)
            }
            for future in as_completed(futures):
                idx = futures[future]
                e = entries[idx]
                try:
                    result = future.result()
                except Exception as exc:
                    result = {"status": "FAIL", "date_used": None, "listing": [], "note": str(exc)}
                results[idx] = {
                    "domain": e["domain"], "status": "DRYRUN" if result["status"] == "OK" else "FAIL",
                    "date_used": result["date_used"], "listing": result["listing"],
                    "note": result["note"] or "backup verified - chưa thay đổi gì",
                }
        return results

    log(f"Đang khôi phục {len(entries)} domain (tuần tự)...")
    results = []
    for e in entries:
        domain = e.get("domain", "?")
        try:
            results.append(
                _restore_wpsite_one(e["ip"], e["profile"], e["domain"], e["source_server"], e.get("date") or "", log)
            )
        except Exception as exc:
            # See wp_ops.clone_wpsite for why this guard exists - one bad
            # entry must never abort the whole batch and erase every other
            # domain's already-collected restore result.
            log(f"[fail] {domain}: unexpected error - {exc}")
            results.append({"domain": domain, "status": "FAIL", "note": f"unexpected error: {exc}"})
    return results
