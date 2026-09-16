from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import pic_service
from app.auth import get_current_username
from app.database import get_db
from app.models import Pic

router = APIRouter(prefix="/api/pics", tags=["pics"], dependencies=[Depends(get_current_username)])


class CreatePicRequest(BaseModel):
    code: str


class SetPicsRequest(BaseModel):
    pic_codes: list[str]


class SetTeamsRequest(BaseModel):
    team_ids: list[int]


@router.get("")
def list_pics(db: Session = Depends(get_db)):
    rows = db.execute(select(Pic).order_by(Pic.code)).scalars().all()
    return {"data": [{"id": p.id, "code": p.code} for p in rows], "success": True}


@router.post("")
def create_pic(body: CreatePicRequest, db: Session = Depends(get_db)):
    code = body.code.strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="code is required")
    if db.execute(select(Pic).where(Pic.code == code)).scalars().first():
        raise HTTPException(status_code=400, detail=f"PIC '{code}' already exists")
    pic = Pic(code=code)
    db.add(pic)
    db.commit()
    db.refresh(pic)
    return {"id": pic.id, "code": pic.code}


@router.get("/summary")
def get_pic_summary(db: Session = Depends(get_db)):
    return {"data": pic_service.pic_summary(db), "success": True}


@router.get("/unassigned")
def get_unassigned(db: Session = Depends(get_db)):
    data = pic_service.unassigned(db)
    return {**data, "success": True}


@router.get("/mismatched-domains")
def get_mismatched_domains(
    db: Session = Depends(get_db),
    current: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=20000, description="Higher ceiling than the table needs, to cover full CSV exports"),
):
    rows = pic_service.mismatched_domains(db)
    total = len(rows)
    start = (current - 1) * pageSize
    return {"data": rows[start : start + pageSize], "total": total, "success": True}


@router.post("/suggest")
def suggest(db: Session = Depends(get_db)):
    return {**pic_service.suggest_pics(db), "success": True}


@router.put("/servers/{server_name}")
def set_server_pics(server_name: str, body: SetPicsRequest, db: Session = Depends(get_db)):
    try:
        codes = pic_service.set_server_pics(db, server_name, [c.strip().upper() for c in body.pic_codes])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"server_name": server_name, "pic_codes": codes, "success": True}


@router.put("/cf-accounts/{account_id}")
def set_account_pics(account_id: int, body: SetPicsRequest, db: Session = Depends(get_db)):
    try:
        codes = pic_service.set_account_pics(db, account_id, [c.strip().upper() for c in body.pic_codes])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"account_id": account_id, "pic_codes": codes, "success": True}


@router.get("/suggest-cf-account")
def suggest_cf_account(ip: str = Query(...), db: Session = Depends(get_db)):
    return {**pic_service.suggest_cf_account_for_ip(db, ip), "success": True}


@router.get("/teams")
def get_pic_teams(db: Session = Depends(get_db)):
    return {"data": pic_service.list_pic_teams(db), "success": True}


@router.put("/servers/{server_name}/teams")
def set_server_teams(server_name: str, body: SetTeamsRequest, db: Session = Depends(get_db)):
    try:
        team_ids = pic_service.set_server_teams(db, server_name, body.team_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"server_name": server_name, "team_ids": team_ids, "success": True}
