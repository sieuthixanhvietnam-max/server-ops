import asyncio

from fastapi import APIRouter, Depends

from app.auth import get_current_username
from app.ops import r2_ops

router = APIRouter(prefix="/api/backups", tags=["backups"], dependencies=[Depends(get_current_username)])


@router.get("")
async def list_backups(refresh: bool = False):
    rows, fetched_at = await asyncio.to_thread(r2_ops.list_backup_catalog, refresh)
    return {"data": rows, "fetched_at": fetched_at, "success": True}
