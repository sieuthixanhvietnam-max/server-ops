from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.health_service import health_summary
from app.models import AllowedIp, CfAccount, Job, Server, User

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"], dependencies=[Depends(get_current_user)])


def _next_at(last_at, interval_minutes):
    return last_at + timedelta(minutes=interval_minutes) if last_at else None


@router.get("/summary")
def dashboard_summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    since_24h = datetime.now(timezone.utc) - timedelta(hours=24)
    jobs_failed_24h = db.execute(
        select(func.count()).select_from(Job).where(Job.status == "failed", Job.created_at >= since_24h)
    ).scalar_one()

    health_checked_at = db.execute(select(func.max(Server.last_health_checked_at))).scalar_one()

    cf_last_synced_at = db.execute(select(func.max(CfAccount.last_synced_at))).scalar_one()
    cf_error_count = db.execute(
        select(func.count()).select_from(CfAccount).where(CfAccount.last_sync_status == "error")
    ).scalar_one()

    data = {
        "health": health_summary(db),
        "health_checked_at": health_checked_at,
        "health_next_at": _next_at(health_checked_at, settings.health_check_interval_minutes),
        "jobs_failed_24h": jobs_failed_24h,
        "cf_sync": {
            "last_synced_at": cf_last_synced_at,
            "next_at": _next_at(cf_last_synced_at, settings.cf_sync_interval_minutes),
            "error_count": cf_error_count,
        },
    }

    if user.is_admin:
        active_users = db.execute(
            select(func.count()).select_from(User).where(User.is_active.is_(True))
        ).scalar_one()
        active_allowed_ips = db.execute(
            select(func.count()).select_from(AllowedIp).where(AllowedIp.is_active.is_(True))
        ).scalar_one()
        data["admin"] = {
            "active_users": active_users,
            "active_allowed_ips": active_allowed_ips,
            "ip_allowlist_enforced": settings.ip_allowlist_enforced,
        }

    return {"data": data, "success": True}
