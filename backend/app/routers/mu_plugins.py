import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_username
from app.config import settings
from app.database import get_db
from app.models import MuPlugin
from app.schemas import MuPluginOut

router = APIRouter(prefix="/api/mu-plugins", tags=["mu-plugins"], dependencies=[Depends(get_current_username)])

# mu-plugins are single small snippet files (disable auto-update, force SSL,
# etc.) - nowhere near the size of a plugin/theme zip, so a much smaller cap
# is both plenty and a cheap guard against uploading the wrong file type.
MAX_FILE_SIZE = 2 * 1024 * 1024

os.makedirs(settings.mu_plugin_dir, exist_ok=True)


@router.get("")
def list_mu_plugins(db: Session = Depends(get_db)):
    rows = db.execute(select(MuPlugin).order_by(MuPlugin.created_at.desc())).scalars().all()
    return {"data": [MuPluginOut.model_validate(r).model_dump() for r in rows], "success": True}


@router.post("")
async def upload_mu_plugin(
    label: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    if not (file.filename or "").lower().endswith(".php"):
        raise HTTPException(status_code=400, detail="File phải là .php")
    if not label.strip():
        raise HTTPException(status_code=400, detail="Nhập nhãn cho mu-plugin")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File quá lớn (tối đa 2MB)")

    # Cú pháp thật được lint bằng đúng PHP version của TỪNG domain đích lúc
    # deploy (wp_mu_plugin_ops.INSTALL_MU_PLUGIN_SCRIPT) - domain khác nhau
    # có thể ghim PHP khác nhau, nên lint 1 lần lúc upload không đủ tin cậy.

    stored_name = f"{uuid.uuid4().hex}_{os.path.basename(file.filename)}"
    with open(os.path.join(settings.mu_plugin_dir, stored_name), "wb") as f:
        f.write(content)

    row = MuPlugin(
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
    return MuPluginOut.model_validate(row).model_dump()


@router.delete("/{mu_plugin_id}")
def delete_mu_plugin(mu_plugin_id: int, db: Session = Depends(get_db)):
    row = db.get(MuPlugin, mu_plugin_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    path = os.path.join(settings.mu_plugin_dir, row.stored_name)
    if os.path.isfile(path):
        os.remove(path)
    db.delete(row)
    db.commit()
    return {"success": True}
