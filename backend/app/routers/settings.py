from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.crypto import encrypt_token
from app.database import get_db
from app.models import IndexerCredential, User
from app.schemas import INDEXER_SERVICES, IndexerCredentialOut

router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(require_admin)])


class SetIndexerCredentialRequest(BaseModel):
    api_key: str


@router.get("/indexer-credentials")
def list_indexer_credentials(db: Session = Depends(get_db)):
    rows = {r.service: r for r in db.execute(select(IndexerCredential)).scalars()}
    data = [
        IndexerCredentialOut(
            service=s,
            configured=s in rows,
            updated_at=rows[s].updated_at if s in rows else None,
            updated_by=rows[s].updated_by if s in rows else "",
        ).model_dump()
        for s in INDEXER_SERVICES
    ]
    return {"data": data, "success": True}


@router.put("/indexer-credentials/{service}")
def set_indexer_credential(
    service: str,
    body: SetIndexerCredentialRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    if service not in INDEXER_SERVICES:
        raise HTTPException(status_code=404, detail="Dịch vụ không hợp lệ")
    api_key = body.api_key.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="Nhập API key")

    row = db.execute(
        select(IndexerCredential).where(IndexerCredential.service == service)
    ).scalar_one_or_none()
    if row is None:
        row = IndexerCredential(service=service)
        db.add(row)
    row.api_key_encrypted = encrypt_token(api_key)
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by = admin.username
    db.commit()
    db.refresh(row)

    return {
        "data": IndexerCredentialOut(
            service=service, configured=True, updated_at=row.updated_at, updated_by=row.updated_by
        ).model_dump(),
        "success": True,
    }


@router.delete("/indexer-credentials/{service}")
def delete_indexer_credential(service: str, db: Session = Depends(get_db)):
    row = db.execute(
        select(IndexerCredential).where(IndexerCredential.service == service)
    ).scalar_one_or_none()
    if row is not None:
        db.delete(row)
        db.commit()
    return {"success": True}
