import asyncio
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Server

# Guards both the periodic sweep (main.py) and a manual "Kiểm tra sức khoẻ"
# trigger from racing each other - same pattern as cf_sync_lock.
health_check_lock = asyncio.Lock()

HEALTH_STATUSES = ["OK", "WARN", "CRIT", "FAIL"]


def persist_health_results(db: Session, results: list[dict]) -> None:
    by_name = {r["server_name"]: r for r in results if r.get("server_name")}
    if not by_name:
        return
    servers = db.execute(select(Server).where(Server.server_name.in_(by_name))).scalars().all()
    now = datetime.now(timezone.utc)
    for s in servers:
        r = by_name[s.server_name]
        s.last_health_status = r.get("status")
        s.last_health_note = r.get("note") or ""
        s.last_health_checked_at = now
    db.commit()


def health_summary(db: Session) -> dict:
    """Counts by last known status - "unknown" covers servers never checked
    (last_health_status is NULL) rather than silently omitting them, so the
    dashboard's total always reconciles with the server count."""
    rows = db.execute(select(Server.last_health_status)).scalars().all()
    counts = {status: 0 for status in HEALTH_STATUSES}
    counts["unknown"] = 0
    for status in rows:
        counts[status if status in counts else "unknown"] += 1
    return counts
