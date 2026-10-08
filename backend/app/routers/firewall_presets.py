import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import get_current_username, require_admin
from app.database import get_db
from app.firewall_preset_service import DEFAULT_PRESET_NAME
from app.models import FirewallPreset
from app.ops.validation import is_valid_ip
from app.schemas import FirewallPresetOut

# Reading the list (any logged-in user - the Firewall page needs it to
# offer a preset picker) vs editing it (admin only, per the user's explicit
# call: whoever runs the Firewall page rarely re-checks rule content before
# confirming, so defining/changing what a preset actually blocks needs a
# stricter gate than just being logged in) require different auth, so
# require_admin is applied per-endpoint below rather than once on the whole
# router.
router = APIRouter(
    prefix="/api/firewall-presets",
    tags=["firewall-presets"],
    dependencies=[Depends(get_current_username)],
)


class CreateFirewallPresetRequest(BaseModel):
    name: str
    countries_blocked: list[str] = []
    blocked_user_agents: list[str] = []
    blocked_paths: list[str] = []
    bot_fight_mode: bool = False
    whitelist_ips: list[str] = []
    skip_paths: list[str] = ["/wp-json/"]
    skip_verified_bot: bool = True
    skip_asns: list[str] = ["15169"]
    allowed_ports: list[str] = ["80", "443"]
    allowed_ua_substrings: list[str] = ["mozilla", "opera"]


class UpdateFirewallPresetRequest(BaseModel):
    name: str | None = None
    countries_blocked: list[str] | None = None
    blocked_user_agents: list[str] | None = None
    blocked_paths: list[str] | None = None
    bot_fight_mode: bool | None = None
    whitelist_ips: list[str] | None = None
    skip_paths: list[str] | None = None
    skip_verified_bot: bool | None = None
    skip_asns: list[str] | None = None
    allowed_ports: list[str] | None = None
    allowed_ua_substrings: list[str] | None = None


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


def _normalize_ports(values: list[str]) -> list[str]:
    out = []
    for v in values:
        v = str(v).strip()
        if not v.isdigit() or not (1 <= int(v) <= 65535):
            raise HTTPException(status_code=400, detail=f"'{v}' không phải port hợp lệ (1-65535)")
        if v not in out:
            out.append(v)
    return out


def _normalize_asns(values: list[str]) -> list[str]:
    out = []
    for v in values:
        v = str(v).strip()
        if not v.isdigit():
            raise HTTPException(status_code=400, detail=f"'{v}' không phải ASN hợp lệ (chỉ gồm số)")
        if v not in out:
            out.append(v)
    return out


def _normalize_ips(values: list[str]) -> list[str]:
    out = []
    for v in values:
        v = v.strip()
        if not is_valid_ip(v):
            raise HTTPException(status_code=400, detail=f"'{v}' không phải IPv4 hợp lệ")
        if v not in out:
            out.append(v)
    return out


@router.get("")
def list_firewall_presets(db: Session = Depends(get_db)):
    rows = db.execute(
        select(FirewallPreset).order_by(FirewallPreset.is_default.desc(), FirewallPreset.name)
    ).scalars().all()
    return {"data": [FirewallPresetOut.from_row(r).model_dump() for r in rows], "success": True}


@router.post("", dependencies=[Depends(require_admin)])
def create_firewall_preset(
    body: CreateFirewallPresetRequest,
    db: Session = Depends(get_db),
    username: str = Depends(get_current_username),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tên preset không được để trống")
    if db.execute(select(FirewallPreset).where(FirewallPreset.name == name)).scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Preset '{name}' đã tồn tại")

    row = FirewallPreset(
        name=name,
        countries_blocked=json.dumps(_normalize_countries(body.countries_blocked)),
        blocked_user_agents=json.dumps(_normalize_strings(body.blocked_user_agents)),
        blocked_paths=json.dumps(_normalize_strings(body.blocked_paths)),
        bot_fight_mode=body.bot_fight_mode,
        whitelist_ips=json.dumps(_normalize_ips(body.whitelist_ips)),
        skip_paths=json.dumps(_normalize_strings(body.skip_paths)),
        skip_verified_bot=body.skip_verified_bot,
        skip_asns=json.dumps(_normalize_asns(body.skip_asns)),
        allowed_ports=json.dumps(_normalize_ports(body.allowed_ports)),
        allowed_ua_substrings=json.dumps(_normalize_strings(body.allowed_ua_substrings)),
        is_default=False,
        created_by=username,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return FirewallPresetOut.from_row(row).model_dump()


@router.put("/{preset_id}", dependencies=[Depends(require_admin)])
def update_firewall_preset(
    preset_id: int, body: UpdateFirewallPresetRequest, db: Session = Depends(get_db)
):
    row = db.get(FirewallPreset, preset_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")

    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Tên preset không được để trống")
        dup = db.execute(
            select(FirewallPreset).where(FirewallPreset.name == name, FirewallPreset.id != preset_id)
        ).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=400, detail=f"Preset '{name}' đã tồn tại")
        row.name = name
    if body.countries_blocked is not None:
        row.countries_blocked = json.dumps(_normalize_countries(body.countries_blocked))
    if body.blocked_user_agents is not None:
        row.blocked_user_agents = json.dumps(_normalize_strings(body.blocked_user_agents))
    if body.blocked_paths is not None:
        row.blocked_paths = json.dumps(_normalize_strings(body.blocked_paths))
    if body.bot_fight_mode is not None:
        row.bot_fight_mode = body.bot_fight_mode
    if body.whitelist_ips is not None:
        row.whitelist_ips = json.dumps(_normalize_ips(body.whitelist_ips))
    if body.skip_paths is not None:
        row.skip_paths = json.dumps(_normalize_strings(body.skip_paths))
    if body.skip_verified_bot is not None:
        row.skip_verified_bot = body.skip_verified_bot
    if body.skip_asns is not None:
        row.skip_asns = json.dumps(_normalize_asns(body.skip_asns))
    if body.allowed_ports is not None:
        row.allowed_ports = json.dumps(_normalize_ports(body.allowed_ports))
    if body.allowed_ua_substrings is not None:
        row.allowed_ua_substrings = json.dumps(_normalize_strings(body.allowed_ua_substrings))

    db.commit()
    db.refresh(row)
    return FirewallPresetOut.from_row(row).model_dump()


@router.delete("/{preset_id}", dependencies=[Depends(require_admin)])
def delete_firewall_preset(preset_id: int, db: Session = Depends(get_db)):
    row = db.get(FirewallPreset, preset_id)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    if row.is_default:
        raise HTTPException(
            status_code=400,
            detail=f"Không thể xoá preset '{DEFAULT_PRESET_NAME}' - luôn cần 1 preset an toàn để quay lại",
        )
    db.delete(row)
    db.commit()
    return {"success": True}
