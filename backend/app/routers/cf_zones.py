import re

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_username
from app.database import get_db
from app.models import CfAccount, CfZone, Domain
from app.ops import cf_ops
from app.pic_service import UNASSIGNED, get_account_pics_map, get_server_pics_map

router = APIRouter(
    prefix="/api/cf-zones", tags=["cf-zones"], dependencies=[Depends(get_current_username)]
)

_SORTABLE_KEYS = {
    "domain", "match_status", "zone_status", "plan", "cf_account_label",
    "server_name", "server_ip", "zone_count_on_domain", "server_count_on_domain",
}


@router.get("")
def list_cf_zones(
    db: Session = Depends(get_db),
    current: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=50000, description="Higher ceiling than the table needs (this merged view can run past 20k rows), to cover full CSV exports"),
    domain: str | None = Query(None, description="Filter by domain substring"),
    domains: str | None = Query(
        None, description="Exact-match batch filter: domains separated by newline or comma"
    ),
    account_id: int | None = Query(None),
    match_status: str | None = Query(None, description="both|cf_only|server_only"),
    plan: str | None = Query(None, description="Filter by plan substring"),
    zone_status: str | None = Query(None, description="Filter by zone status substring"),
    pic: str | None = Query(None, description="PIC code (via server or CF account), or '__unassigned__'"),
    sort_field: str | None = Query(None),
    sort_order: str | None = Query(None, description="'ascend' or 'descend'"),
):
    zone_rows = db.execute(select(CfZone)).scalars().all()
    domain_rows = db.execute(select(Domain.domain, Domain.server_name, Domain.server_ip)).all()
    accounts_by_id = {a.id: a for a in db.execute(select(CfAccount)).scalars().all()}

    zones_by_domain: dict[str, list[CfZone]] = {}
    for z in zone_rows:
        zones_by_domain.setdefault(z.domain, []).append(z)

    servers_by_domain: dict[str, list] = {}
    for row in domain_rows:
        servers_by_domain.setdefault(row.domain, []).append(row)

    all_domains = set(zones_by_domain) | set(servers_by_domain)

    merged = []
    for d in all_domains:
        zones = zones_by_domain.get(d, [])
        servers = servers_by_domain.get(d, [])
        status = "both" if zones and servers else ("cf_only" if zones else "server_only")
        zone = zones[0] if zones else None
        account = accounts_by_id.get(zone.account_id) if zone else None
        merged.append(
            {
                "domain": d,
                "match_status": status,
                "zone_id": zone.zone_id if zone else None,
                "zone_status": zone.status if zone else None,
                "plan": zone.plan if zone else None,
                "cf_account_label": account.label if account else None,
                "cf_account_id": account.id if account else None,
                "cf_account_email": account.email if account else None,
                "zone_count_on_domain": len(zones),
                "server_name": servers[0].server_name if servers else None,
                "server_ip": servers[0].server_ip if servers else None,
                "server_count_on_domain": len(servers),
            }
        )

    if domain:
        q = domain.lower()
        merged = [m for m in merged if q in m["domain"].lower()]
    if domains:
        domain_set = {d.strip().lower() for d in re.split(r"[,\n]+", domains) if d.strip()}
        if domain_set:
            merged = [m for m in merged if m["domain"].lower() in domain_set]
    if account_id:
        merged = [m for m in merged if m["cf_account_id"] == account_id]
    if match_status:
        merged = [m for m in merged if m["match_status"] == match_status]
    if plan:
        merged = [m for m in merged if m["plan"] and plan.lower() in m["plan"].lower()]
    if zone_status:
        merged = [m for m in merged if m["zone_status"] and zone_status.lower() in m["zone_status"].lower()]
    if pic:
        server_pics = get_server_pics_map(db)
        account_pics = get_account_pics_map(db)

        def _matches_pic(m):
            s_pics = server_pics.get(m["server_name"], []) if m["server_name"] else []
            a_pics = account_pics.get(m["cf_account_id"], []) if m["cf_account_id"] else []
            if pic == UNASSIGNED:
                return not s_pics and not a_pics
            return pic in s_pics or pic in a_pics

        merged = [m for m in merged if _matches_pic(m)]

    sort_key = sort_field if sort_field in _SORTABLE_KEYS else "domain"
    reverse = sort_order == "descend"
    # Sort present values with the requested direction, then always append
    # rows with a missing value at the end - mixing None into the sort key
    # directly would either crash (int vs None) or flip to "first" when
    # descend just reverses the whole tuple.
    present = [m for m in merged if m[sort_key] is not None]
    missing = [m for m in merged if m[sort_key] is None]
    present.sort(key=lambda m: m[sort_key], reverse=reverse)
    merged = present + missing
    total = len(merged)
    start = (current - 1) * pageSize
    page = merged[start : start + pageSize]

    return {"data": page, "total": total, "success": True}


class CheckZonesRequest(BaseModel):
    domains: list[str]


@router.post("/check-batch")
def check_zones_batch(body: CheckZonesRequest):
    """Live per-domain Cloudflare zone + NS status check (not from local
    synced data - see cf_ops.check_zone_status for why). Used by Clone
    WordPress to gate targets that aren't on Cloudflare yet and to surface
    NS delegation status (active/pending)."""
    domains = sorted({d.strip().lower() for d in body.domains if d.strip()})
    if not domains:
        return {"data": {}, "success": True}
    return {"data": cf_ops.check_zone_status(domains), "success": True}


@router.get("/summary")
def cf_zones_summary(db: Session = Depends(get_db)):
    zone_domains = {row[0] for row in db.execute(select(CfZone.domain))}
    server_domains = {row[0] for row in db.execute(select(Domain.domain))}
    return {
        "both": len(zone_domains & server_domains),
        "cf_only": len(zone_domains - server_domains),
        "server_only": len(server_domains - zone_domains),
        "total_zones": len(zone_domains),
        "total_hosted_domains": len(server_domains),
        "success": True,
    }
