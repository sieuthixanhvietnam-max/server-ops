import requests

from app.config import settings

# Only the one Cloud Firewall confirmed (via live `doctl compute firewall
# get`, not assumption) to actually restrict inbound SSH - checked
# 2026-08-21. seo1-wp-firewall is attached to the do_sgp1 WordPress droplet
# (139.59.227.174) with port 22 open to a handful of /32s only. The app's
# own VPS (146.190.87.62) has no Cloud Firewall attached at all, so there's
# nothing to automate for it.
DO_FIREWALL_PROFILES = {
    "do_sgp1": {"firewall_id": "f326d97b-8591-4b1d-adb2-c34aee9699d6"},
}

_BASE_URL = "https://api.digitalocean.com/v2/firewalls"


def _headers():
    return {"Authorization": f"Bearer {settings.do_seo1_access_token}", "Content-Type": "application/json"}


def _rule_body(ip: str) -> dict:
    return {"inbound_rules": [{"protocol": "tcp", "ports": "22", "sources": {"addresses": [f"{ip}/32"]}}]}


def add_ip(profile: str, ip: str, log) -> bool:
    """No-op (returns True) for any profile without a configured DO
    firewall - safe to call unconditionally for every migrate destination,
    DigitalOcean or not. DO's rules endpoint is additive (unlike GCP/
    Alibaba, no read-modify-write of the full rule list needed) and
    idempotent on the exact same rule, so no pre-check is required."""
    cfg = DO_FIREWALL_PROFILES.get(profile)
    if not cfg:
        return True
    try:
        r = requests.post(
            f"{_BASE_URL}/{cfg['firewall_id']}/rules", headers=_headers(), json=_rule_body(ip), timeout=15,
        )
        if r.status_code not in (204, 202):
            log(f"    [fail] do-fw add {ip} -> {cfg['firewall_id']}: HTTP {r.status_code} {r.text[:200]}")
            return False
        log(f"    [do-fw] added {ip}/32 to {cfg['firewall_id']}")
        return True
    except requests.RequestException as exc:
        log(f"    [fail] do-fw add {ip} -> {cfg['firewall_id']}: {exc}")
        return False


def remove_ip(profile: str, ip: str, log) -> bool:
    cfg = DO_FIREWALL_PROFILES.get(profile)
    if not cfg:
        return True
    try:
        r = requests.delete(
            f"{_BASE_URL}/{cfg['firewall_id']}/rules", headers=_headers(), json=_rule_body(ip), timeout=15,
        )
        if r.status_code not in (204, 202):
            log(f"    [fail] do-fw remove {ip} from {cfg['firewall_id']}: HTTP {r.status_code} {r.text[:200]}")
            return False
        log(f"    [do-fw] removed {ip}/32 from {cfg['firewall_id']}")
        return True
    except requests.RequestException as exc:
        log(f"    [fail] do-fw remove {ip} from {cfg['firewall_id']}: {exc}")
        return False
