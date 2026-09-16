from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_username
from app.config import settings
from app.database import get_db
from app.models import SyncLog
from app.schemas import SyncStatus
from app.sync_service import run_sync

router = APIRouter(
    prefix="/api/sync", tags=["sync"], dependencies=[Depends(get_current_username)]
)


def _next_synced_at(synced_at):
    return synced_at + timedelta(minutes=settings.sync_interval_minutes) if synced_at else None


@router.post("/trigger", response_model=SyncStatus)
async def trigger_sync(db: Session = Depends(get_db)):
    log = await run_sync(db)
    return SyncStatus(
        synced_at=log.synced_at,
        next_synced_at=_next_synced_at(log.synced_at),
        total_domains=log.total_domains,
        total_servers=log.total_servers,
        success=log.success,
        error_message=log.error_message,
    )


@router.get("/status", response_model=SyncStatus)
def sync_status(db: Session = Depends(get_db)):
    log = db.execute(select(SyncLog).order_by(SyncLog.id.desc()).limit(1)).scalar_one_or_none()
    if log is None:
        return SyncStatus(synced_at=None, total_domains=0, total_servers=0, success=False)
    return SyncStatus(
        synced_at=log.synced_at,
        next_synced_at=_next_synced_at(log.synced_at),
        total_domains=log.total_domains,
        total_servers=log.total_servers,
        success=log.success,
        error_message=log.error_message,
    )
