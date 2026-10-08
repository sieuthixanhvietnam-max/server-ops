import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access_control_service import get_client_ip
from app.auth import get_current_username
from app.cf_account_service import cf_sync_lock, discover_master_accounts, sync_all_accounts, sync_one_account
from app.config import settings
from app.crypto import decrypt_token
from app.database import get_db
from app.firewall_preset_service import get_default_preset_params, preset_to_params
from app.job_service import create_job, launch_job
from app.models import CfAccount, CfZone, Domain, FirewallPreset, IndexerCredential
from app.ops import cf_firewall_ops, cf_ops, index_ops
from app.ops.validation import is_valid_domain, is_valid_ip, validate_domains
from app.pic_service import suggest_cf_account_for_ip

router = APIRouter(prefix="/api/jobs", tags=["jobs"], dependencies=[Depends(get_current_username)])


class CheckDomainsRequest(BaseModel):
    domains: list[str]


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
    preset_id: int


class CfPurgeCacheRequest(BaseModel):
    domains: list[str]
    dry_run: bool = True


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

    firewall_preset = get_default_preset_params(db)

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
            cf_ops.add_domains, entries, ctx.log, body.dry_run, api_token, cf_account_id,
            body.force_reconfigure, account_label, firewall_preset,
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

    firewall_preset = get_default_preset_params(db)

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
                    cf_ops.add_domains, rg["entries"], ctx.log, body.dry_run,
                    rg["api_token"], rg["cf_account_id"], body.force_reconfigure, rg["account_label"],
                    firewall_preset,
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
    preset_row = db.get(FirewallPreset, body.preset_id)
    if not preset_row:
        raise HTTPException(status_code=404, detail="Firewall preset not found")
    preset = preset_to_params(preset_row)

    if body.mode == "domains":
        if not body.domains:
            raise HTTPException(status_code=400, detail="domains list is empty")
        valid, invalid = validate_domains(body.domains)
        if not valid:
            raise HTTPException(status_code=400, detail="No valid domains: " + ", ".join(invalid))

        job = create_job(
            db, "cf_firewall_update",
            {
                "mode": "domains", "domains": body.domains, "dry_run": body.dry_run, "invalid": invalid,
                "preset": preset["name"],
            },
            username, get_client_ip(request),
        )

        async def worker(ctx):
            for d in invalid:
                ctx.log(f"[skip] {d}: invalid domain format")
            return await asyncio.to_thread(cf_firewall_ops.update_firewall, ctx.log, body.dry_run, valid, preset)

        launch_job(job.id, worker)
        return {"job_id": job.id}

    job = create_job(
        db, "cf_firewall_update",
        {"mode": "all_zones", "dry_run": body.dry_run, "preset": preset["name"]},
        username, get_client_ip(request),
    )

    async def worker(ctx):
        return await asyncio.to_thread(cf_firewall_ops.update_firewall, ctx.log, body.dry_run, None, preset)

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
    if account_id is not None and not db.get(CfAccount, account_id):
        raise HTTPException(status_code=404, detail="Không tìm thấy CF account")

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
