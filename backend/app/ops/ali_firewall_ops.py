import json

from aliyunsdkcore.acs_exception.exceptions import ClientException, ServerException
from aliyunsdkcore.client import AcsClient
from aliyunsdkecs.request.v20140526.AuthorizeSecurityGroupRequest import AuthorizeSecurityGroupRequest
from aliyunsdkecs.request.v20140526.DescribeSecurityGroupAttributeRequest import (
    DescribeSecurityGroupAttributeRequest,
)
from aliyunsdkecs.request.v20140526.RevokeSecurityGroupRequest import RevokeSecurityGroupRequest

from app.config import settings

# Only accounts confirmed (via live DescribeSecurityGroupAttribute, not
# assumption) to actually restrict inbound SSH need this - checked 2026-08-21
# after finding the "Ali already allows SSH broadly" comment that used to be
# in gcp_firewall_ops.py was wrong for ali_enterprise: its one shared
# security group has 14 port-22 rules, every one a narrow /32, several
# labeled "temp migrate" - evidence past migrations already hand-whitelisted
# IPs the same way this automates. ali_seo1 has no ECS instances in any
# region checked, so there's nothing to scope a profile to yet.
ALI_FIREWALL_PROFILES = {
    "ali_enterprise": {"region": "ap-southeast-1", "security_group_id": "sg-t4n2mqq32buzsg4pa5q0"},
}

_RULE_DESCRIPTION = "migrate-auto"

_clients: dict[str, AcsClient] = {}


def _get_client(profile: str, region: str) -> AcsClient:
    if profile not in _clients:
        _clients[profile] = AcsClient(
            settings.ali_enterprise_access_key_id, settings.ali_enterprise_access_key_secret, region,
        )
    return _clients[profile]


def _rule_exists(client: AcsClient, sg_id: str, ip: str) -> bool:
    req = DescribeSecurityGroupAttributeRequest()
    req.set_accept_format("json")
    req.set_SecurityGroupId(sg_id)
    data = json.loads(client.do_action_with_exception(req))
    cidr = f"{ip}/32"
    return any(
        p.get("PortRange") == "22/22" and p.get("SourceCidrIp") == cidr
        for p in data.get("Permissions", {}).get("Permission", [])
    )


def add_ip(profile: str, ip: str, log) -> bool:
    """No-op (returns True) for any profile without a configured Alibaba
    security group - safe to call unconditionally for every migrate
    destination, Alibaba or not."""
    cfg = ALI_FIREWALL_PROFILES.get(profile)
    if not cfg:
        return True
    try:
        client = _get_client(profile, cfg["region"])
        sg_id = cfg["security_group_id"]
        if _rule_exists(client, sg_id, ip):
            log(f"    [ali-fw] {ip}/32 already allowed on {sg_id}")
            return True
        req = AuthorizeSecurityGroupRequest()
        req.set_accept_format("json")
        req.set_SecurityGroupId(sg_id)
        req.set_IpProtocol("tcp")
        req.set_PortRange("22/22")
        req.set_SourceCidrIp(f"{ip}/32")
        req.set_Description(_RULE_DESCRIPTION)
        client.do_action_with_exception(req)
        log(f"    [ali-fw] added {ip}/32 to {sg_id}")
        return True
    except (ClientException, ServerException) as exc:
        log(f"    [fail] ali-fw add {ip} -> {cfg['security_group_id']}: {exc}")
        return False


def remove_ip(profile: str, ip: str, log) -> bool:
    cfg = ALI_FIREWALL_PROFILES.get(profile)
    if not cfg:
        return True
    try:
        client = _get_client(profile, cfg["region"])
        sg_id = cfg["security_group_id"]
        if not _rule_exists(client, sg_id, ip):
            log(f"    [ali-fw] {ip}/32 not on {sg_id} (nothing to remove)")
            return True
        req = RevokeSecurityGroupRequest()
        req.set_accept_format("json")
        req.set_SecurityGroupId(sg_id)
        req.set_IpProtocol("tcp")
        req.set_PortRange("22/22")
        req.set_SourceCidrIp(f"{ip}/32")
        client.do_action_with_exception(req)
        log(f"    [ali-fw] removed {ip}/32 from {sg_id}")
        return True
    except (ClientException, ServerException) as exc:
        log(f"    [fail] ali-fw remove {ip} from {cfg['security_group_id']}: {exc}")
        return False
