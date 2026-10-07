import json
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CfFirewallTemplate

# Exact values that used to be hardcoded in cf_ops._build_firewall_rules -
# seeded once as the "Mặc định" template so turning the ruleset into a
# DB-backed, per-run-selectable template doesn't change behavior for anyone
# who just keeps picking the default. Never deleted (see
# routers/cf_firewall_templates.py) - always a known-good fallback.
DEFAULT_TEMPLATE_NAME = "Mặc định"
_DEFAULT_COUNTRIES = ["PH", "AE", "US", "AG", "MT", "CW", "GB", "DE", "CR", "CA", "SG", "FR"]
_DEFAULT_PATHS = ["xmlrpc.php"]
_DEFAULT_SKIP_PATHS = ["/wp-json/"]
_DEFAULT_SKIP_ASNS = ["15169"]  # Google
_DEFAULT_ALLOWED_PORTS = ["80", "443"]
_DEFAULT_ALLOWED_UA_SUBSTRINGS = ["mozilla", "opera"]


def template_to_params(row: CfFirewallTemplate) -> dict:
    """Decodes 1 CfFirewallTemplate row into the plain dict cf_ops.py's
    firewall functions take - the one place that shape is defined, so
    add_domains' default-template resolution and the Firewall page's
    chosen-template resolution can't drift apart."""
    return {
        "name": row.name,
        "countries_blocked": json.loads(row.countries_blocked),
        "blocked_user_agents": json.loads(row.blocked_user_agents),
        "blocked_paths": json.loads(row.blocked_paths),
        "bot_fight_mode": row.bot_fight_mode,
        "skip_paths": json.loads(row.skip_paths),
        "skip_verified_bot": row.skip_verified_bot,
        "skip_whitelist_ip": row.skip_whitelist_ip,
        "skip_asns": json.loads(row.skip_asns),
        "allowed_ports": json.loads(row.allowed_ports),
        "allowed_ua_substrings": json.loads(row.allowed_ua_substrings),
    }


def get_default_template_params(db: Session) -> dict:
    """Used by flows with no template picker of their own (currently:
    add_domains, when first creating a brand-new zone) - always resolves to
    the "Mặc định" template's current values, never a stale hardcoded copy."""
    row = db.execute(
        select(CfFirewallTemplate).where(CfFirewallTemplate.is_default.is_(True))
    ).scalar_one_or_none()
    if not row:
        return {
            "name": DEFAULT_TEMPLATE_NAME, "countries_blocked": [], "blocked_user_agents": [],
            "blocked_paths": [], "bot_fight_mode": False, "skip_paths": _DEFAULT_SKIP_PATHS,
            "skip_verified_bot": True, "skip_whitelist_ip": True, "skip_asns": _DEFAULT_SKIP_ASNS,
            "allowed_ports": _DEFAULT_ALLOWED_PORTS, "allowed_ua_substrings": _DEFAULT_ALLOWED_UA_SUBSTRINGS,
        }
    return template_to_params(row)


def seed_cf_firewall_templates(db: Session) -> None:
    existing = db.execute(
        select(CfFirewallTemplate).where(CfFirewallTemplate.name == DEFAULT_TEMPLATE_NAME)
    ).scalar_one_or_none()
    if existing:
        return
    db.add(CfFirewallTemplate(
        name=DEFAULT_TEMPLATE_NAME,
        countries_blocked=json.dumps(_DEFAULT_COUNTRIES),
        blocked_user_agents=json.dumps([]),
        blocked_paths=json.dumps(_DEFAULT_PATHS),
        bot_fight_mode=False,
        skip_paths=json.dumps(_DEFAULT_SKIP_PATHS),
        skip_verified_bot=True,
        skip_whitelist_ip=True,
        skip_asns=json.dumps(_DEFAULT_SKIP_ASNS),
        allowed_ports=json.dumps(_DEFAULT_ALLOWED_PORTS),
        allowed_ua_substrings=json.dumps(_DEFAULT_ALLOWED_UA_SUBSTRINGS),
        is_default=True,
        created_by="system",
        created_at=datetime.now(timezone.utc),
    ))
    db.commit()
