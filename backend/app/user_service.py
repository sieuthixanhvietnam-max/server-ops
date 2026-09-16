import secrets
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.config import settings
from app.models import User


def seed_admin_user(db: Session) -> None:
    """Runs on every backend startup. Unlike the insert-only seeders
    elsewhere (seed_allowed_ips etc.), this re-syncs password_hash/is_admin/
    is_active from .env every time - editing ADMIN_PASSWORD_HASH + restarting
    the backend is the break-glass recovery path if this account's password
    is ever lost again (display_name is left alone once set, since .env has
    no opinion about it)."""
    user = db.execute(select(User).where(User.username == settings.admin_username)).scalar_one_or_none()
    if user is None:
        db.add(
            User(
                username=settings.admin_username,
                password_hash=settings.admin_password_hash,
                display_name=settings.admin_username,
                is_admin=True,
                is_active=True,
                created_at=datetime.now(timezone.utc),
            )
        )
    else:
        user.password_hash = settings.admin_password_hash
        user.is_admin = True
        user.is_active = True
    db.commit()


def generate_password() -> str:
    return secrets.token_urlsafe(12)


def create_user(db: Session, username: str, display_name: str, is_admin: bool, password: str) -> User:
    user = User(
        username=username,
        password_hash=hash_password(password),
        display_name=display_name,
        is_admin=is_admin,
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
