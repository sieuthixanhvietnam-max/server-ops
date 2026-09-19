import re

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_current_username
from app.database import get_db
from app.models import Domain
from app.pic_service import server_names_for_pic
from app.query_utils import apply_sort
from app.schemas import DomainOut

_SORTABLE = {
    "domain": Domain.domain,
    "provider": Domain.provider,
    "profile": Domain.profile,
    "server_name": Domain.server_name,
    "server_ip": Domain.server_ip,
    "source_updated": Domain.source_updated,
}

router = APIRouter(
    prefix="/api/domains", tags=["domains"], dependencies=[Depends(get_current_username)]
)


@router.get("")
def list_domains(
    db: Session = Depends(get_db),
    current: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=20000, description="Higher ceiling than the table needs, to cover full CSV exports"),
    domain: str | None = Query(None, description="Filter by domain substring"),
    domains: str | None = Query(
        None, description="Exact-match batch filter: domains separated by newline or comma"
    ),
    provider: str | None = Query(None, description="Filter by provider, e.g. GCP or Ali"),
    server_name: str | None = Query(None, description="Filter by server name"),
    profile: str | None = Query(None),
    pic: str | None = Query(None, description="PIC code, or '__unassigned__' for no PIC"),
    duplicates_only: bool = Query(
        False, description="Only domains that appear on more than one distinct server_name"
    ),
    sort_field: str | None = Query(None),
    sort_order: str | None = Query(None, description="'ascend' or 'descend'"),
):
    stmt = select(Domain)
    if domain:
        stmt = stmt.where(Domain.domain.ilike(f"%{domain}%"))
    if domains:
        domain_list = {d.strip().lower() for d in re.split(r"[,\n]+", domains) if d.strip()}
        if domain_list:
            stmt = stmt.where(Domain.domain.in_(domain_list))
    if provider:
        stmt = stmt.where(Domain.provider == provider)
    if server_name:
        stmt = stmt.where(Domain.server_name == server_name)
    if profile:
        stmt = stmt.where(Domain.profile == profile)
    if pic:
        stmt = stmt.where(Domain.server_name.in_(server_names_for_pic(db, pic)))
    if duplicates_only:
        dup_domains = (
            select(Domain.domain)
            .group_by(Domain.domain)
            .having(func.count(func.distinct(Domain.server_name)) > 1)
        )
        stmt = stmt.where(Domain.domain.in_(dup_domains))

    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    stmt = apply_sort(stmt, _SORTABLE, sort_field, sort_order, default=Domain.domain)

    rows = (
        db.execute(stmt.offset((current - 1) * pageSize).limit(pageSize))
        .scalars()
        .all()
    )

    return {
        "data": [DomainOut.model_validate(row).model_dump() for row in rows],
        "total": total,
        "success": True,
    }


@router.get("/providers")
def list_providers(db: Session = Depends(get_db)):
    rows = db.execute(select(Domain.provider).distinct()).scalars().all()
    return {"data": sorted(rows), "success": True}


@router.get("/profiles")
def list_profiles(db: Session = Depends(get_db)):
    rows = db.execute(select(Domain.profile).distinct()).scalars().all()
    return {"data": sorted(rows), "success": True}


class ExistsBatchRequest(BaseModel):
    domains: list[str]


@router.post("/exists-batch")
def domains_exists_batch(body: ExistsBatchRequest, db: Session = Depends(get_db)):
    """Cheap local-DB check of which domains already host a site in our
    synced inventory. Used by Clone WordPress to flag targets that would be
    overwritten (the clone script deletes an existing site before cloning
    over it) so that's never a surprise."""
    domains = sorted({d.strip().lower() for d in body.domains if d.strip()})
    if not domains:
        return {"data": {}, "success": True}
    existing = {r[0] for r in db.execute(select(Domain.domain).where(Domain.domain.in_(domains)))}
    return {"data": {d: (d in existing) for d in domains}, "success": True}
