import os
import time

import requests
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import service_account

from app.config import settings

# Only servers reached through a GCP firewall rule that manually whitelists
# source IPs need this. Ali/DO are NOT broadly open the way an earlier
# version of this comment assumed - checked live 2026-08-21 and both
# ali_enterprise and do_sgp1 also restrict inbound SSH to specific IPs; see
# ali_firewall_ops.py / do_firewall_ops.py (dispatched together via
# firewall_ops.py, which is what wp_migrate_ops.py actually calls - this
# module is never called directly from there anymore). gcp_tier1 exists as
# a profile but has no discoverable firewall rule via its own service
# account (checked directly with gcloud) and isn't a migration destination
# today, so it's deliberately left out until it's actually needed.
GCP_FIREWALL_PROFILES = {
    "gcp_enterprise": {
        "sa_json": os.path.join(settings.ssh_key_dir, "seo1-key-gcp-enterprise.json"),
        "project": "pr-20260703",
        "rule": "seo1-allow-ssh",
    },
}

_BASE_URL = "https://compute.googleapis.com/compute/v1"


class _GCPFirewallClient:
    def __init__(self, sa_json_path: str, project: str):
        self.project = project
        self._creds = service_account.Credentials.from_service_account_file(
            sa_json_path, scopes=["https://www.googleapis.com/auth/compute"],
        )
        self._creds.refresh(GoogleRequest())

    def _headers(self):
        if not self._creds.valid:
            self._creds.refresh(GoogleRequest())
        return {"Authorization": f"Bearer {self._creds.token}", "Content-Type": "application/json"}

    def _get_rule(self, rule_name: str) -> dict:
        url = f"{_BASE_URL}/projects/{self.project}/global/firewalls/{rule_name}"
        r = requests.get(url, headers=self._headers(), timeout=15)
        r.raise_for_status()
        return r.json()

    def _patch_rule(self, rule_name: str, body: dict) -> dict:
        url = f"{_BASE_URL}/projects/{self.project}/global/firewalls/{rule_name}"
        r = requests.patch(url, headers=self._headers(), json=body, timeout=15)
        r.raise_for_status()
        return r.json()

    def _wait_op(self, op: dict, max_wait: int = 60):
        url = f"{_BASE_URL}/projects/{self.project}/global/operations/{op['name']}"
        elapsed = 0
        while elapsed < max_wait:
            r = requests.get(url, headers=self._headers(), timeout=15)
            data = r.json()
            if data.get("status") == "DONE":
                if "error" in data:
                    raise RuntimeError(f"GCP operation error: {data['error']}")
                return
            time.sleep(2)
            elapsed += 2
        raise TimeoutError("GCP firewall operation timed out")

    def add_ip(self, rule_name: str, ip: str) -> tuple[bool, str]:
        cidr = f"{ip}/32"
        rule = self._get_rule(rule_name)
        ranges = rule.get("sourceRanges", [])
        if cidr in ranges:
            return True, f"{cidr} already in {rule_name}"
        ranges.append(cidr)
        op = self._patch_rule(rule_name, {"sourceRanges": ranges})
        self._wait_op(op)
        return True, f"added {cidr} to {rule_name}"

    def remove_ip(self, rule_name: str, ip: str) -> tuple[bool, str]:
        cidr = f"{ip}/32"
        rule = self._get_rule(rule_name)
        ranges = rule.get("sourceRanges", [])
        if cidr not in ranges:
            return True, f"{cidr} not in {rule_name} (nothing to remove)"
        ranges.remove(cidr)
        op = self._patch_rule(rule_name, {"sourceRanges": ranges})
        self._wait_op(op)
        return True, f"removed {cidr} from {rule_name}"


# One client per profile, created lazily and reused across calls within the
# same process - re-authenticating on every add/remove would needlessly
# round-trip to Google's token endpoint each time.
_clients: dict[str, _GCPFirewallClient] = {}


def _get_client(profile: str) -> _GCPFirewallClient | None:
    cfg = GCP_FIREWALL_PROFILES.get(profile)
    if not cfg:
        return None
    if profile not in _clients:
        _clients[profile] = _GCPFirewallClient(cfg["sa_json"], cfg["project"])
    return _clients[profile]


def add_ip(profile: str, ip: str, log) -> bool:
    """No-op (returns True) for any profile without a configured GCP
    firewall rule - safe to call unconditionally for every migrate
    destination, GCP or not."""
    cfg = GCP_FIREWALL_PROFILES.get(profile)
    if not cfg:
        return True
    try:
        client = _get_client(profile)
        ok, msg = client.add_ip(cfg["rule"], ip)
        log(f"    [gcp-fw] {msg}")
        return ok
    except Exception as exc:
        log(f"    [fail] gcp-fw add {ip} -> {cfg['rule']}: {exc}")
        return False


def remove_ip(profile: str, ip: str, log) -> bool:
    cfg = GCP_FIREWALL_PROFILES.get(profile)
    if not cfg:
        return True
    try:
        client = _get_client(profile)
        ok, msg = client.remove_ip(cfg["rule"], ip)
        log(f"    [gcp-fw] {msg}")
        return ok
    except Exception as exc:
        log(f"    [fail] gcp-fw remove {ip} from {cfg['rule']}: {exc}")
        return False
