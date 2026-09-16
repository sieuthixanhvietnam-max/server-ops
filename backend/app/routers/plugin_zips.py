import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_username
from app.config import settings
from app.database import get_db
from app.models import PluginZip
from app.schemas import PluginZipOut

router = APIRouter(prefix="/api/plugin-zips", tags=["plugin-zips"], dependencies=[Depends(get_current_username)])

MAX_ZIP_SIZE = 50 * 1024 * 1024

os.makedirs(settings.plugin_zip_dir, exist_ok=True)


@router.get("")
def list_plugin_zips(db: Session = Depends(get_db)):
    rows = db.execute(select(PluginZip).order_by(PluginZip.created_at.desc())).scalars().all()
    return {"data": [PluginZipOut.model_validate(r).model_dump() for r in rows], "success": True}


@router.post("")
async def upload_plugin_zip(
    label: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="File phải là .zip")
    if not label.strip():
        raise HTTPException(status_code=400, detail="Nhập nhãn cho plugin")

    content = await file.read()
    if len(content) > MAX_ZIP_SIZE:
        raise HTTPException(status_code=400, detail="File quá lớn (tối đa 50MB)")

    stored_name = f"{uuid.uuid4().hex}_{os.path.basename(file.filename)}"
    with open(os.path.join(settings.plugin_zip_dir, stored_name), "wb") as f:
        f.write(content)

    row = PluginZip(
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
    return PluginZipOut.model_validate(row).model_dump()


@router.delete("/{zip_id}")
def delete_plugin_zip(zip_id: int, db: Session = Depends(get_db)):
    row = db.get(PluginZip, zip_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    path = os.path.join(settings.plugin_zip_dir, row.stored_name)
    if os.path.isfile(path):
        os.remove(path)
    db.delete(row)
    db.commit()
    return {"success": True}
