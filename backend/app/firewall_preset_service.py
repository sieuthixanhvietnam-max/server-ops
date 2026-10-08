import json
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import FirewallPreset

DEFAULT_PRESET_NAME = "Mặc định"
_DEFAULT_COUNTRIES = ["PH", "AE", "US", "AG", "MT", "CW", "GB", "DE", "CR", "CA", "SG", "FR"]
_DEFAULT_PATHS = ["xmlrpc.php"]
_DEFAULT_SKIP_PATHS = ["/wp-json/"]
_DEFAULT_SKIP_ASNS = ["15169"]  # Google
_DEFAULT_ALLOWED_PORTS = ["80", "443"]
_DEFAULT_ALLOWED_UA_SUBSTRINGS = ["mozilla", "opera"]
# The exact (ip, label) pairs live in production's cf_whitelist_ips table
# as of 2026-10-08 (queried directly via psql on the production host, label
# carried over too so the fold-in doesn't lose the "whose IP this is" notes -
# not the original 33-IP hardcoded migration list, which was itself stale:
# 3 had been added by hand since then - 146.190.87.62 "ops-vps", 166.88.
# 120.246 "S TRUST", 192.177.66.24 "Q Gum") - seeded onto the "Mặc định"
# preset so the real bot/office IPs this org already relies on survive the
# standalone "Whitelist IP" page's retirement unchanged. If this list and
# production's cf_whitelist_ips ever drift again before this deploys,
# re-query production rather than trusting this comment's age. "N/A" labels
# in production are turned into "" here - that filler text isn't a real
# label worth carrying forward.
_DEFAULT_WHITELIST_IPS = [
    {"ip": "8.222.213.17", "label": "IP TOOL QC M3"},
    {"ip": "104.253.193.165", "label": "S VIN"},
    {"ip": "122.248.206.212", "label": ""},
    {"ip": "139.59.224.39", "label": ""},
    {"ip": "142.111.69.199", "label": "S PII"},
    {"ip": "146.190.87.62", "label": "ops-vps"},
    {"ip": "159.192.43.132", "label": ""},
    {"ip": "139.59.227.174", "label": "IP TOOL"},
    {"ip": "166.88.119.110", "label": "S SOP"},
    {"ip": "166.88.119.210", "label": "S COS"},
    {"ip": "166.88.119.211", "label": ""},
    {"ip": "166.88.119.214", "label": ""},
    {"ip": "166.88.119.249", "label": "ROSE"},
    {"ip": "166.88.119.250", "label": "S QUICK"},
    {"ip": "166.88.119.251", "label": "S CREW"},
    {"ip": "166.88.120.246", "label": "S TRUST"},
    {"ip": "171.233.128.13", "label": ""},
    {"ip": "192.168.1.5", "label": ""},
    {"ip": "192.168.1.70", "label": ""},
    {"ip": "192.177.66.24", "label": "Q Gum"},
    {"ip": "192.177.66.44", "label": "S TIMM"},
    {"ip": "192.177.68.187", "label": "S CHAT"},
    {"ip": "192.177.68.225", "label": "S NING"},
    {"ip": "192.177.68.226", "label": "S BEAR"},
    {"ip": "192.177.68.35", "label": "S HAM"},
    {"ip": "192.177.68.48", "label": "S PUN"},
    {"ip": "192.177.71.1", "label": "S RUP"},
    {"ip": "192.177.71.113", "label": ""},
    {"ip": "192.177.71.221", "label": "S TODD"},
    {"ip": "192.177.71.222", "label": ""},
    {"ip": "192.177.71.61", "label": ""},
    {"ip": "192.177.71.78", "label": ""},
    {"ip": "192.177.85.79", "label": "S BANG"},
    {"ip": "23.230.31.115", "label": "S CARR"},
    {"ip": "3.90.129.137", "label": ""},
    {"ip": "54.254.237.225", "label": ""},
]


def preset_to_params(row: FirewallPreset) -> dict:
    """Decodes 1 FirewallPreset row into the plain dict cf_ops.py's firewall
    functions take - the one place that shape is defined, so add_domains'
    default-preset resolution and the Firewall page's chosen-preset
    resolution can't drift apart."""
    return {
        "name": row.name,
        "countries_blocked": json.loads(row.countries_blocked),
        "blocked_user_agents": json.loads(row.blocked_user_agents),
        "blocked_paths": json.loads(row.blocked_paths),
        "bot_fight_mode": row.bot_fight_mode,
        "whitelist_ips": json.loads(row.whitelist_ips),
        "skip_paths": json.loads(row.skip_paths),
        "skip_verified_bot": row.skip_verified_bot,
        "skip_asns": json.loads(row.skip_asns),
        "allowed_ports": json.loads(row.allowed_ports),
        "allowed_ua_substrings": json.loads(row.allowed_ua_substrings),
    }


def get_default_preset_params(db: Session) -> dict:
    """Used by flows with no preset picker of their own (currently:
    add_domains, when first creating a brand-new zone) - always resolves to
    the "Mặc định" preset's current values, never a stale hardcoded copy."""
    row = db.execute(
        select(FirewallPreset).where(FirewallPreset.is_default.is_(True))
    ).scalar_one_or_none()
    if not row:
        return {
            "name": DEFAULT_PRESET_NAME, "countries_blocked": [], "blocked_user_agents": [],
            "blocked_paths": [], "bot_fight_mode": False, "whitelist_ips": [],
            "skip_paths": _DEFAULT_SKIP_PATHS, "skip_verified_bot": True, "skip_asns": _DEFAULT_SKIP_ASNS,
            "allowed_ports": _DEFAULT_ALLOWED_PORTS, "allowed_ua_substrings": _DEFAULT_ALLOWED_UA_SUBSTRINGS,
        }
    return preset_to_params(row)


def seed_firewall_presets(db: Session) -> None:
    existing = db.execute(
        select(FirewallPreset).where(FirewallPreset.name == DEFAULT_PRESET_NAME)
    ).scalar_one_or_none()
    if existing:
        return
    db.add(FirewallPreset(
        name=DEFAULT_PRESET_NAME,
        countries_blocked=json.dumps(_DEFAULT_COUNTRIES),
        blocked_user_agents=json.dumps([]),
        blocked_paths=json.dumps(_DEFAULT_PATHS),
        bot_fight_mode=False,
        whitelist_ips=json.dumps(_DEFAULT_WHITELIST_IPS),
        skip_paths=json.dumps(_DEFAULT_SKIP_PATHS),
        skip_verified_bot=True,
        skip_asns=json.dumps(_DEFAULT_SKIP_ASNS),
        allowed_ports=json.dumps(_DEFAULT_ALLOWED_PORTS),
        allowed_ua_substrings=json.dumps(_DEFAULT_ALLOWED_UA_SUBSTRINGS),
        is_default=True,
        created_by="system",
        created_at=datetime.now(timezone.utc),
    ))
    db.commit()
