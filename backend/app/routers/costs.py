from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import ProviderCost, User

# The org's own billing-account groupings - not a dimension any provider's
# API knows about on its own (e.g. "Alibaba" alone covers 2 separate real
# accounts here), so costs are entered by hand against this fixed list
# rather than pulled automatically. Financial data, hence require_admin on
# the whole router for both reading and writing (confirmed with the user -
# stricter than the other reports, which any logged-in user can view).
ACCOUNT_LABELS = [
    "Alibaba - Partner",
    "Google Cloud - Partner",
    "Alibaba - Sieuthixanh",
    "DO - Sieuthixanh",
    "GG Cloud - Sieuthixanh",
    "Cloudflare",
]

router = APIRouter(prefix="/api/costs", tags=["costs"], dependencies=[Depends(require_admin)])


class UpsertCostBody(BaseModel):
    amount_vnd: int
    note: str = ""


@router.get("/accounts")
def list_accounts():
    return {"data": ACCOUNT_LABELS}


@router.get("")
def list_costs(
    month_from: str | None = Query(None, description="YYYY-MM"),
    month_to: str | None = Query(None, description="YYYY-MM"),
    db: Session = Depends(get_db),
):
    stmt = select(ProviderCost)
    if month_from:
        stmt = stmt.where(ProviderCost.month >= month_from)
    if month_to:
        stmt = stmt.where(ProviderCost.month <= month_to)
    rows = db.execute(stmt.order_by(ProviderCost.month)).scalars().all()
    return {
        "data": [
            {
                "account_label": r.account_label,
                "month": r.month,
                "amount_vnd": r.amount_vnd,
                "note": r.note,
                "updated_at": r.updated_at.isoformat(),
                "created_by": r.created_by,
            }
            for r in rows
        ]
    }


@router.put("/{account_label}/{month}")
def upsert_cost(
    account_label: str,
    month: str,
    body: UpsertCostBody,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if account_label not in ACCOUNT_LABELS:
        raise HTTPException(status_code=400, detail="account_label không hợp lệ")
    row = db.execute(
        select(ProviderCost).where(ProviderCost.account_label == account_label, ProviderCost.month == month)
    ).scalar_one_or_none()
    if row:
        row.amount_vnd = body.amount_vnd
        row.note = body.note
        row.updated_at = datetime.utcnow()
        row.created_by = admin.username
    else:
        db.add(
            ProviderCost(
                account_label=account_label,
                month=month,
                amount_vnd=body.amount_vnd,
                note=body.note,
                created_by=admin.username,
                updated_at=datetime.utcnow(),
            )
        )
    db.commit()
    return {"success": True}


@router.delete("/{account_label}/{month}")
def delete_cost(account_label: str, month: str, db: Session = Depends(get_db)):
    db.execute(
        delete(ProviderCost).where(ProviderCost.account_label == account_label, ProviderCost.month == month)
    )
    db.commit()
    return {"success": True}
