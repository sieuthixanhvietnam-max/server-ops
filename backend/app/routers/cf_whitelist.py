from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_current_username
from app.database import get_db
from app.models import CfWhitelistIp
from app.ops.validation import is_valid_ip
from app.schemas import CfWhitelistIpOut

router = APIRouter(
    prefix="/api/cf-whitelist-ips", tags=["cf-whitelist"], dependencies=[Depends(get_current_username)]
)


class CreateCfWhitelistIpRequest(BaseModel):
    label: str = ""
    ip: str
    note: str = ""


class UpdateCfWhitelistIpRequest(BaseModel):
    label: str | None = None
    ip: str | None = None
    note: str | None = None
    is_active: bool | None = None


@router.get("")
def list_cf_whitelist_ips(
    db: Session = Depends(get_db),
    current: int = Query(1, ge=1),
    pageSize: int = Query(50, ge=1, le=20000, description="Higher ceiling than the table needs, to cover full CSV exports"),
    label: str | None = Query(None),
    is_active: bool | None = Query(None),
):
    stmt = select(CfWhitelistIp)
    if label:
        stmt = stmt.where(CfWhitelistIp.label.ilike(f"%{label}%"))
    if is_active is not None:
        stmt = stmt.where(CfWhitelistIp.is_active.is_(is_active))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = (
        db.execute(stmt.order_by(CfWhitelistIp.ip).offset((current - 1) * pageSize).limit(pageSize))
        .scalars()
        .all()
    )
    return {
        "data": [CfWhitelistIpOut.model_validate(r).model_dump() for r in rows],
        "total": total,
        "success": True,
    }


@router.post("")
def create_cf_whitelist_ip(body: CreateCfWhitelistIpRequest, db: Session = Depends(get_db)):
    ip = body.ip.strip()
    if not is_valid_ip(ip):
        raise HTTPException(status_code=400, detail=f"'{ip}' is not a valid IPv4 address")
    if db.execute(select(CfWhitelistIp).where(CfWhitelistIp.ip == ip)).scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"'{ip}' already exists")
    row = CfWhitelistIp(
        label=body.label.strip(),
        ip=ip,
        note=body.note.strip(),
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return CfWhitelistIpOut.model_validate(row).model_dump()


@router.put("/{row_id}")
def update_cf_whitelist_ip(row_id: int, body: UpdateCfWhitelistIpRequest, db: Session = Depends(get_db)):
    row = db.get(CfWhitelistIp, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    if body.ip is not None:
        ip = body.ip.strip()
        if not is_valid_ip(ip):
            raise HTTPException(status_code=400, detail=f"'{ip}' is not a valid IPv4 address")
        dup = db.execute(
            select(CfWhitelistIp).where(CfWhitelistIp.ip == ip, CfWhitelistIp.id != row_id)
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=400, detail=f"'{ip}' already exists")
        row.ip = ip
    if body.label is not None:
        row.label = body.label.strip()
    if body.note is not None:
        row.note = body.note.strip()
    if body.is_active is not None:
        row.is_active = body.is_active
    db.commit()
    db.refresh(row)
    return CfWhitelistIpOut.model_validate(row).model_dump()


@router.delete("/{row_id}")
def delete_cf_whitelist_ip(row_id: int, db: Session = Depends(get_db)):
    row = db.get(CfWhitelistIp, row_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    db.delete(row)
    db.commit()
    return {"success": True}
