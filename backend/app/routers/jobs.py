import asyncio
import json
import os
import secrets
from typing import Literal

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.access_control_service import get_client_ip
from app.auth import get_current_username
from app.cf_account_service import (
    cf_sync_lock,
    discover_master_accounts,
    sync_all_accounts,
    sync_one_account,
)
from app.cf_whitelist_service import get_active_whitelist_ips
from app.config import settings
from app.crypto import decrypt_token
from app.database import SessionLocal, get_db
from app.health_service import health_check_lock, persist_health_results
from app.job_service import create_job, launch_job
from app.models import CfAccount, CfZone, Domain, IndexerCredential, Job, MuPlugin, PluginZip, Server, ThemeZip
from app.ops import (
    cf_ops,
    index_ops,
    ssh_ops,
    wp_maintenance_ops,
    wp_migrate_ops,
    wp_mu_plugin_ops,
    wp_ops,
    wp_plugin_ops,
    wp_restore_ops,
)
from app.ops.validation import is_valid_domain, is_valid_ip, validate_domains
from app.pic_service import suggest_cf_account_for_ip
from app.site_credentials_service import persist_site_credentials

router = APIRouter(prefix="/api/jobs", tags=["jobs"], dependencies=[Depends(get_current_username)])


class CheckHealthRequest(BaseModel):
    server_names: list[str] | None = None


class CheckDomainsRequest(BaseModel):
    domains: list[str]


class ClonePair(BaseModel):
    source: str
    target: str
    # Set when `source` exists on more than one server (e.g. a blank WP
    # template deployed identically on every box) - disambiguates which
    # copy to clone from, since _resolve_domain_server refuses to guess.
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
    # _resolve_domain_server's default behavior (fail if ambiguous).
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


class CfAddRequest(BaseModel):
    domains: list[str]
    ip: str
    dry_run: bool = True
    cf_account_id: int | None = None  # our internal CfAccount.id - None = auto-resolve by PIC
    force_reconfigure: bool = False  # re-apply DNS/SSL/HTTPS/firewall even if the zone already exists


class CfAddGroup(BaseModel):
    domains: list[str]
    ip: str
    cf_account_id: int | None = None


class CfAddBatchRequest(BaseModel):
    # Each group can target a different IP/CF account (e.g. one per PIC) -
    # unlike CfAddRequest above, which is scoped to exactly one of each.
    # Runs as a single job with one combined result list instead of one job
    # per group, so the caller isn't stuck copy-pasting N separate results.
    groups: list[CfAddGroup]
    dry_run: bool = True
    force_reconfigure: bool = False


class CfRemoveRequest(BaseModel):
    domains: list[str]
    dry_run: bool = True


class CfChangeIpRequest(BaseModel):
    domains: list[str]
    new_ip: str
    dry_run: bool = True


class CfOriginPortRequest(BaseModel):
    domains: list[str]
    action: Literal["set", "clear"]
    port: int = 8888
    dry_run: bool = True


class RedirectMapping(BaseModel):
    domain: str
    target_url: str
    mode: Literal["url_to_url", "url_to_homepage"] = "url_to_homepage"


class CfRedirectRequest(BaseModel):
    mappings: list[RedirectMapping]
    dry_run: bool = True
    crawl_sitemap: bool = False


class CfRedirectRemoveRequest(BaseModel):
    domains: list[str]
    dry_run: bool = True


class CrawlSitemapRequest(BaseModel):
    domains: list[str]


class ForceIndexEntry(BaseModel):
    domain: str
    urls: list[str] = []


class ForceIndexRequest(BaseModel):
    service: Literal["speedyindex", "instantindexer", "linksindexer", "ralfyindex"]
    entries: list[ForceIndexEntry]
    dry_run: bool = True


class CfFirewallUpdateRequest(BaseModel):
    mode: Literal["domains", "all_zones"]
    domains: list[str] = []
    dry_run: bool = True


class CfPurgeCacheRequest(BaseModel):
    domains: list[str]
    dry_run: bool = True


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


class MaintenanceClearCacheRequest(BaseModel):
    domains: list[str]


class MaintenanceClearCommentsRequest(BaseModel):
    domains: list[str]
    disable_new: bool = True
    dry_run: bool = True


class MaintenanceFixPermissionsRequest(BaseModel):
    domains: list[str]
    dry_run: bool = True


class RestoreEntry(BaseModel):
    domain: str
    source_server: str
    date: str | None = None  # empty/None = latest backup


class RestoreWpsiteRequest(BaseModel):
    destination_server: str
    entries: list[RestoreEntry]
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


def _resolve_domain_server(
    db: Session, domain: str, server_name: str | None = None
) -> tuple[dict | None, str | None]:
    """Look up which server a domain is deployed on, from our synced
    inventory. Returns (None, error) if not found or ambiguous (found on
    more than one server) - we never guess which one to target for a
    destructive action. Pass server_name (from the caller, e.g. ClonePair.
    source_server) to disambiguate explicitly instead - common for a domain
    like a blank WP template deployed identically on every box, where
    "ambiguous" isn't a data problem, just a name that needs a server
    alongside it."""
    stmt = select(Domain).where(Domain.domain == domain)
    if server_name:
        stmt = stmt.where(Domain.server_name == server_name)
    rows = db.execute(stmt).scalars().all()
    if not rows:
        detail = f"domain not found on server {server_name!r}" if server_name else "domain not found in synced inventory"
        return None, detail
    if len(rows) > 1:
        servers = ", ".join(sorted({r.server_name for r in rows}))
        return None, f"ambiguous - found on {len(rows)} servers ({servers})"
    row = rows[0]
    return {"ip": row.server_ip, "profile": row.profile, "server_name": row.server_name}, None


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
        source_server = p.source_server.strip() if p.source_server else None
        server, err = _resolve_domain_server(db, source, source_server)
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


def _resolve_plugin_entries(db: Session, domains: list[str]) -> tuple[list[dict], list[str]]:
    entries, errors = [], []
    for d in domains:
        d = d.strip().lower()
        if not is_valid_domain(d):
            errors.append(f"{d}: invalid domain format")
            continue
        server, err = _resolve_domain_server(db, d)
        if err:
            errors.append(f"{d}: {err}")
            continue
        entries.append({"domain": d, "ip": server["ip"], "profile": server["profile"]})
    return entries, errors


def _resolve_destination_server(db: Session, server_name: str) -> Server | None:
    """Restore's destination doesn't go through _resolve_domain_server - the
    domain being restored may no longer exist anywhere in the synced
    inventory (that's the whole point of a disaster-recovery restore), so
    the destination is a direct, explicit Server pick instead."""
    return db.execute(select(Server).where(Server.server_name == server_name)).scalar_one_or_none()


def _job_out(job: Job) -> dict:
    return {
        "id": job.id,
        "job_type": job.job_type,
        "status": job.status,
        "created_by": job.created_by,
        "created_ip": job.created_ip,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "params": json.loads(job.params_json),
        "log": job.log,
        "result": json.loads(job.result_json),
    }


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


@router.post("/check-ns")
async def trigger_check_ns(
    body: CheckDomainsRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    job = create_job(db, "check_ns", {"domains": body.domains}, username, get_client_ip(request))

    async def worker(ctx):
        return await asyncio.to_thread(cf_ops.check_ns, body.domains, ctx.log)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/check-ip")
async def trigger_check_ip(
    body: CheckDomainsRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    job = create_job(db, "check_ip", {"domains": body.domains}, username, get_client_ip(request))

    async def worker(ctx):
        return await asyncio.to_thread(cf_ops.check_ip, body.domains, ctx.log)

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
        server, err = _resolve_domain_server(db, d, (body.server_names or {}).get(d))
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
        server, err = _resolve_domain_server(db, domain, d.server_name)
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


@router.post("/cf-add")
async def trigger_cf_add(
    body: CfAddRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    if not is_valid_ip(body.ip):
        raise HTTPException(status_code=400, detail="invalid IP address")

    valid, invalid = validate_domains(body.domains)
    if not valid:
        raise HTTPException(status_code=400, detail="No valid domains: " + ", ".join(invalid))
    entries = [{"domain": d, "ip": body.ip} for d in valid]

    target_account = None
    account_note = "dùng account mặc định (.env)"
    if body.cf_account_id:
        target_account = db.get(CfAccount, body.cf_account_id)
        if not target_account:
            raise HTTPException(status_code=400, detail="cf_account_id not found")
        account_note = f"account chỉ định: {target_account.label}"
    else:
        suggestion = suggest_cf_account_for_ip(db, body.ip)
        if suggestion["suggested_account_id"]:
            target_account = db.get(CfAccount, suggestion["suggested_account_id"])
            account_note = (
                f"tự gợi ý theo PIC {suggestion['pics']} (server {suggestion['matched_server']}): "
                f"{target_account.label}"
            )
        elif suggestion["matched_server"]:
            account_note = f"server {suggestion['matched_server']} chưa gán PIC - dùng account mặc định (.env)"
        else:
            account_note = f"IP {body.ip} không khớp server nào đã sync - dùng account mặc định (.env)"

    api_token = settings.cf_api_token
    cf_account_id = None
    account_label = target_account.label if target_account else "Mặc định (.env)"
    if target_account:
        cf_account_id = target_account.cf_account_id
        if target_account.source == "manual" and target_account.api_token_encrypted:
            api_token = decrypt_token(target_account.api_token_encrypted)

    whitelist_ips = get_active_whitelist_ips(db)

    job = create_job(
        db, "cf_add",
        {
            "domains": body.domains, "ip": body.ip, "dry_run": body.dry_run, "invalid": invalid,
            "target_account": target_account.label if target_account else None,
        },
        username, get_client_ip(request),
    )

    async def worker(ctx):
        ctx.log(f"[info] {account_note}")
        for d in invalid:
            ctx.log(f"[skip] {d}: invalid domain format")
        return await asyncio.to_thread(
            cf_ops.add_domains, entries, ctx.log, whitelist_ips, body.dry_run, api_token, cf_account_id,
            body.force_reconfigure, account_label,
        )

    launch_job(job.id, worker)
    return {"job_id": job.id}


def _resolve_cf_add_group(db: Session, group: CfAddGroup) -> dict:
    """Same account/token resolution as trigger_cf_add above, factored out
    so trigger_cf_add_batch can run it once per group before the job starts
    (need the HTTPException-worthy validation to happen synchronously, not
    buried inside the background worker)."""
    valid, invalid = validate_domains(group.domains)
    entries = [{"domain": d, "ip": group.ip} for d in valid]

    target_account = None
    account_note = "dùng account mặc định (.env)"
    if group.cf_account_id:
        target_account = db.get(CfAccount, group.cf_account_id)
        if not target_account:
            raise HTTPException(status_code=400, detail=f"cf_account_id not found: {group.cf_account_id}")
        account_note = f"account chỉ định: {target_account.label}"
    else:
        suggestion = suggest_cf_account_for_ip(db, group.ip)
        if suggestion["suggested_account_id"]:
            target_account = db.get(CfAccount, suggestion["suggested_account_id"])
            account_note = (
                f"tự gợi ý theo PIC {suggestion['pics']} (server {suggestion['matched_server']}): "
                f"{target_account.label}"
            )
        elif suggestion["matched_server"]:
            account_note = f"server {suggestion['matched_server']} chưa gán PIC - dùng account mặc định (.env)"
        else:
            account_note = f"IP {group.ip} không khớp server nào đã sync - dùng account mặc định (.env)"

    api_token = settings.cf_api_token
    cf_account_id = None
    account_label = target_account.label if target_account else "Mặc định (.env)"
    if target_account:
        cf_account_id = target_account.cf_account_id
        if target_account.source == "manual" and target_account.api_token_encrypted:
            api_token = decrypt_token(target_account.api_token_encrypted)

    return {
        "entries": entries, "invalid": invalid, "api_token": api_token, "cf_account_id": cf_account_id,
        "account_label": account_label, "account_note": account_note,
    }


@router.post("/cf-add-batch")
async def trigger_cf_add_batch(
    body: CfAddBatchRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.groups:
        raise HTTPException(status_code=400, detail="groups list is empty")
    for g in body.groups:
        if not g.domains:
            raise HTTPException(status_code=400, detail="a group has an empty domains list")
        if not is_valid_ip(g.ip):
            raise HTTPException(status_code=400, detail=f"invalid IP address: {g.ip}")

    resolved = [_resolve_cf_add_group(db, g) for g in body.groups]
    if not any(rg["entries"] for rg in resolved):
        all_invalid = [d for rg in resolved for d in rg["invalid"]]
        raise HTTPException(status_code=400, detail="No valid domains in any group: " + ", ".join(all_invalid))

    whitelist_ips = get_active_whitelist_ips(db)

    job = create_job(
        db, "cf_add",
        {
            "groups": [{"domains": g.domains, "ip": g.ip, "cf_account_id": g.cf_account_id} for g in body.groups],
            "dry_run": body.dry_run,
        },
        username, get_client_ip(request),
    )

    async def worker(ctx):
        results = []
        for rg in resolved:
            for d in rg["invalid"]:
                ctx.log(f"[skip] {d}: invalid domain format")
            if not rg["entries"]:
                continue
            ctx.log(f"[info] {rg['account_note']}")
            try:
                group_results = await asyncio.to_thread(
                    cf_ops.add_domains, rg["entries"], ctx.log, whitelist_ips, body.dry_run,
                    rg["api_token"], rg["cf_account_id"], body.force_reconfigure, rg["account_label"],
                )
                results.extend(group_results)
            except Exception as exc:
                ctx.log(f"[fail] group [{rg['account_label']}]: unexpected error - {exc}")
                results.extend(
                    {
                        "domain": e["domain"], "ip": e["ip"], "status": "error",
                        "note": f"unexpected error: {exc}", "nameservers": [], "zone_id": None,
                        "account_label": rg["account_label"], "dns_status": None,
                    }
                    for e in rg["entries"]
                )
        return results

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/cf-remove")
async def trigger_cf_remove(
    body: CfRemoveRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")

    valid, invalid = validate_domains(body.domains)
    if not valid:
        raise HTTPException(status_code=400, detail="No valid domains: " + ", ".join(invalid))

    job = create_job(
        db, "cf_remove",
        {"domains": body.domains, "dry_run": body.dry_run, "invalid": invalid},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for d in invalid:
            ctx.log(f"[skip] {d}: invalid domain format")
        return await asyncio.to_thread(cf_ops.delete_zones, valid, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/cf-change-ip")
async def trigger_cf_change_ip(
    body: CfChangeIpRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    if not is_valid_ip(body.new_ip):
        raise HTTPException(status_code=400, detail="invalid IP address")

    valid, invalid = validate_domains(body.domains)
    if not valid:
        raise HTTPException(status_code=400, detail="No valid domains: " + ", ".join(invalid))

    job = create_job(
        db, "cf_change_ip",
        {"domains": body.domains, "new_ip": body.new_ip, "dry_run": body.dry_run, "invalid": invalid},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for d in invalid:
            ctx.log(f"[skip] {d}: invalid domain format")
        return await asyncio.to_thread(cf_ops.change_ip, valid, body.new_ip, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/cf-origin-port")
async def trigger_cf_origin_port(
    body: CfOriginPortRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    if body.action == "set" and not (1 <= body.port <= 65535):
        raise HTTPException(status_code=400, detail="invalid port")

    valid, invalid = validate_domains(body.domains)
    if not valid:
        raise HTTPException(status_code=400, detail="No valid domains: " + ", ".join(invalid))

    job = create_job(
        db, "cf_origin_port",
        {
            "domains": body.domains, "action": body.action, "port": body.port,
            "dry_run": body.dry_run, "invalid": invalid,
        },
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for d in invalid:
            ctx.log(f"[skip] {d}: invalid domain format")
        return await asyncio.to_thread(
            cf_ops.update_origin_port, valid, body.action, body.port, ctx.log, body.dry_run
        )

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/cf-redirect")
async def trigger_cf_redirect(
    body: CfRedirectRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.mappings:
        raise HTTPException(status_code=400, detail="mappings list is empty")

    entries, errors = [], []
    for m in body.mappings:
        d = m.domain.strip().lower()
        if not is_valid_domain(d):
            errors.append(f"{d}: invalid domain format")
            continue
        target = m.target_url.strip()
        target_host = target
        for prefix in ("https://", "http://"):
            if target_host.startswith(prefix):
                target_host = target_host[len(prefix):]
                break
        target_host = target_host.split("/")[0]
        if not target_host or not is_valid_domain(target_host):
            errors.append(f"{d}: target is not a valid domain/URL")
            continue
        entries.append({"domain": d, "target_url": target, "mode": m.mode})
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "cf_redirect",
        {"mappings": [m.model_dump() for m in body.mappings], "dry_run": body.dry_run,
         "crawl_sitemap": body.crawl_sitemap, "errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(
            cf_ops.sync_redirects, entries, ctx.log, body.dry_run, body.crawl_sitemap,
        )

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/cf-redirect-remove")
async def trigger_cf_redirect_remove(
    body: CfRedirectRemoveRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")

    valid, invalid = validate_domains(body.domains)
    if not valid:
        raise HTTPException(status_code=400, detail="No valid domains: " + ", ".join(invalid))

    job = create_job(
        db, "cf_redirect_remove",
        {"domains": body.domains, "dry_run": body.dry_run, "invalid": invalid},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for d in invalid:
            ctx.log(f"[skip] {d}: invalid domain format")
        return await asyncio.to_thread(cf_ops.remove_redirects, valid, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/crawl-sitemap")
async def trigger_crawl_sitemap(
    body: CrawlSitemapRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    """Read-only, free - discovers each domain's sitemap and lists its URLs.
    Used by the Force Index page's preview step, and independently of any
    redirect job (a domain doesn't need to have just been 301'd)."""
    valid, invalid = validate_domains(body.domains)
    if not valid:
        raise HTTPException(status_code=400, detail="No valid domains: " + ", ".join(invalid))

    job = create_job(
        db, "crawl_sitemap",
        {"domains": body.domains, "invalid": invalid},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for d in invalid:
            ctx.log(f"[skip] {d}: invalid domain format")
        return await asyncio.to_thread(index_ops.crawl_sitemaps, valid, ctx.log)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/force-index")
async def trigger_force_index(
    body: ForceIndexRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.entries:
        raise HTTPException(status_code=400, detail="entries list is empty")

    cred = db.execute(
        select(IndexerCredential).where(IndexerCredential.service == body.service)
    ).scalar_one_or_none()
    if cred is None:
        raise HTTPException(
            status_code=400,
            detail=f"Chưa cấu hình API key cho {body.service} - vào Cài đặt hệ thống để thêm",
        )
    # Decrypted here (request scope) and passed into the worker closure -
    # never persisted into job.params_json, which is stored/shown forever
    # in Job History.
    api_key = decrypt_token(cred.api_key_encrypted)

    entries = [{"domain": e.domain.strip().lower(), "urls": e.urls} for e in body.entries]

    job = create_job(
        db, "force_index",
        {"service": body.service, "domains": [e["domain"] for e in entries], "dry_run": body.dry_run},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        return await asyncio.to_thread(
            index_ops.force_index_submit, entries, body.service, api_key, ctx.log, body.dry_run
        )

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/cf-firewall-update")
async def trigger_cf_firewall_update(
    body: CfFirewallUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    whitelist_ips = get_active_whitelist_ips(db)
    if not whitelist_ips:
        raise HTTPException(
            status_code=400,
            detail="Chưa có IP whitelist nào đang bật - thêm ở trang Whitelist IP trước",
        )

    if body.mode == "domains":
        if not body.domains:
            raise HTTPException(status_code=400, detail="domains list is empty")
        valid, invalid = validate_domains(body.domains)
        if not valid:
            raise HTTPException(status_code=400, detail="No valid domains: " + ", ".join(invalid))

        job = create_job(
            db, "cf_firewall_update",
            {"mode": "domains", "domains": body.domains, "dry_run": body.dry_run, "invalid": invalid},
            username, get_client_ip(request),
        )

        async def worker(ctx):
            for d in invalid:
                ctx.log(f"[skip] {d}: invalid domain format")
            return await asyncio.to_thread(cf_ops.update_firewall, ctx.log, whitelist_ips, body.dry_run, valid)

        launch_job(job.id, worker)
        return {"job_id": job.id}

    job = create_job(
        db, "cf_firewall_update",
        {"mode": "all_zones", "dry_run": body.dry_run},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        return await asyncio.to_thread(cf_ops.update_firewall, ctx.log, whitelist_ips, body.dry_run, None)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/cf-audit-redirects")
async def trigger_cf_audit_redirects(
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    job = create_job(db, "cf_audit_redirects", {}, username, get_client_ip(request))

    async def worker(ctx):
        return await asyncio.to_thread(cf_ops.audit_page_rules, ctx.log)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/cf-redirect-inventory")
async def trigger_cf_redirect_inventory(
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    """Full "what redirects to what" report for every domain actually hosted
    on a managed server - not every zone in the CF account (that's
    audit_page_rules' job). zone_id lookup comes entirely from the already-
    synced Domain/CfZone tables, no live Cloudflare API call needed for the
    matching step."""
    managed_domains = set(db.execute(select(Domain.domain).distinct()).scalars().all())
    zone_map: dict[str, str] = {}
    for domain, zone_id in db.execute(select(CfZone.domain, CfZone.zone_id)):
        zone_map.setdefault(domain, zone_id)

    zone_pairs = [{"domain": d, "zone_id": zone_map[d]} for d in managed_domains if d in zone_map]
    no_zone_count = len(managed_domains) - len(zone_pairs)
    if not zone_pairs:
        raise HTTPException(status_code=400, detail="Không có domain nào đang quản lý khớp được zone Cloudflare")

    job = create_job(
        db, "cf_redirect_inventory",
        {"domain_count": len(zone_pairs), "no_zone_count": no_zone_count},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        if no_zone_count:
            ctx.log(f"[info] {no_zone_count} domain đang quản lý không có zone Cloudflare - bỏ qua")
        return await asyncio.to_thread(cf_ops.list_redirects, zone_pairs, ctx.log)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/cf-purge-cache")
async def trigger_cf_purge_cache(
    body: CfPurgeCacheRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")

    valid, invalid = validate_domains(body.domains)
    if not valid:
        raise HTTPException(status_code=400, detail="No valid domains: " + ", ".join(invalid))

    job = create_job(
        db, "cf_purge_cache",
        {"domains": body.domains, "dry_run": body.dry_run, "invalid": invalid},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for d in invalid:
            ctx.log(f"[skip] {d}: invalid domain format")
        return await asyncio.to_thread(cf_ops.purge_cache, valid, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/cf-accounts-sync")
async def trigger_cf_accounts_sync(
    request: Request,
    account_id: int | None = None,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    job = create_job(db, "cf_accounts_sync", {"account_id": account_id}, username, get_client_ip(request))

    async def worker(ctx):
        async with cf_sync_lock:
            if account_id:
                return [await asyncio.to_thread(sync_one_account, account_id, ctx.log)]
            return await asyncio.to_thread(sync_all_accounts, ctx.log)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/cf-master-discover")
async def trigger_cf_master_discover(
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    job = create_job(db, "cf_master_discover", {}, username, get_client_ip(request))

    async def worker(ctx):
        async with cf_sync_lock:
            return await asyncio.to_thread(discover_master_accounts, ctx.log)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/plugin-check")
async def trigger_plugin_check(
    body: PluginDomainsRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    entries, errors = _resolve_plugin_entries(db, body.domains)
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
    entries, errors = _resolve_plugin_entries(db, body.domains)
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
    entries, errors = _resolve_plugin_entries(db, body.domains)
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
    entries, errors = _resolve_plugin_entries(db, body.domains)
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
    entries, errors = _resolve_plugin_entries(db, body.domains)
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

    entries, errors = _resolve_plugin_entries(db, body.domains)
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

    entries, errors = _resolve_plugin_entries(db, body.domains)
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

    entries, errors = _resolve_plugin_entries(db, body.domains)
    if not entries:
        raise HTTPException(status_code=400, detail="No valid entries: " + "; ".join(errors))

    job = create_job(
        db, "mu_plugin_install",
        {"domains": body.domains, "dry_run": body.dry_run, "filename": row.filename, "resolve_errors": errors},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        for e in errors:
            ctx.log(f"[skip] {e}")
        return await asyncio.to_thread(wp_mu_plugin_ops.install_mu_plugin, entries, mu_plugin, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.post("/maintenance-clear-cache")
async def trigger_maintenance_clear_cache(
    body: MaintenanceClearCacheRequest,
    request: Request,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not body.domains:
        raise HTTPException(status_code=400, detail="domains list is empty")
    entries, errors = _resolve_plugin_entries(db, body.domains)
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
    entries, errors = _resolve_plugin_entries(db, body.domains)
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
    entries, errors = _resolve_plugin_entries(db, body.domains)
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


def _resolve_restore_entries(
    db: Session, body_entries: list[RestoreEntry], destination_server: str,
) -> tuple[list[dict], list[str], object | None]:
    """Shared validation for both restore endpoints. Returns
    (entries, errors, server) - server is None (with an empty entries list)
    when the destination itself can't be resolved, since that fails the
    whole batch rather than just one row."""
    server = _resolve_destination_server(db, destination_server)
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
    """Source resolved via _resolve_domain_server (must already exist in the
    synced inventory); destination resolved per-entry via
    _resolve_destination_server (an explicit server pick, same reasoning as
    restore - a migrate can target a different destination per domain in
    one batch, unlike restore's single shared destination)."""
    entries, errors = [], []
    for e in body_entries:
        domain = e.domain.strip().lower()
        if not is_valid_domain(domain):
            errors.append(f"{domain}: invalid domain format")
            continue
        source_server = e.source_server.strip() if e.source_server else None
        src, err = _resolve_domain_server(db, domain, source_server)
        if err:
            errors.append(f"{domain}: {err}")
            continue
        dest = _resolve_destination_server(db, e.dest_server.strip())
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
        return await asyncio.to_thread(wp_migrate_ops.migrate_wpsite, entries, ctx.log, body.dry_run)

    launch_job(job.id, worker)
    return {"job_id": job.id}


@router.get("/{job_id}")
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_out(job)


@router.get("")
def list_jobs(
    db: Session = Depends(get_db),
    current: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=200),
    job_type: str | None = Query(None),
    status: str | None = Query(None, description="'pending', 'running', 'success' or 'failed'"),
    created_by: str | None = Query(None),
    created_ip: str | None = Query(None, description="Exact IP match"),
    date_from: datetime | None = Query(None, description="created_at >= this time (ISO 8601)"),
    date_to: datetime | None = Query(None, description="created_at <= this time (ISO 8601)"),
):
    stmt = select(Job)
    if job_type:
        stmt = stmt.where(Job.job_type == job_type)
    if status:
        stmt = stmt.where(Job.status == status)
    if created_by:
        stmt = stmt.where(Job.created_by.ilike(f"%{created_by}%"))
    if created_ip:
        stmt = stmt.where(Job.created_ip == created_ip)
    if date_from:
        stmt = stmt.where(Job.created_at >= date_from)
    if date_to:
        stmt = stmt.where(Job.created_at <= date_to)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = (
        db.execute(stmt.order_by(Job.id.desc()).offset((current - 1) * pageSize).limit(pageSize))
        .scalars()
        .all()
    )
    return {"data": [_job_out(r) for r in rows], "total": total, "success": True}
