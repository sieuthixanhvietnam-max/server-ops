import re

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import get_current_username
from app.database import get_db
from app.models import Server
from app.ops import ssh_ops
from app.pic_service import get_server_pics_map, get_server_teams_map, server_names_for_pic
from app.query_utils import apply_sort
from app.schemas import ServerOut

router = APIRouter(
    prefix="/api/servers", tags=["servers"], dependencies=[Depends(get_current_username)]
)

_SORTABLE = {
    "server_name": Server.server_name,
    "ip": Server.ip,
    "provider": Server.provider,
    "profile": Server.profile,
    "domains_count": Server.domains_count,
    "source_updated": Server.source_updated,
}


@router.get("")
def list_servers(
    db: Session = Depends(get_db),
    current: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=20000, description="Higher ceiling than the table needs, to cover full CSV exports"),
    server_name: str | None = Query(None, description="Filter by server name substring"),
    server_names: str | None = Query(
        None, description="Exact-match batch filter: server names separated by newline or comma"
    ),
    provider: str | None = Query(None, description="Filter by provider, e.g. GCP or Ali"),
    profile: str | None = Query(None),
    pic: str | None = Query(None, description="PIC code, or '__unassigned__' for no PIC"),
    sort_field: str | None = Query(None),
    sort_order: str | None = Query(None, description="'ascend' or 'descend'"),
):
    stmt = select(Server)
    if server_name:
        stmt = stmt.where(Server.server_name.ilike(f"%{server_name}%"))
    if server_names:
        name_list = {n.strip() for n in re.split(r"[,\n]+", server_names) if n.strip()}
        if name_list:
            stmt = stmt.where(Server.server_name.in_(name_list))
    if provider:
        stmt = stmt.where(Server.provider == provider)
    if profile:
        stmt = stmt.where(Server.profile == profile)
    if pic:
        stmt = stmt.where(Server.server_name.in_(server_names_for_pic(db, pic)))

    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    stmt = apply_sort(stmt, _SORTABLE, sort_field, sort_order, default=Server.server_name)

    rows = (
        db.execute(stmt.offset((current - 1) * pageSize).limit(pageSize))
        .scalars()
        .all()
    )

    server_pics = get_server_pics_map(db)
    server_teams = get_server_teams_map(db)
    data = []
    for row in rows:
        item = ServerOut.model_validate(row).model_dump()
        item["pics"] = server_pics.get(row.server_name, [])
        item["teams"] = server_teams.get(row.server_name, [])
        item["ssh_user"] = ssh_ops.resolve_ssh_user(row.profile)
        item["ssh_key_path"] = ssh_ops.resolve_ssh_key_path(row.profile)
        data.append(item)

    return {
        "data": data,
        "total": total,
        "success": True,
    }


@router.get("/profiles")
def list_server_profiles(db: Session = Depends(get_db)):
    rows = db.execute(select(Server.profile).distinct()).scalars().all()
    return {"data": sorted(rows), "success": True}
