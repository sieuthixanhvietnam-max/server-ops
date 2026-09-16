from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.access_control_service import get_client_ip, is_ip_allowed
from app.auth import get_current_username
from app.config import settings
from app.database import get_db
from app.models import AllowedIp
from app.ops.validation import is_valid_ip
from app.schemas import AllowedIpOut

router = APIRouter(
    prefix="/api/allowed-ips", tags=["access-control"], dependencies=[Depends(get_current_username)]
)


class CreateAllowedIpRequest(BaseModel):
    label: str
    ip: str
    note: str = ""


class UpdateAllowedIpRequest(BaseModel):
    label: str | None = None
    ip: str | None = None
    note: str | None = None
    is_active: bool | None = None


@router.get("/whoami")
def whoami(request: Request, db: Session = Depends(get_db)):
    """Resolves the caller's own IP the same way the enforcement middleware
    would - so the Access Control page can show 'your IP is/isn't in the
    list yet' before you flip IP_ALLOWLIST_ENFORCED on, instead of finding
    out by locking yourself out."""
    ip = get_client_ip(request)
    return {"ip": ip, "allowed": is_ip_allowed(db, ip), "enforced": settings.ip_allowlist_enforced}


@router.get("")
def list_allowed_ips(
    db: Session = Depends(get_db),
    current: int = Query(1, ge=1),
    pageSize: int = Query(50, ge=1, le=500),
    label: str | None = Query(None),
    is_active: bool | None = Query(None),
):
    stmt = select(AllowedIp)
    if label:
        stmt = stmt.where(AllowedIp.label.ilike(f"%{label}%"))
    if is_active is not None:
        stmt = stmt.where(AllowedIp.is_active.is_(is_active))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = (
        db.execute(stmt.order_by(AllowedIp.label).offset((current - 1) * pageSize).limit(pageSize))
        .scalars()
        .all()
    )
    return {
        "data": [AllowedIpOut.model_validate(r).model_dump() for r in rows],
        "total": total,
        "success": True,
        "enforced": settings.ip_allowlist_enforced,
    }


@router.post("")
def create_allowed_ip(body: CreateAllowedIpRequest, db: Session = Depends(get_db)):
    ip = body.ip.strip()
    if not is_valid_ip(ip):
        raise HTTPException(status_code=400, detail=f"'{ip}' is not a valid IPv4 address")
    if not body.label.strip():
        raise HTTPException(status_code=400, detail="label is required")
    if db.execute(select(AllowedIp).where(AllowedIp.ip == ip)).scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"'{ip}' already exists")
    row = AllowedIp(
        label=body.label.strip(),
        ip=ip,
        note=body.note.strip(),
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return AllowedIpOut.model_validate(row).model_dump()


@router.put("/{row_id}")
def update_allowed_ip(row_id: int, body: UpdateAllowedIpRequest, db: Session = Depends(get_db)):
    row = db.get(AllowedIp, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    if body.ip is not None:
        ip = body.ip.strip()
        if not is_valid_ip(ip):
            raise HTTPException(status_code=400, detail=f"'{ip}' is not a valid IPv4 address")
        dup = db.execute(
            select(AllowedIp).where(AllowedIp.ip == ip, AllowedIp.id != row_id)
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=400, detail=f"'{ip}' already exists")
        row.ip = ip
    if body.label is not None:
        if not body.label.strip():
            raise HTTPException(status_code=400, detail="label is required")
        row.label = body.label.strip()
    if body.note is not None:
        row.note = body.note.strip()
    if body.is_active is not None:
        row.is_active = body.is_active
    db.commit()
    db.refresh(row)
    return AllowedIpOut.model_validate(row).model_dump()


@router.delete("/{row_id}")
def delete_allowed_ip(row_id: int, db: Session = Depends(get_db)):
    row = db.get(AllowedIp, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    db.delete(row)
    db.commit()
    return {"success": True}
