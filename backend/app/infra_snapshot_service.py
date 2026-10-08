from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Domain, DomainChangeLog, ProviderWeeklySnapshot, Server

# Asia/Ho_Chi_Minh, no DST - same fixed-offset convention as the redirect-301
# report's week bucketing (jobs.py).
VN_TZ = timezone(timedelta(hours=7))

TRACKED_PROVIDERS = ["GCP", "Ali"]


def week_start_of(dt: datetime) -> str:
    """Monday (Vietnam-local) of the week containing `dt`, as YYYY-MM-DD."""
    dt_vn = dt.astimezone(VN_TZ)
    monday = dt_vn - timedelta(days=dt_vn.weekday())
    return monday.strftime("%Y-%m-%d")


def capture_current_week(db: Session) -> None:
    """Upserts this week's row for every tracked provider from live
    Server/Domain counts. Called once at startup and on every
    _periodic_infra_snapshot_loop tick after that, so the current week's
    numbers stay fresh all week - past weeks are never touched again once
    their week ends, which is what freezes them."""
    week_start = week_start_of(datetime.now(timezone.utc))
    now = datetime.now(timezone.utc)
    for provider in TRACKED_PROVIDERS:
        server_count = db.execute(
            select(func.count()).select_from(Server).where(Server.provider == provider)
        ).scalar_one()
        domain_count = db.execute(
            select(func.count()).select_from(Domain).where(Domain.provider == provider)
        ).scalar_one()
        existing = db.execute(
            select(ProviderWeeklySnapshot).where(
                ProviderWeeklySnapshot.provider == provider,
                ProviderWeeklySnapshot.week_start == week_start,
            )
        ).scalar_one_or_none()
        if existing:
            existing.server_count = server_count
            existing.domain_count = domain_count
            existing.captured_at = now
        else:
            db.add(
                ProviderWeeklySnapshot(
                    provider=provider,
                    week_start=week_start,
                    server_count=server_count,
                    domain_count=domain_count,
                    captured_at=now,
                )
            )
    db.commit()


def backfill_domain_history(db: Session) -> None:
    """One-time reconstruction of domain_count for weeks before this table
    existed, walking backward from the live Domain count through
    DomainChangeLog's added/removed events. No-ops if a backfilled (or
    already-captured) row exists for any tracked provider - safe to call on
    every startup, only ever does real work once.

    For each week W, going from the most recent week back to the oldest one
    with any event: the live/running count going in represents end(W) (the
    count right after W's own changes applied - true by construction, since
    we start from "right now" for the current, still-in-progress week and
    walk backward one week at a time). We store that as W's snapshot (same
    "last known value during the week" convention capture_current_week
    uses), then undo W's own added/removed to step back to end(W-1) for the
    next iteration.

    Caveat: a "moved" event only records the domain's new server (and the
    server it moved FROM), not that old server's provider - so a move that
    crossed providers is silently treated as staying within the same
    provider. Only 19 moves total exist across both providers vs 3000+
    added/removed events, so this is an acceptable approximation for a
    reporting feature, not something billing-critical.
    """
    already = db.execute(
        select(func.count())
        .select_from(ProviderWeeklySnapshot)
        .where(ProviderWeeklySnapshot.domain_count.isnot(None))
    ).scalar_one()
    if already:
        return

    events = db.execute(
        select(DomainChangeLog.event_type, DomainChangeLog.provider, DomainChangeLog.detected_at).where(
            DomainChangeLog.provider.in_(TRACKED_PROVIDERS)
        )
    ).all()
    if not events:
        return

    per_week: dict[tuple[str, str], dict[str, int]] = {}
    for event_type, provider, detected_at in events:
        ws = week_start_of(detected_at)
        bucket = per_week.setdefault((provider, ws), {"added": 0, "removed": 0})
        if event_type == "added":
            bucket["added"] += 1
        elif event_type == "removed":
            bucket["removed"] += 1
        # "moved" - net-neutral, see docstring caveat.

    this_week = week_start_of(datetime.now(timezone.utc))
    weeks = sorted({ws for (_, ws) in per_week} | {this_week}, reverse=True)

    now = datetime.now(timezone.utc)
    for provider in TRACKED_PROVIDERS:
        running = db.execute(
            select(func.count()).select_from(Domain).where(Domain.provider == provider)
        ).scalar_one()
        for ws in weeks:
            bucket = per_week.get((provider, ws), {"added": 0, "removed": 0})
            if ws != this_week:
                # this_week is left for capture_current_week to write (it
                # also has a real server_count, which this function can
                # never supply).
                db.add(
                    ProviderWeeklySnapshot(
                        provider=provider,
                        week_start=ws,
                        server_count=None,
                        domain_count=running,
                        captured_at=now,
                    )
                )
            running = running - bucket["added"] + bucket["removed"]
    db.commit()
