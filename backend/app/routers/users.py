from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import hash_password, require_admin
from app.config import settings
from app.database import get_db
from app.models import User
from app.schemas import UserOut
from app.user_service import create_user, generate_password

router = APIRouter(prefix="/api/users", tags=["users"], dependencies=[Depends(require_admin)])


class CreateUserRequest(BaseModel):
    username: str
    display_name: str = ""
    is_admin: bool = False
    password: str | None = None  # None = auto-generate


class UpdateUserRequest(BaseModel):
    # username is intentionally not editable - Job.created_by/PluginZip.
    # uploaded_by store it as a plain string snapshot, not a foreign key, so
    # renaming an account would silently orphan its past audit history.
    display_name: str


class ResetPasswordRequest(BaseModel):
    password: str | None = None  # None = auto-generate


class SetActiveRequest(BaseModel):
    is_active: bool


def _username_taken(db: Session, username: str) -> bool:
    return db.execute(select(User).where(User.username == username)).scalar_one_or_none() is not None


def _require_not_last_active_admin(db: Session, user: User) -> None:
    if not user.is_admin:
        return
    active_admins = db.execute(
        select(User).where(User.is_admin.is_(True), User.is_active.is_(True))
    ).scalars().all()
    if len(active_admins) <= 1:
        raise HTTPException(status_code=400, detail="Không thể khoá/xoá admin cuối cùng còn hoạt động")


@router.get("")
def list_users(db: Session = Depends(get_db)):
    rows = db.execute(select(User).order_by(User.created_at)).scalars().all()
    return {"data": [UserOut.model_validate(r).model_dump() for r in rows], "success": True}


@router.post("")
def create_user_endpoint(body: CreateUserRequest, db: Session = Depends(get_db)):
    username = body.username.strip().lower()
    if not username:
        raise HTTPException(status_code=400, detail="Nhập tên đăng nhập")
    if _username_taken(db, username):
        raise HTTPException(status_code=400, detail=f"Tên đăng nhập '{username}' đã tồn tại")

    password = (body.password or "").strip() or generate_password()
    user = create_user(db, username, body.display_name.strip(), body.is_admin, password)
    return {"user": UserOut.model_validate(user).model_dump(), "password": password}


@router.patch("/{user_id}")
def update_user(user_id: int, body: UpdateUserRequest, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy user")
    user.display_name = body.display_name.strip()
    db.commit()
    return {"data": UserOut.model_validate(user).model_dump(), "success": True}


@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy user")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Không thể tự xoá tài khoản của chính mình")
    if user.username == settings.admin_username:
        raise HTTPException(
            status_code=400,
            detail="Tài khoản này được tự động tạo lại từ .env mỗi lần khởi động backend - không thể xoá",
        )
    _require_not_last_active_admin(db, user)

    db.delete(user)
    db.commit()
    return {"success": True}


@router.post("/{user_id}/reset-password")
def reset_password(user_id: int, body: ResetPasswordRequest, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy user")

    password = (body.password or "").strip() or generate_password()
    user.password_hash = hash_password(password)
    db.commit()
    return {"password": password}


@router.post("/{user_id}/active")
def set_active(user_id: int, body: SetActiveRequest, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy user")
    if user.id == admin.id and not body.is_active:
        raise HTTPException(status_code=400, detail="Không thể tự khoá tài khoản của chính mình")
    if not body.is_active:
        _require_not_last_active_admin(db, user)

    user.is_active = body.is_active
    db.commit()
    return {"data": UserOut.model_validate(user).model_dump(), "success": True}
