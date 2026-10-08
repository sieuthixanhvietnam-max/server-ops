import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.access_control_service import get_client_ip
from app.auth import get_current_username
from app.database import get_db
from app.job_service import create_job, launch_job
from app.ops import wp_maintenance_ops
from app.routers.jobs_common import resolve_plugin_entries

router = APIRouter(prefix="/api/jobs", tags=["jobs"], dependencies=[Depends(get_current_username)])


class MaintenanceClearCacheRequest(BaseModel):
    domains: list[str]


class MaintenanceClearCommentsRequest(BaseModel):
    domains: list[str]
    disable_new: bool = True
    dry_run: bool = True


class MaintenanceFixPermissionsRequest(BaseModel):
    domains: list[str]
    dry_run: bool = True


class MaintenanceCleanJunkRequest(BaseModel):
    domains: list[str]
    dry_run: bool = True


@router.post("/maintenance-clear-cache")
async def trigger_maintenance_clear_cache(
    body: MaintenanceClearCacheRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    entries, errors = resolve_plugin_entries(db, body.domains)
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "maintenance_clear_cache", {"domains": body.domains, "resolve_errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(wp_maintenance_ops.clear_cache, entries, ctx.log)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/maintenance-clear-comments")
async def trigger_maintenance_clear_comments(
    body: MaintenanceClearCommentsRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    entries, errors = resolve_plugin_entries(db, body.domains)
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "maintenance_clear_comments",
        {"domains": body.domains, "disable_new": body.disable_new, "dry_run": body.dry_run, "resolve_errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(
            wp_maintenance_ops.clear_comments, entries, ctx.log, body.disable_new, body.dry_run,
        )

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/maintenance-fix-permissions")
async def trigger_maintenance_fix_permissions(
    body: MaintenanceFixPermissionsRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    entries, errors = resolve_plugin_entries(db, body.domains)
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "maintenance_fix_permissions",
        {"domains": body.domains, "dry_run": body.dry_run, "resolve_errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(wp_maintenance_ops.fix_permissions, entries, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/maintenance-clean-junk")
async def trigger_maintenance_clean_junk(
    body: MaintenanceCleanJunkRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    entries, errors = resolve_plugin_entries(db, body.domains)
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "maintenance_clean_junk",
        {"domains": body.domains, "dry_run": body.dry_run, "resolve_errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(wp_maintenance_ops.clean_junk, entries, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}
