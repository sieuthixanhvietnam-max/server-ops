from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_username
from app.crypto import decrypt_token, encrypt_token
from app.database import get_db
from app.models import SiteCredential
from app.schemas import SiteCredentialOut

router = APIRouter(
    prefix="/api/site-credentials", tags=["site-credentials"], dependencies=[Depends(get_current_username)]
)


@router.get("")
def list_site_credentials(db: Session = Depends(get_db)):
    rows = db.execute(select(SiteCredential)).scalars().all()
    return {"data": [SiteCredentialOut.model_validate(r).model_dump() for r in rows], "success": True}


class SetSiteCredentialRequest(BaseModel):
    domain: str
    server_name: str
    username: str
    password: str


@router.put("")
def set_site_credential(
    body: SetSiteCredentialRequest, db: Session = Depends(get_db), username: str = Depends(get_current_username)
):
    domain = body.domain.strip().lower()
    server_name = body.server_name.strip()
    admin_user = body.username.strip()
    password = body.password
    if not domain or not server_name or not admin_user or not password:
        raise HTTPException(status_code=400, detail="Thiếu domain/server/username/mật khẩu")

    row = db.execute(
        select(SiteCredential).where(SiteCredential.domain == domain, SiteCredential.server_name == server_name)
    ).scalar_one_or_none()
    if row is None:
        row = SiteCredential(domain=domain, server_name=server_name)
        db.add(row)
    row.username = admin_user
    row.password_encrypted = encrypt_token(password)
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by = username
    db.commit()
    db.refresh(row)
    return {"data": SiteCredentialOut.model_validate(row).model_dump(), "success": True}


@router.get("/{credential_id}/reveal")
def reveal_site_credential(credential_id: int, db: Session = Depends(get_db)):
    row = db.get(SiteCredential, credential_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy credential")
    try:
        password = decrypt_token(row.password_encrypted)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"password": password, "success": True}


@router.delete("/{credential_id}")
def delete_site_credential(credential_id: int, db: Session = Depends(get_db)):
    row = db.get(SiteCredential, credential_id)
    if row is not None:
        db.delete(row)
        db.commit()
    return {"success": True}
