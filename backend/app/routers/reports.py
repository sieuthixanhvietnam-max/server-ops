from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.infra_snapshot_service import TRACKED_PROVIDERS, week_start_of
from app.models import DomainChangeLog, ProviderWeeklySnapshot

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/infra-weekly")
def infra_weekly_report(
    weeks: int = Query(8, ge=1, le=52),
    db: Session = Depends(get_db),
):
    """Per (provider, week): server_count/domain_count from
    ProviderWeeklySnapshot (NULL for weeks predating that table where no
    server history could be reconstructed - see infra_snapshot_service.py),
    plus domains_removed computed live from DomainChangeLog so it's always
    exact regardless of when the snapshot table started."""
    since_dt = datetime.now(timezone.utc) - timedelta(weeks=weeks)
    since_week = week_start_of(since_dt)

    snapshots = (
        db.execute(
            select(ProviderWeeklySnapshot).where(
                ProviderWeeklySnapshot.provider.in_(TRACKED_PROVIDERS),
                ProviderWeeklySnapshot.week_start >= since_week,
            )
        )
        .scalars()
        .all()
    )

    removed_rows = db.execute(
        select(DomainChangeLog.provider, DomainChangeLog.detected_at).where(
            DomainChangeLog.provider.in_(TRACKED_PROVIDERS),
            DomainChangeLog.event_type == "removed",
            DomainChangeLog.detected_at >= since_dt,
        )
    ).all()
    removed_counts: dict[tuple[str, str], int] = {}
    for provider, detected_at in removed_rows:
        key = (provider, week_start_of(detected_at))
        removed_counts[key] = removed_counts.get(key, 0) + 1

    data = [
        {
            "provider": s.provider,
            "week_start": s.week_start,
            "server_count": s.server_count,
            "domain_count": s.domain_count,
            "domains_removed": removed_counts.get((s.provider, s.week_start), 0),
        }
        for s in snapshots
    ]
    covered = {(d["provider"], d["week_start"]) for d in data}
    for (provider, ws), count in removed_counts.items():
        if (provider, ws) not in covered:
            data.append(
                {
                    "provider": provider,
                    "week_start": ws,
                    "server_count": None,
                    "domain_count": None,
                    "domains_removed": count,
                }
            )
    return {"data": data, "success": True}
