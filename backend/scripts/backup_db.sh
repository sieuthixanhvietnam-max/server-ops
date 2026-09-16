#!/bin/bash
# Nightly Postgres dump for server-ops, pushed to R2 + rotated locally.
# Local copies exist for a fast restore without a network round-trip;
# R2 is the durable off-droplet copy in case the VPS itself is lost.
set -euo pipefail

ENV_FILE="/etc/server-ops/backup.env"
LOCAL_DIR="/var/backups/server-ops"
LOCAL_RETENTION_DAYS=7
REMOTE_RETENTION_DAYS=30

# shellcheck disable=SC1090
source "$ENV_FILE"
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"

mkdir -p "$LOCAL_DIR"
cd "$LOCAL_DIR"  # cron/sudo may start us in a cwd serverops can't stat back into
STAMP=$(date +%Y-%m-%d_%H%M%S)
DUMP_FILE="$LOCAL_DIR/server_ops_${STAMP}.pgdump"

pg_dump "postgresql://serverops@/server_ops" --no-owner --no-privileges -Fc -f "$DUMP_FILE"

# R2 occasionally 501s the modtime-preserving copy on the first attempt
# (not all S3 operations are implemented) - rclone's built-in retry handles
# it, made explicit here so it's not relying on defaults.
rclone copy "$DUMP_FILE" "r2:${R2_BUCKET}/" --quiet --retries 5 --low-level-retries 10

# Prune local copies older than LOCAL_RETENTION_DAYS.
find "$LOCAL_DIR" -name 'server_ops_*.pgdump' -mtime +"$LOCAL_RETENTION_DAYS" -delete

# Prune remote copies older than REMOTE_RETENTION_DAYS.
rclone delete "r2:${R2_BUCKET}/" --min-age "${REMOTE_RETENTION_DAYS}d" --quiet

echo "$(date -Iseconds) backup OK: $DUMP_FILE"
