import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_username, require_admin
from app.cf_firewall_template_service import DEFAULT_TEMPLATE_NAME
from app.database import get_db
from app.models import CfFirewallTemplate
from app.schemas import CfFirewallTemplateOut

# Reading the list (any logged-in user - the Firewall page needs it to
# offer a template picker) vs editing it (admin only, per the user's
# explicit call: whoever runs the Firewall page rarely re-checks rule
# content before confirming, so defining/changing what a template actually
# blocks needs a stricter gate than just being logged in) require different
# auth, so require_admin is applied per-endpoint below rather than once on
# the whole router.
router = APIRouter(
    prefix="/api/cf-firewall-templates",
    tags=["cf-firewall-templates"],
    dependencies=[Depends(get_current_username)],
)


class CreateCfFirewallTemplateRequest(BaseModel):
    name: str
    countries_blocked: list[str] = []
    blocked_user_agents: list[str] = []
    blocked_paths: list[str] = []
    bot_fight_mode: bool = False
    skip_safety_enabled: bool = True
    block_bad_ports_enabled: bool = True
    block_bad_ua_enabled: bool = True


class UpdateCfFirewallTemplateRequest(BaseModel):
    name: str | None = None
    countries_blocked: list[str] | None = None
    blocked_user_agents: list[str] | None = None
    blocked_paths: list[str] | None = None
    bot_fight_mode: bool | None = None
    skip_safety_enabled: bool | None = None
    block_bad_ports_enabled: bool | None = None
    block_bad_ua_enabled: bool | None = None


def _normalize_countries(codes: list[str]) -> list[str]:
    out = []
    for c in codes:
        c = c.strip().upper()
        if len(c) != 2 or not c.isalpha():
            raise HTTPException(status_code=400, detail=f"'{c}' không phải mã quốc gia hợp lệ (2 chữ cái)")
        if c not in out:
            out.append(c)
    return out


def _normalize_strings(values: list[str]) -> list[str]:
    out = []
    for v in values:
        v = v.strip()
        if v and v not in out:
            out.append(v)
    return out


@router.get("")
def list_cf_firewall_templates(db: Session = Depends(get_db)):
    rows = db.execute(
        select(CfFirewallTemplate).order_by(CfFirewallTemplate.is_default.desc(), CfFirewallTemplate.name)
    ).scalars().all()
    return {"data": [CfFirewallTemplateOut.from_row(r).model_dump() for r in rows], "success": True}


@router.post("", dependencies=[Depends(require_admin)])
def create_cf_firewall_template(
    body: CreateCfFirewallTemplateRequest,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tên template không được để trống")
    if db.execute(select(CfFirewallTemplate).where(CfFirewallTemplate.name == name)).scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Template '{name}' đã tồn tại")

    row = CfFirewallTemplate(
        name=name,
        countries_blocked=json.dumps(_normalize_countries(body.countries_blocked)),
        blocked_user_agents=json.dumps(_normalize_strings(body.blocked_user_agents)),
        blocked_paths=json.dumps(_normalize_strings(body.blocked_paths)),
        bot_fight_mode=body.bot_fight_mode,
        skip_safety_enabled=body.skip_safety_enabled,
        block_bad_ports_enabled=body.block_bad_ports_enabled,
        block_bad_ua_enabled=body.block_bad_ua_enabled,
        is_default=False,
        created_by=username,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return CfFirewallTemplateOut.from_row(row).model_dump()


@router.put("/{template_id}", dependencies=[Depends(require_admin)])
def update_cf_firewall_template(
    template_id: int, body: UpdateCfFirewallTemplateRequest, db: Session = Depends(get_db)
):
    row = db.get(CfFirewallTemplate, template_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Tên template không được để trống")
        dup = db.execute(
            select(CfFirewallTemplate).where(CfFirewallTemplate.name == name, CfFirewallTemplate.id != template_id)
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=400, detail=f"Template '{name}' đã tồn tại")
        row.name = name
    if body.countries_blocked is not None:
        row.countries_blocked = json.dumps(_normalize_countries(body.countries_blocked))
    if body.blocked_user_agents is not None:
        row.blocked_user_agents = json.dumps(_normalize_strings(body.blocked_user_agents))
    if body.blocked_paths is not None:
        row.blocked_paths = json.dumps(_normalize_strings(body.blocked_paths))
    if body.bot_fight_mode is not None:
        row.bot_fight_mode = body.bot_fight_mode
    if body.skip_safety_enabled is not None:
        row.skip_safety_enabled = body.skip_safety_enabled
    if body.block_bad_ports_enabled is not None:
        row.block_bad_ports_enabled = body.block_bad_ports_enabled
    if body.block_bad_ua_enabled is not None:
        row.block_bad_ua_enabled = body.block_bad_ua_enabled

    db.commit()
    db.refresh(row)
    return CfFirewallTemplateOut.from_row(row).model_dump()


@router.delete("/{template_id}", dependencies=[Depends(require_admin)])
def delete_cf_firewall_template(template_id: int, db: Session = Depends(get_db)):
    row = db.get(CfFirewallTemplate, template_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    if row.is_default:
        raise HTTPException(
            status_code=400,
            detail=f"Không thể xoá template '{DEFAULT_TEMPLATE_NAME}' - luôn cần 1 template an toàn để quay lại",
        )
    db.delete(row)
    db.commit()
    return {"success": True}
