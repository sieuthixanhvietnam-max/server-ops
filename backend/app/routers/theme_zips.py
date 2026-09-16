import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_username
from app.config import settings
from app.database import get_db
from app.models import ThemeZip
from app.schemas import ThemeZipOut

router = APIRouter(prefix="/api/theme-zips", tags=["theme-zips"], dependencies=[Depends(get_current_username)])

MAX_ZIP_SIZE = 50 * 1024 * 1024

os.makedirs(settings.theme_zip_dir, exist_ok=True)


@router.get("")
def list_theme_zips(db: Session = Depends(get_db)):
    rows = db.execute(select(ThemeZip).order_by(ThemeZip.created_at.desc())).scalars().all()
    return {"data": [ThemeZipOut.model_validate(r).model_dump() for r in rows], "success": True}


@router.post("")
async def upload_theme_zip(
    label: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="File phải là .zip")
    if not label.strip():
        raise HTTPException(status_code=400, detail="Nhập nhãn cho theme")

    content = await file.read()
    if len(content) > MAX_ZIP_SIZE:
        raise HTTPException(status_code=400, detail="File quá lớn (tối đa 50MB)")

    stored_name = f"{uuid.uuid4().hex}_{os.path.basename(file.filename)}"
    with open(os.path.join(settings.theme_zip_dir, stored_name), "wb") as f:
        f.write(content)

    row = ThemeZip(
        label=label.strip(),
        filename=file.filename,
        stored_name=stored_name,
        size_bytes=len(content),
        uploaded_by=username,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ThemeZipOut.model_validate(row).model_dump()


@router.delete("/{zip_id}")
def delete_theme_zip(zip_id: int, db: Session = Depends(get_db)):
    row = db.get(ThemeZip, zip_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    path = os.path.join(settings.theme_zip_dir, row.stored_name)
    if os.path.isfile(path):
        os.remove(path)
    db.delete(row)
    db.commit()
    return {"success": True}
