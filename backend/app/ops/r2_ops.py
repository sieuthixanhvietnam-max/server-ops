import threading
import time
from datetime import datetime, timezone

import boto3

from app.config import settings

# Confirmed on production: every server that runs the wptt backup cron
# writes to the SAME R2 bucket with the SAME credentials (compared
# /etc/wptt/backup-r2.conf across ali_enterprise and gcp_enterprise byte
# for byte). Bucket layout is flat: {server_name}/{domain}/{date:YYYY-MM-DD}/
# {db.sql.gz,files.tar.gz} - so the whole catalog can be read straight from
# R2's S3 API without SSHing into any server.
_CACHE_TTL_SECONDS = 90

_cache_lock = threading.Lock()
_cache_rows: list[dict] | None = None
_cache_fetched_at: str | None = None
_cache_time: float = 0.0


def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint,
        aws_access_key_id=settings.r2_access_key,
        aws_secret_access_key=settings.r2_secret_key,
        region_name="auto",
    )


def _scan_bucket() -> list[dict]:
    """Flat paginated ListObjectsV2 over the whole bucket, grouped into one
    row per (server, domain, date) with the 2 backup files' sizes summed."""
    client = _client()
    paginator = client.get_paginator("list_objects_v2")
    totals: dict[tuple[str, str, str], int] = {}

    for page in paginator.paginate(Bucket=settings.r2_bucket):
        for obj in page.get("Contents", []):
            parts = obj["Key"].split("/")
            if len(parts) != 4:
                continue
            server_name, domain, date, _filename = parts
            key = (server_name, domain, date)
            totals[key] = totals.get(key, 0) + obj["Size"]

    rows = [
        {"server_name": server_name, "domain": domain, "date": date, "size_bytes": size}
        for (server_name, domain, date), size in totals.items()
    ]
    rows.sort(key=lambda r: (r["server_name"], r["domain"], r["date"]), reverse=True)
    return rows


def list_backup_catalog(force_refresh: bool = False) -> tuple[list[dict], str]:
    """Returns (rows, fetched_at). Cached in-process for _CACHE_TTL_SECONDS
    so loading the dashboard doesn't rescan the whole bucket (~22k objects)
    every time - force_refresh=True (the UI's "Làm mới" button) bypasses it."""
    global _cache_rows, _cache_fetched_at, _cache_time

    with _cache_lock:
        is_fresh = _cache_rows is not None and (time.monotonic() - _cache_time) < _CACHE_TTL_SECONDS
        if not force_refresh and is_fresh:
            return _cache_rows, _cache_fetched_at

    rows = _scan_bucket()
    fetched_at = datetime.now(timezone.utc).isoformat()

    with _cache_lock:
        _cache_rows = rows
        _cache_fetched_at = fetched_at
        _cache_time = time.monotonic()

    return rows, fetched_at
