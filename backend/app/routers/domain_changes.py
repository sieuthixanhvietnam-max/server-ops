from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_current_username
from app.database import get_db
from app.models import DomainChangeLog
from app.pic_service import get_server_pics_map, server_names_for_pic
from app.query_utils import apply_sort
from app.schemas import DomainChangeOut

UNASSIGNED_PIC = "__unassigned__"

router = APIRouter(
    prefix="/api/domains/changes",
    tags=["domain-changes"],
    dependencies=[Depends(get_current_username)],
)

_SORTABLE = {
    "domain": DomainChangeLog.domain,
    "event_type": DomainChangeLog.event_type,
    "server_name": DomainChangeLog.server_name,
    "provider": DomainChangeLog.provider,
    "profile": DomainChangeLog.profile,
    "detected_at": DomainChangeLog.detected_at,
}


@router.get("")
def list_domain_changes(
    db: Session = Depends(get_db),
    current: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=20000, description="Higher ceiling than the table needs, to cover full CSV exports"),
    event_type: str | None = Query(None, description="'added', 'removed' or 'moved'"),
    domain: str | None = Query(None, description="Filter by domain substring"),
    provider: str | None = Query(None),
    server_name: str | None = Query(None),
    profile: str | None = Query(None),
    pic: str | None = Query(None, description="PIC code, or '__unassigned__' for no PIC"),
    date_from: datetime | None = Query(None, description="Detected at >= this time (ISO 8601)"),
    date_to: datetime | None = Query(None, description="Detected at <= this time (ISO 8601)"),
    sort_field: str | None = Query(None),
    sort_order: str | None = Query(None, description="'ascend' or 'descend'"),
):
    stmt = select(DomainChangeLog)
    if event_type:
        stmt = stmt.where(DomainChangeLog.event_type == event_type)
    if domain:
        stmt = stmt.where(DomainChangeLog.domain.ilike(f"%{domain}%"))
    if provider:
        stmt = stmt.where(DomainChangeLog.provider == provider)
    if server_name:
        stmt = stmt.where(DomainChangeLog.server_name == server_name)
    if profile:
        stmt = stmt.where(DomainChangeLog.profile == profile)
    if pic:
        stmt = stmt.where(DomainChangeLog.server_name.in_(server_names_for_pic(db, pic)))
    if date_from:
        stmt = stmt.where(DomainChangeLog.detected_at >= date_from)
    if date_to:
        stmt = stmt.where(DomainChangeLog.detected_at <= date_to)

    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    stmt = apply_sort(
        stmt, _SORTABLE, sort_field, sort_order,
        default=(DomainChangeLog.detected_at.desc(), DomainChangeLog.id.desc()),
    )

    rows = (
        db.execute(stmt.offset((current - 1) * pageSize).limit(pageSize))
        .scalars()
        .all()
    )

    return {
        "data": [DomainChangeOut.model_validate(row).model_dump() for row in rows],
        "total": total,
        "success": True,
    }


@router.get("/summary")
def domain_changes_summary(
    db: Session = Depends(get_db),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
):
    stmt = select(DomainChangeLog.event_type, func.count()).group_by(DomainChangeLog.event_type)
    if date_from:
        stmt = stmt.where(DomainChangeLog.detected_at >= date_from)
    if date_to:
        stmt = stmt.where(DomainChangeLog.detected_at <= date_to)

    counts = {event_type: count for event_type, count in db.execute(stmt).all()}
    return {
        "added": counts.get("added", 0),
        "removed": counts.get("removed", 0),
        "moved": counts.get("moved", 0),
        "success": True,
    }


# How far back to default the range when the caller doesn't pass date_from,
# scaled to the bucket size so a "day" view isn't swamped with months of bars
# and a "year" view isn't limited to a handful of points.
_DEFAULT_RANGE_DAYS = {
    "day": 30,
    "week": 12 * 7,
    "month": 365,
    "quarter": 2 * 365,
    "year": 5 * 365,
}


def _bucket_key_and_label(d: date, granularity: str) -> tuple[str, str]:
    if granularity == "day":
        return d.isoformat(), d.strftime("%d/%m/%Y")
    if granularity == "week":
        iso_year, iso_week, _ = d.isocalendar()
        monday = d - timedelta(days=d.isoweekday() - 1)
        sunday = monday + timedelta(days=6)
        return f"{iso_year}-W{iso_week:02d}", f"{monday.strftime('%d/%m')} - {sunday.strftime('%d/%m')}"
    if granularity == "month":
        return d.strftime("%Y-%m"), d.strftime("%m/%Y")
    if granularity == "quarter":
        q = (d.month - 1) // 3 + 1
        return f"{d.year}-Q{q}", f"Q{q}/{d.year}"
    return str(d.year), str(d.year)


@router.get("/timeseries")
def domain_changes_timeseries(
    db: Session = Depends(get_db),
    granularity: Literal["day", "week", "month", "quarter", "year"] = Query("day"),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    domain: str | None = Query(None, description="Filter by domain substring"),
    provider: str | None = Query(None),
    server_name: str | None = Query(None),
    profile: str | None = Query(None),
    pic: str | None = Query(None, description="PIC code, or '__unassigned__' for no PIC"),
):
    if date_to is None:
        date_to = datetime.now(timezone.utc)
    if date_from is None:
        date_from = date_to - timedelta(days=_DEFAULT_RANGE_DAYS[granularity])

    stmt = select(DomainChangeLog.event_type, DomainChangeLog.detected_at).where(
        DomainChangeLog.detected_at >= date_from,
        DomainChangeLog.detected_at <= date_to,
    )
    if domain:
        stmt = stmt.where(DomainChangeLog.domain.ilike(f"%{domain}%"))
    if provider:
        stmt = stmt.where(DomainChangeLog.provider == provider)
    if server_name:
        stmt = stmt.where(DomainChangeLog.server_name == server_name)
    if profile:
        stmt = stmt.where(DomainChangeLog.profile == profile)
    if pic:
        stmt = stmt.where(DomainChangeLog.server_name.in_(server_names_for_pic(db, pic)))

    buckets: dict[str, dict] = {}
    for event_type, detected_at in db.execute(stmt).all():
        key, label = _bucket_key_and_label(detected_at.date(), granularity)
        bucket = buckets.setdefault(
            key, {"period": key, "label": label, "added": 0, "removed": 0, "moved": 0}
        )
        if event_type in bucket:
            bucket[event_type] += 1

    points = sorted(buckets.values(), key=lambda b: b["period"])
    for point in points:
        point["net"] = point["added"] - point["removed"]
        point["total"] = point["added"] + point["removed"] + point["moved"]

    return {"data": points, "success": True}


@router.get("/hotspots")
def domain_changes_hotspots(
    db: Session = Depends(get_db),
    date_from: datetime | None = Query(None),
    date_to: datetime | None = Query(None),
    provider: str | None = Query(None),
    profile: str | None = Query(None),
    limit: int = Query(15, ge=1, le=100),
):
    """Aggregated churn view for the "Phân tích" tab - which servers/PICs
    are seeing the most add/remove/move activity, and which server pairs
    show up most often in "moved" events (surfaces bulk-migration patterns
    that are invisible row-by-row in the raw log)."""
    stmt = select(
        DomainChangeLog.event_type, DomainChangeLog.server_name, DomainChangeLog.from_server_name
    )
    if date_from:
        stmt = stmt.where(DomainChangeLog.detected_at >= date_from)
    if date_to:
        stmt = stmt.where(DomainChangeLog.detected_at <= date_to)
    if provider:
        stmt = stmt.where(DomainChangeLog.provider == provider)
    if profile:
        stmt = stmt.where(DomainChangeLog.profile == profile)

    by_server: dict[str, dict] = {}
    pair_counts: dict[tuple[str, str], int] = {}
    for event_type, server_name, from_server_name in db.execute(stmt).all():
        bucket = by_server.setdefault(
            server_name, {"server_name": server_name, "added": 0, "removed": 0, "moved": 0}
        )
        if event_type in bucket:
            bucket[event_type] += 1
        if event_type == "moved" and from_server_name:
            key = (from_server_name, server_name)
            pair_counts[key] = pair_counts.get(key, 0) + 1

    server_pics = get_server_pics_map(db)
    by_pic: dict[str, dict] = {}
    for bucket in by_server.values():
        codes = server_pics.get(bucket["server_name"]) or [UNASSIGNED_PIC]
        for code in codes:
            pic_bucket = by_pic.setdefault(code, {"pic": code, "added": 0, "removed": 0, "moved": 0})
            pic_bucket["added"] += bucket["added"]
            pic_bucket["removed"] += bucket["removed"]
            pic_bucket["moved"] += bucket["moved"]

    def ranked(items: list[dict]) -> list[dict]:
        for item in items:
            item["total"] = item["added"] + item["removed"] + item["moved"]
        items.sort(key=lambda x: x["total"], reverse=True)
        return items[:limit]

    server_pairs = sorted(
        (
            {"from_server_name": f, "to_server_name": t, "count": c}
            for (f, t), c in pair_counts.items()
        ),
        key=lambda x: x["count"],
        reverse=True,
    )[:limit]

    return {
        "by_server": ranked(list(by_server.values())),
        "by_pic": ranked(list(by_pic.values())),
        "server_pairs": server_pairs,
        "success": True,
    }
