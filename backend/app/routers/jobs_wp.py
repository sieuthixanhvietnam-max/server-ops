import asyncio
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access_control_service import get_client_ip
from app.auth import get_current_username
from app.database import SessionLocal, get_db
from app.health_service import health_check_lock, persist_health_results
from app.job_service import create_job, launch_job
from app.models import Domain, Server
from app.ops import cf_ops, ssh_ops, wp_migrate_ops, wp_ops, wp_restore_ops, wp_security_ops, wp_user_ops
from app.ops.validation import is_template_domain, is_valid_domain
from app.routers.jobs_common import resolve_destination_server, resolve_domain_server
from app.site_credentials_service import persist_site_credentials

router = APIRouter(prefix="/api/jobs", tags=["jobs"], dependencies=[Depends(get_current_username)])


class CheckHealthRequest(BaseModel):
    server_names: list[str] | None = None


class ClonePair(BaseModel):
    source: str
    target: str
    # Set when `source` exists on more than one server (e.g. a blank WP
    # template deployed identically on every box) - disambiguates which
    # copy to clone from, since resolve_domain_server refuses to guess.
    source_server: str | None = None


class CloneWpsiteRequest(BaseModel):
    pairs: list[ClonePair]
    dry_run: bool = True


class CreateWpsiteRequest(BaseModel):
    source: str
    # Required (unlike ClonePair.source_server) - a template domain deployed
    # identically on every server is always ambiguous, and fan-out create
    # always targets exactly one server per run.
    source_server: str
    targets: list[str]
    dry_run: bool = True


class RemoveWpsiteRequest(BaseModel):
    domains: list[str]
    dry_run: bool = True
    # domain -> server_name, optional - disambiguates when a domain exists
    # on more than one server (the normal state right after a migrate: the
    # domain legitimately lives on both source and destination until the
    # source is removed). Domains not present in this map fall back to
    # resolve_domain_server's default behavior (fail if ambiguous).
    server_names: dict[str, str] | None = None


class MigrateEntry(BaseModel):
    domain: str
    # Disambiguates when `domain` is deployed on more than one server - same
    # idea as ClonePair.source_server.
    source_server: str | None = None
    # Required (unlike source_server): the destination domain doesn't exist
    # in the synced inventory yet, so it can only be an explicit server pick
    # - same reasoning as restore's destination_server.
    dest_server: str


class MigrateWpsiteRequest(BaseModel):
    entries: list[MigrateEntry]
    dry_run: bool = True


class ChangeWppassDomain(BaseModel):
    domain: str
    # Disambiguates when `domain` is deployed on more than one server (e.g.
    # a blank WP template like site-trang.com) - same idea as
    # ClonePair.source_server above.
    server_name: str | None = None


class ChangeWppassRequest(BaseModel):
    domains: list[ChangeWppassDomain]
    custom_password: str | None = None
    dry_run: bool = True


class RestoreEntry(BaseModel):
    domain: str
    source_server: str
    date: str | None = None  # empty/None = latest backup


class RestoreWpsiteRequest(BaseModel):
    destination_server: str
    entries: list[RestoreEntry]
    dry_run: bool = True


class ExportUsernamesRequest(BaseModel):
    domains: list[str]


class RemoveBackdoorUsersRequest(BaseModel):
    domains: list[str]


async def _resolve_clone_pairs(db: Session, pairs: list[ClonePair]) -> tuple[list[dict], list[str]]:
    """Shared by clone-wpsite (arbitrary 1:1 pairs) and create-wpsite (1
    source fanned out to N targets, expressed as pairs before reaching
    here) - validates domains, resolves each source's server, then blocks
    any target still missing a Cloudflare zone."""
    entries, errors = [], []
    for p in pairs:
        source, target = p.source.strip().lower(), p.target.strip().lower()
        if not is_valid_domain(source) or not is_valid_domain(target):
            errors.append(f"{source} -> {target}: invalid domain format")
            continue
        # Blocks overwriting a template that's already live (the whole point
        # of the guard - a template is the gold master other clones read
        # from), but NOT a brand-new "<server>.wp-template.site" that
        # doesn't exist yet - that's exactly how every template got created
        # in the first place (clone-wpsite from site-trang.com, same
        # server), so blocking unconditionally would make onboarding a new
        # server's template impossible going forward.
        if is_template_domain(target) and db.query(Domain).filter(Domain.domain == target).first():
            errors.append(f"{source} -> {target}: target là domain template đã tồn tại - bị chặn để tránh ghi đè")
            continue
        source_server = p.source_server.strip() if p.source_server else None
        server, err = resolve_domain_server(db, source, source_server)
        if err:
            errors.append(f"{source}: {err}")
            continue
        entries.append(
            {"source": source, "target": target, "ip": server["ip"], "profile": server["profile"]}
        )

    if entries:
        zone_status = await asyncio.to_thread(cf_ops.check_zone_status, [e["target"] for e in entries])
        ready, blocked = [], []
        for e in entries:
            if zone_status.get(e["target"], {}).get("has_zone"):
                ready.append(e)
            else:
                blocked.append(e)
        for e in blocked:
            errors.append(
                f"{e['source']} -> {e['target']}: domain đích chưa có zone trên Cloudflare - "
                "cần Add Domain trước"
            )
        entries = ready

    return entries, errors


@router.post("/check-health")
async def trigger_check_health(
    body: CheckHealthRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    stmt = select(Server)
    if body.server_names:
        stmt = stmt.where(Server.server_name.in_(body.server_names))
    servers = db.execute(stmt).scalars().all()
    if not servers:
        raise HTTPException(status_code=400, detail="No matching servers found")

    targets = [{"server_name": s.server_name, "ip": s.ip, "profile": s.profile} for s in servers]
    job = create_job(
        db, "check_health", {"server_names": body.server_names, "count": len(targets)}, username,
        get_client_ip(request),
    )

    async def worker(ctx):
        # Same lock the periodic sweep (main.py) holds while it runs - without
        # it, a manual trigger landing mid-sweep doubles concurrent SSH
        # connections (up to 40 instead of 20) and causes spurious timeouts
        # across otherwise-healthy servers.
        async with health_check_lock:
            results = await asyncio.to_thread(ssh_ops.check_health, targets, ctx.log)
            # Fresh session - the request's own `db` may already be closed by
            # the time this runs, since launch_job schedules it as a
            # background task that can outlive the HTTP response (same
            # reasoning as JobContext.log).
            health_db = SessionLocal()
            try:
                persist_health_results(health_db, results)
            finally:
                health_db.close()
        return results

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/clone-wpsite")
async def trigger_clone_wpsite(
    body: CloneWpsiteRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.pairs:
        raise HTTPException(status_code=400, detail="pairs list is empty")

    entries, errors = await _resolve_clone_pairs(db, body.pairs)

    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "clone_wpsite",
        {"pairs": [p.model_dump() for p in body.pairs], "dry_run": body.dry_run, "resolve_errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(wp_ops.clone_wpsite, entries, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/create-wpsite")
async def trigger_create_wpsite(
    body: CreateWpsiteRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    """Fan-out variant of clone-wpsite: 1 fixed template source cloned onto
    N brand-new target domains, all on the same server (source_server -
    always required here, since a reusable template is deployed identically
    on every box and there's no other signal to pick one). Mechanically
    identical to clone-wpsite (same wp_ops.clone_wpsite call) - kept as a
    separate endpoint/job_type only so Job History can distinguish "created
    new site" from "cloned/overwrote existing site"."""
    if not body.targets:
        raise HTTPException(status_code=400, detail="targets list is empty")
    if not body.source_server.strip():
        raise HTTPException(status_code=400, detail="source_server is required")

    pairs = [ClonePair(source=body.source, target=t, source_server=body.source_server) for t in body.targets]
    entries, errors = await _resolve_clone_pairs(db, pairs)

    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "create_wpsite",
        {
            "source": body.source, "source_server": body.source_server,
            "targets": body.targets, "dry_run": body.dry_run, "resolve_errors": errors,
        },
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(wp_ops.clone_wpsite, entries, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/remove-wpsite")
async def trigger_remove_wpsite(
    body: RemoveWpsiteRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")

    entries, errors = [], []
    for d in body.domains:
        d = d.strip().lower()
        if not is_valid_domain(d):
            errors.append(f"{d}: invalid domain format")
            continue
        server, err = resolve_domain_server(db, d, (body.server_names or {}).get(d))
        if err:
            errors.append(f"{d}: {err}")
            continue
        entries.append({"domain": d, "ip": server["ip"], "profile": server["profile"]})
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "remove_wpsite",
        {"domains": body.domains, "server_names": body.server_names, "dry_run": body.dry_run, "resolve_errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(wp_ops.remove_wpsite, entries, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/change-wppass")
async def trigger_change_wppass(
    body: ChangeWppassRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")

    entries, errors = [], []
    for d in body.domains:
        domain = d.domain.strip().lower()
        if not is_valid_domain(domain):
            errors.append(f"{domain}: invalid domain format")
            continue
        server, err = resolve_domain_server(db, domain, d.server_name)
        if err:
            errors.append(f"{domain}: {err}")
            continue
        password = body.custom_password or secrets.token_urlsafe(12)
        entries.append({
            "domain": domain, "ip": server["ip"], "profile": server["profile"],
            "server_name": server["server_name"], "new_password": password,
        })
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    # Never persist the plaintext password into params_json - only into the
    # job's result rows (same place the original CLI printed it to stdout).
    job = create_job(
        db, "change_wppass",
        {
            "domains": [d.domain for d in body.domains],
            "dry_run": body.dry_run,
            "custom_password": bool(body.custom_password),
            "resolve_errors": errors,
        },
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        results = await asyncio.to_thread(wp_ops.change_wppass, entries, ctx.log, body.dry_run)
        if not body.dry_run:
            # Fresh session - the request's own `db` may already be closed by
            # the time this runs (same reasoning as persist_health_results).
            cred_db = SessionLocal()
            try:
                persist_site_credentials(cred_db, results, username)
            finally:
                cred_db.close()
        return results

    launch_job(job.id, worker)
    return {"job_id": job.id}


def _resolve_restore_entries(
    db: Session, body_entries: list[RestoreEntry], destination_server: str,
) -> tuple[list[dict], list[str], object | None]:
    """Shared validation for both restore endpoints. Returns
    (entries, errors, server) - server is None (with an empty entries list)
    when the destination itself can't be resolved, since that fails the
    whole batch rather than just one row."""
    server = resolve_destination_server(db, destination_server)
    if not server:
        return [], [], None

    entries, errors = [], []
    seen_domains = set()
    for e in body_entries:
        domain = e.domain.strip().lower()
        source_server = e.source_server.strip()
        if not is_valid_domain(domain):
            errors.append(f"{domain}: invalid domain format")
            continue
        if not source_server:
            errors.append(f"{domain}: source_server is empty")
            continue
        if domain in seen_domains:
            continue
        seen_domains.add(domain)
        entries.append({
            "domain": domain, "source_server": source_server, "date": (e.date or "").strip() or None,
            "ip": server.ip, "profile": server.profile,
        })
    return entries, errors, server


@router.post("/restore-wpsite")
async def trigger_restore_wpsite(
    body: RestoreWpsiteRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.entries:
        raise HTTPException(status_code=400, detail="entries list is empty")
    entries, errors, server = _resolve_restore_entries(db, body.entries, body.destination_server)
    if not server:
        raise HTTPException(status_code=400, detail=f"destination server not found: {body.destination_server}")
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "restore_wpsite",
        {
            "destination_server": server.server_name, "entries": [e.model_dump() for e in body.entries],
            "dry_run": body.dry_run, "resolve_errors": errors,
        },
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(wp_restore_ops.restore_wpsite, entries, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


def _resolve_migrate_entries(
    db: Session, body_entries: list[MigrateEntry],
) -> tuple[list[dict], list[str]]:
    """Source resolved via resolve_domain_server (must already exist in the
    synced inventory); destination resolved per-entry via
    resolve_destination_server (an explicit server pick, same reasoning as
    restore - a migrate can target a different destination per domain in
    one batch, unlike restore's single shared destination)."""
    entries, errors = [], []
    for e in body_entries:
        domain = e.domain.strip().lower()
        if not is_valid_domain(domain):
            errors.append(f"{domain}: invalid domain format")
            continue
        source_server = e.source_server.strip() if e.source_server else None
        src, err = resolve_domain_server(db, domain, source_server)
        if err:
            errors.append(f"{domain}: {err}")
            continue
        dest = resolve_destination_server(db, e.dest_server.strip())
        if not dest:
            errors.append(f"{domain}: destination server not found: {e.dest_server}")
            continue
        if dest.ip == src["ip"]:
            errors.append(f"{domain}: source and destination are the same server")
            continue
        entries.append({
            "domain": domain, "source_ip": src["ip"], "source_profile": src["profile"],
            "source_server_name": src["server_name"],
            "dest_ip": dest.ip, "dest_profile": dest.profile,
        })
    return entries, errors


@router.post("/migrate-wpsite")
async def trigger_migrate_wpsite(
    body: MigrateWpsiteRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.entries:
        raise HTTPException(status_code=400, detail="entries list is empty")

    entries, errors = _resolve_migrate_entries(db, body.entries)
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "migrate_wpsite",
        {"entries": [e.model_dump() for e in body.entries], "dry_run": body.dry_run, "resolve_errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        # By id, not by label (ctx.start_target/finish_target): migrate runs
        # domains through a per-destination ThreadPoolExecutor
        # (ssh_migrate_workers), so the same domain string entered twice in
        # one batch would otherwise let two threads race over which row is
        # "the" pending/running target for that label.
        target_ids: list[int] = []
        if not body.dry_run:
            target_ids = ctx.init_targets([e["domain"] for e in entries])

        def on_start(idx: int, _domain: str):
            if target_ids:
                ctx.start_target_by_id(target_ids[idx])

        def on_finish(idx: int, _domain: str, status: str, note: str = ""):
            if target_ids:
                ctx.finish_target_by_id(target_ids[idx], status, note)

        return await asyncio.to_thread(
            wp_migrate_ops.migrate_wpsite, entries, ctx.log, body.dry_run,
            on_start=on_start, on_finish=on_finish,
        )

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/export-usernames")
async def trigger_export_usernames(
    body: ExportUsernamesRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    """Live pull (SSH + WP-CLI, not from synced/manually-entered data) of
    every administrator-role username per domain - for exporting a CSV of
    WP admin logins. `domains` is usually every domain the caller's own
    list/filter currently matches (Domains page), not necessarily the
    entire inventory."""
    domains = sorted({d.strip().lower() for d in body.domains if d.strip()})
    if not domains:
        raise HTTPException(status_code=400, detail="domains list is empty")

    rows = db.execute(select(Domain).where(Domain.domain.in_(domains))).scalars().all()
    entries = [
        {"domain": r.domain, "ip": r.server_ip, "profile": r.profile, "server_name": r.server_name}
        for r in rows
    ]
    if not entries:
        raise HTTPException(status_code=400, detail="No matching domains found in inventory")

    job = create_job(db, "export_usernames", {"count": len(entries)}, username, get_client_ip(request))

    async def worker(ctx):
        ctx.init_targets([e["domain"] for e in entries])
        return await asyncio.to_thread(
            wp_user_ops.get_admin_usernames, entries, ctx.log,
            on_start=ctx.start_target, on_finish=ctx.finish_target,
        )

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/remove-backdoor-users")
async def trigger_remove_backdoor_users(
    body: RemoveBackdoorUsersRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    """Incident response for the wp2shell backdoor (CVE-2026-63030/
    CVE-2026-60137) - deletes both tiers (see wp_security_ops.BACKDOOR_SCRIPT):
    "chắc chắn" (username `w2s_<hex>` or email ending `@wp2shell.local`,
    the tool's own published signature) and "nghi vấn" (bare 12-20 char
    hex username, no wp2shell.local marker - same tool with the signature
    dropped, per the session's 2026-10-06 investigation). Each deleted/
    skipped entry is tagged with which tier matched. Re-checks live via
    wp-cli per domain, so it's safe to run against the whole inventory -
    a domain with no match is simply a no-op."""
    domains = sorted({d.strip().lower() for d in body.domains if d.strip()})
    if not domains:
        raise HTTPException(status_code=400, detail="domains list is empty")

    rows = db.execute(select(Domain).where(Domain.domain.in_(domains))).scalars().all()
    entries = [
        {"domain": r.domain, "ip": r.server_ip, "profile": r.profile, "server_name": r.server_name}
        for r in rows
    ]
    if not entries:
        raise HTTPException(status_code=400, detail="No matching domains found in inventory")

    job = create_job(db, "remove_backdoor_users", {"count": len(entries)}, username, get_client_ip(request))

    async def worker(ctx):
        ctx.init_targets([e["domain"] for e in entries])
        return await asyncio.to_thread(
            wp_security_ops.remove_backdoor_users, entries, ctx.log,
            on_start=ctx.start_target, on_finish=ctx.finish_target,
        )

    launch_job(job.id, worker)
    return {"job_id": job.id}
