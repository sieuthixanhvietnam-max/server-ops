import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.access_control_service import get_client_ip, is_ip_allowed, seed_allowed_ips
from app.cf_account_service import cf_sync_lock, discover_master_accounts, sync_all_accounts
from app.cf_whitelist_service import seed_cf_whitelist_ips
from app.config import settings
from app.database import Base, SessionLocal, engine, ensure_schema_migrations
from app.health_service import health_check_lock, persist_health_results
from app.models import Server
from app.ops import ssh_ops
from app.pic_service import seed_known_server_pics, seed_pic_teams, seed_pics
from app.routers import (
    access_control,
    auth,
    backups,
    cf_accounts,
    cf_whitelist,
    cf_zones,
    changelog,
    dashboard,
    domain_changes,
    domains,
    jobs,
    mu_plugins,
    pics,
    plugin_zips,
    servers,
    settings as settings_router,
    site_credentials,
    sync,
    theme_zips,
    users,
    wp_org,
)
from app.sync_service import run_sync
from app.user_service import seed_admin_user

logger = logging.getLogger("app")


async def _periodic_sync_loop():
    interval_seconds = settings.sync_interval_minutes * 60
    while True:
        await asyncio.sleep(interval_seconds)
        db = SessionLocal()
        try:
            await run_sync(db)
        finally:
            db.close()


async def _periodic_cf_sync_loop():
    # Syncs immediately on startup (so a restart doesn't leave CF data stale
    # for up to a full interval), then repeats on cf_sync_interval_minutes.
    # Run as a background task rather than awaited before the app starts
    # serving requests - unlike the domain/server sync (one fast HTTP call),
    # this can take a while (per-account, paginated Cloudflare API calls).
    #
    # Every tick does a FULL refresh from CF_API_TOKEN (the master token),
    # not just a re-sync of already-known accounts - new sub-accounts get
    # created directly on Cloudflare (not through this app), so the only way
    # to notice them is to re-run discovery, same as the "Khám phá qua
    # Master Token" button does. Manually-added accounts (their own token,
    # outside the master token's reach - see cf_account_service.py) aren't
    # covered by discovery, so their zones get a separate refresh pass.
    interval_seconds = settings.cf_sync_interval_minutes * 60
    while True:
        if cf_sync_lock.locked():
            # A manual "Đồng bộ tất cả" / "Khám phá qua Master Token" (or
            # another tick that ran long) is still in progress - skip this
            # tick rather than queueing behind it, so we don't fall further
            # and further behind schedule.
            logger.info("Skipping scheduled CF sync - one is already running")
        else:
            async with cf_sync_lock:
                await asyncio.to_thread(discover_master_accounts, logger.info)
                await asyncio.to_thread(sync_all_accounts, logger.info, "manual")
        await asyncio.sleep(interval_seconds)


async def _periodic_health_check_loop():
    # Feeds Server.last_health_* (Dashboard's health widget) without anyone
    # having to remember to run "Kiểm tra sức khoẻ" by hand. Doesn't create a
    # Job row - same as the domain/CF sync loops above, periodic background
    # sweeps aren't audit events, only manually-triggered ones are.
    interval_seconds = settings.health_check_interval_minutes * 60
    while True:
        if health_check_lock.locked():
            logger.info("Skipping scheduled health check - one is already running")
        else:
            async with health_check_lock:
                db = SessionLocal()
                try:
                    servers = db.execute(select(Server)).scalars().all()
                    targets = [
                        {"server_name": s.server_name, "ip": s.ip, "profile": s.profile} for s in servers
                    ]
                    if targets:
                        results = await asyncio.to_thread(ssh_ops.check_health, targets, logger.info)
                        persist_health_results(db, results)
                finally:
                    db.close()
        await asyncio.sleep(interval_seconds)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_schema_migrations()

    db = SessionLocal()
    try:
        seed_pics(db)
        seed_pic_teams(db)
        seed_known_server_pics(db)
        seed_allowed_ips(db)
        seed_cf_whitelist_ips(db)
        seed_admin_user(db)
        await run_sync(db)
    finally:
        db.close()

    task = asyncio.create_task(_periodic_sync_loop())
    cf_task = asyncio.create_task(_periodic_cf_sync_loop())
    health_task = asyncio.create_task(_periodic_health_check_loop())
    yield
    task.cancel()
    cf_task.cancel()
    health_task.cancel()


app = FastAPI(title="Server Ops API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def ip_allowlist_middleware(request: Request, call_next):
    """Blocks every request (including /user/login and /api/health) from an
    IP not in the allowlist, when settings.ip_allowlist_enforced is on. Off
    by default - see IP_ALLOWLIST_ENFORCED in .env. This is a backup layer;
    once this app is deployed behind Cloudflare, the primary block belongs
    at the Cloudflare edge (a firewall rule), which can't be bypassed by
    spoofing the headers get_client_ip() reads."""
    if not settings.ip_allowlist_enforced:
        return await call_next(request)
    client_ip = get_client_ip(request)
    db = SessionLocal()
    try:
        allowed = is_ip_allowed(db, client_ip)
    finally:
        db.close()
    if not allowed:
        return JSONResponse(status_code=403, content={"detail": "IP not allowed"})
    return await call_next(request)


app.include_router(auth.router)
app.include_router(domains.router)
app.include_router(domain_changes.router)
app.include_router(servers.router)
app.include_router(sync.router)
app.include_router(jobs.router)
app.include_router(cf_accounts.router)
app.include_router(cf_zones.router)
app.include_router(cf_whitelist.router)
app.include_router(pics.router)
app.include_router(access_control.router)
app.include_router(plugin_zips.router)
app.include_router(wp_org.router)
app.include_router(users.router)
app.include_router(dashboard.router)
app.include_router(settings_router.router)
app.include_router(site_credentials.router)
app.include_router(changelog.router)
app.include_router(backups.router)
app.include_router(theme_zips.router)
app.include_router(mu_plugins.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
