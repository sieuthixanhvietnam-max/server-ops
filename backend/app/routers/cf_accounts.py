from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_current_username
from app.config import settings
from app.crypto import decrypt_token, encrypt_token
from app.database import get_db
from app.models import CfAccount, CfZone
from app.ops import cf_ops
from app.pic_service import account_ids_for_pic, get_account_pics_map
from app.query_utils import apply_sort
from app.schemas import CfAccountOut

router = APIRouter(
    prefix="/api/cf-accounts", tags=["cf-accounts"], dependencies=[Depends(get_current_username)]
)

_SORTABLE = {
    "label": CfAccount.label,
    "email": CfAccount.email,
    "cf_account_id": CfAccount.cf_account_id,
    "source": CfAccount.source,
    "zone_count": CfAccount.zone_count,
    "last_sync_status": CfAccount.last_sync_status,
    "last_synced_at": CfAccount.last_synced_at,
}


class CreateCfAccountRequest(BaseModel):
    label: str | None = None
    email: str
    api_token: str
    cf_account_id: str | None = None


class BulkImportRow(BaseModel):
    label: str | None = None
    email: str
    api_token: str
    cf_account_id: str | None = None


class BulkImportRequest(BaseModel):
    accounts: list[BulkImportRow]


@router.get("")
def list_cf_accounts(
    db: Session = Depends(get_db),
    current: int = Query(1, ge=1),
    pageSize: int = Query(50, ge=1, le=20000, description="Higher ceiling than the table needs, to cover full CSV exports"),
    email: str | None = Query(None),
    label: str | None = Query(None),
    source: str | None = Query(None, description="'manual' or 'master'"),
    last_sync_status: str | None = Query(None, description="'never', 'ok' or 'error'"),
    is_active: bool | None = Query(None),
    pic: str | None = Query(None, description="PIC code, or '__unassigned__' for no PIC"),
    sort_field: str | None = Query(None),
    sort_order: str | None = Query(None, description="'ascend' or 'descend'"),
):
    stmt = select(CfAccount)
    if email:
        stmt = stmt.where(CfAccount.email.ilike(f"%{email}%"))
    if label:
        stmt = stmt.where(CfAccount.label.ilike(f"%{label}%"))
    if source:
        stmt = stmt.where(CfAccount.source == source)
    if last_sync_status:
        stmt = stmt.where(CfAccount.last_sync_status == last_sync_status)
    if is_active is not None:
        stmt = stmt.where(CfAccount.is_active.is_(is_active))
    if pic:
        stmt = stmt.where(CfAccount.id.in_(account_ids_for_pic(db, pic)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    stmt = apply_sort(stmt, _SORTABLE, sort_field, sort_order, default=CfAccount.label)
    rows = (
        db.execute(stmt.offset((current - 1) * pageSize).limit(pageSize))
        .scalars()
        .all()
    )
    account_pics = get_account_pics_map(db)
    data = []
    for r in rows:
        item = CfAccountOut.model_validate(r).model_dump()
        item["pics"] = account_pics.get(r.id, [])
        data.append(item)
    return {"data": data, "total": total, "success": True}


@router.get("/options")
def list_cf_account_options(db: Session = Depends(get_db)):
    """Lightweight {id, label, zone_count, pics} list for target dropdowns -
    avoids paging through the full CfAccount payload just to populate a
    select. Active accounts only (a revoked/disabled token can't create
    zones) - CF Add's account picker uses this as the always-browsable full
    list, not just PIC-matched suggestions, so it can't offer a dead
    account. Sorted by zone_count so manual browsing naturally favors the
    least-loaded accounts, same as the auto-suggestion does."""
    rows = (
        db.execute(
            select(CfAccount.id, CfAccount.label, CfAccount.zone_count)
            .where(CfAccount.is_active.is_(True))
            .order_by(CfAccount.zone_count, CfAccount.label)
        )
        .all()
    )
    account_pics = get_account_pics_map(db)
    return {
        "data": [
            {"id": r.id, "label": r.label, "zone_count": r.zone_count, "pics": account_pics.get(r.id, [])}
            for r in rows
        ],
        "success": True,
    }


@router.post("")
def create_cf_account(body: CreateCfAccountRequest, db: Session = Depends(get_db)):
    if not body.api_token.strip():
        raise HTTPException(status_code=400, detail="api_token is required")
    account = CfAccount(
        label=(body.label or "").strip() or body.email.strip(),
        email=body.email.strip(),
        cf_account_id=(body.cf_account_id or "").strip() or None,
        api_token_encrypted=encrypt_token(body.api_token.strip()),
        is_active=True,
        created_at=datetime.now(timezone.utc),
        last_sync_status="never",
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return CfAccountOut.model_validate(account).model_dump()


@router.post("/bulk-import")
def bulk_import_cf_accounts(body: BulkImportRequest, db: Session = Depends(get_db)):
    if not body.accounts:
        raise HTTPException(status_code=400, detail="accounts list is empty")

    created, errors = 0, []
    now = datetime.now(timezone.utc)
    for i, row in enumerate(body.accounts):
        if not row.email.strip() or not row.api_token.strip():
            errors.append(f"dòng {i + 1}: thiếu email hoặc api_token")
            continue
        db.add(
            CfAccount(
                label=(row.label or "").strip() or row.email.strip(),
                email=row.email.strip(),
                cf_account_id=(row.cf_account_id or "").strip() or None,
                api_token_encrypted=encrypt_token(row.api_token.strip()),
                is_active=True,
                created_at=now,
                last_sync_status="never",
            )
        )
        created += 1
    db.commit()
    return {"created": created, "errors": errors, "success": True}


@router.post("/{account_id}/test")
def test_cf_account(account_id: int, db: Session = Depends(get_db)):
    account = db.get(CfAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="account not found")
    if account.source == "master":
        token = settings.cf_api_token
    else:
        try:
            token = decrypt_token(account.api_token_encrypted)
        except ValueError as exc:
            return {"valid": False, "note": str(exc)}
    valid, note = cf_ops.verify_cf_token(token)
    return {"valid": valid, "note": note}


@router.delete("/{account_id}")
def delete_cf_account(account_id: int, db: Session = Depends(get_db)):
    account = db.get(CfAccount, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="account not found")
    db.query(CfZone).filter(CfZone.account_id == account_id).delete()
    db.delete(account)
    db.commit()
    return {"success": True}
