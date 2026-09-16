from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_username
from app.database import get_db
from app.models import ChangelogEntry
from app.schemas import ChangelogEntryOut

router = APIRouter(prefix="/api/changelog", tags=["changelog"], dependencies=[Depends(get_current_username)])

_CHANGE_TYPES = {"feature", "fix", "improvement", "security"}


@router.get("")
def list_changelog(db: Session = Depends(get_db)):
    rows = db.execute(select(ChangelogEntry).order_by(ChangelogEntry.created_at.desc())).scalars().all()
    return {"data": [ChangelogEntryOut.model_validate(r).model_dump() for r in rows], "success": True}


class CreateChangelogRequest(BaseModel):
    version: str = ""
    change_type: str = "fix"
    title: str
    description: str = ""


@router.post("")
def create_changelog_entry(
    body: CreateChangelogRequest, db: Session = Depends(get_db), username: str = Depends(get_current_username)
):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Thiếu tiêu đề")
    change_type = body.change_type.strip() or "fix"
    if change_type not in _CHANGE_TYPES:
        raise HTTPException(status_code=400, detail=f"change_type phải là 1 trong {sorted(_CHANGE_TYPES)}")
    row = ChangelogEntry(
        version=body.version.strip(),
        change_type=change_type,
        title=title,
        description=body.description.strip(),
        created_at=datetime.now(timezone.utc),
        created_by=username,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"data": ChangelogEntryOut.model_validate(row).model_dump(), "success": True}


# No DELETE endpoint on purpose - changelog is an append-only audit trail,
# not editable history. A wrong entry gets corrected with a follow-up entry,
# not erased.
