import asyncio
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access_control_service import get_client_ip
from app.auth import get_current_username
from app.config import settings
from app.database import get_db
from app.job_service import create_job, launch_job
from app.models import MuPlugin, PluginZip, ThemeZip
from app.ops import wp_mu_plugin_ops, wp_plugin_ops
from app.routers.jobs_common import resolve_plugin_entries

router = APIRouter(prefix="/api/jobs", tags=["jobs"], dependencies=[Depends(get_current_username)])


class PluginDomainsRequest(BaseModel):
    domains: list[str]


class PluginToggleRequest(BaseModel):
    domains: list[str]
    plugins: list[str]
    dry_run: bool = True


class PluginInstallWpRequest(BaseModel):
    domains: list[str]
    slugs: list[str]
    dry_run: bool = True


class PluginUpdateRequest(BaseModel):
    domains: list[str]
    dry_run: bool = True


class PluginInstallZipRequest(BaseModel):
    domains: list[str]
    zip_ids: list[int]
    dry_run: bool = True


class ThemeInstallZipRequest(BaseModel):
    domains: list[str]
    zip_ids: list[int]
    dry_run: bool = True


class MuPluginInstallRequest(BaseModel):
    domains: list[str]
    mu_plugin_id: int
    dry_run: bool = True
    # Optional WP username to check for existence on each domain while
    # deploying - useful for a mu-plugin that only matters where a specific
    # account exists, so the result can show which domains it actually
    # applies to without a separate pass.
    check_username: str | None = None


@router.post("/plugin-check")
async def trigger_plugin_check(
    body: PluginDomainsRequest,
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
        db, "plugin_check", {"domains": body.domains, "resolve_errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(wp_plugin_ops.check_plugins, entries, ctx.log)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/plugin-deactivate")
async def trigger_plugin_deactivate(
    body: PluginToggleRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    if not body.plugins:
        raise HTTPException(status_code=400, detail="plugins list is empty")
    entries, errors = resolve_plugin_entries(db, body.domains)
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "plugin_deactivate",
        {"domains": body.domains, "plugins": body.plugins, "dry_run": body.dry_run, "resolve_errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(wp_plugin_ops.deactivate_plugins, entries, body.plugins, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/plugin-activate")
async def trigger_plugin_activate(
    body: PluginToggleRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    if not body.plugins:
        raise HTTPException(status_code=400, detail="plugins list is empty")
    entries, errors = resolve_plugin_entries(db, body.domains)
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "plugin_activate",
        {"domains": body.domains, "plugins": body.plugins, "dry_run": body.dry_run, "resolve_errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(wp_plugin_ops.activate_plugins, entries, body.plugins, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/plugin-install-wp")
async def trigger_plugin_install_wp(
    body: PluginInstallWpRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    if not body.slugs:
        raise HTTPException(status_code=400, detail="slugs list is empty")
    entries, errors = resolve_plugin_entries(db, body.domains)
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "plugin_install_wp",
        {"domains": body.domains, "slugs": body.slugs, "dry_run": body.dry_run, "resolve_errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(wp_plugin_ops.install_plugins_wp, entries, body.slugs, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/plugin-update")
async def trigger_plugin_update(
    body: PluginUpdateRequest,
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
        db, "plugin_update",
        {"domains": body.domains, "dry_run": body.dry_run, "resolve_errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(wp_plugin_ops.update_plugins, entries, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/plugin-install-zip")
async def trigger_plugin_install_zip(
    body: PluginInstallZipRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    if not body.zip_ids:
        raise HTTPException(status_code=400, detail="Chưa chọn plugin nào từ thư viện")

    zip_rows = db.execute(select(PluginZip).where(PluginZip.id.in_(body.zip_ids))).scalars().all()
    found_ids = {z.id for z in zip_rows}
    missing = [zid for zid in body.zip_ids if zid not in found_ids]
    if missing:
        raise HTTPException(status_code=400, detail=f"Không tìm thấy plugin trong thư viện: {missing}")
    zips = [{"label": z.filename, "path": os.path.join(settings.plugin_zip_dir, z.stored_name)} for z in zip_rows]
    missing_files = [z["path"] for z in zips if not os.path.isfile(z["path"])]
    if missing_files:
        raise HTTPException(status_code=400, detail="File plugin bị thiếu trên server, thử tải lại lên thư viện")

    entries, errors = resolve_plugin_entries(db, body.domains)
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "plugin_install_zip",
        {"domains": body.domains, "dry_run": body.dry_run,
         "filenames": [z.filename for z in zip_rows], "resolve_errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(wp_plugin_ops.install_plugin_zip, entries, zips, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/theme-install-zip")
async def trigger_theme_install_zip(
    body: ThemeInstallZipRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    if not body.zip_ids:
        raise HTTPException(status_code=400, detail="Chưa chọn theme nào từ thư viện")

    zip_rows = db.execute(select(ThemeZip).where(ThemeZip.id.in_(body.zip_ids))).scalars().all()
    found_ids = {z.id for z in zip_rows}
    missing = [zid for zid in body.zip_ids if zid not in found_ids]
    if missing:
        raise HTTPException(status_code=400, detail=f"Không tìm thấy theme trong thư viện: {missing}")
    zips = [{"label": z.filename, "path": os.path.join(settings.theme_zip_dir, z.stored_name)} for z in zip_rows]
    missing_files = [z["path"] for z in zips if not os.path.isfile(z["path"])]
    if missing_files:
        raise HTTPException(status_code=400, detail="File theme bị thiếu trên server, thử tải lại lên thư viện")

    entries, errors = resolve_plugin_entries(db, body.domains)
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "theme_install_zip",
        {"domains": body.domains, "dry_run": body.dry_run,
         "filenames": [z.filename for z in zip_rows], "resolve_errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(wp_plugin_ops.install_theme_zip, entries, zips, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/mu-plugin-install")
async def trigger_mu_plugin_install(
    body: MuPluginInstallRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")

    row = db.get(MuPlugin, body.mu_plugin_id)
    if not row:
        raise HTTPException(status_code=400, detail="Không tìm thấy mu-plugin trong thư viện")
    mu_plugin = {"label": row.label, "filename": row.filename, "path": os.path.join(settings.mu_plugin_dir, row.stored_name)}
    if not os.path.isfile(mu_plugin["path"]):
        raise HTTPException(status_code=400, detail="File mu-plugin bị thiếu trên server, thử tải lại lên thư viện")

    entries, errors = resolve_plugin_entries(db, body.domains)
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "mu_plugin_install",
        {
            "domains": body.domains, "dry_run": body.dry_run, "filename": row.filename,
            "check_username": body.check_username, "resolve_errors": errors,
        },
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(
            wp_mu_plugin_ops.install_mu_plugin, entries, mu_plugin, ctx.log, body.dry_run, body.check_username,
        )

    launch_job(job.id, worker)
    return {"job_id": job.id}
