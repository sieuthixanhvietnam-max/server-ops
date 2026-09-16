"""Dispatches to the right cloud-specific firewall/security-group module by
profile, so a caller (wp_migrate_ops.py) never needs to know which cloud a
destination server is on - just call add_ip(profile, ip, log) before
opening SSH to it, and remove_ip(...) after. Each provider module is
independently a safe no-op for any profile it doesn't recognize, so the
final `return True` here only matters for a profile none of the three
modules have heard of at all."""

from app.ops import ali_firewall_ops, do_firewall_ops, gcp_firewall_ops


def add_ip(profile: str, ip: str, log) -> bool:
    if profile in gcp_firewall_ops.GCP_FIREWALL_PROFILES:
        return gcp_firewall_ops.add_ip(profile, ip, log)
    if profile in ali_firewall_ops.ALI_FIREWALL_PROFILES:
        return ali_firewall_ops.add_ip(profile, ip, log)
    if profile in do_firewall_ops.DO_FIREWALL_PROFILES:
        return do_firewall_ops.add_ip(profile, ip, log)
    return True


def remove_ip(profile: str, ip: str, log) -> bool:
    if profile in gcp_firewall_ops.GCP_FIREWALL_PROFILES:
        return gcp_firewall_ops.remove_ip(profile, ip, log)
    if profile in ali_firewall_ops.ALI_FIREWALL_PROFILES:
        return ali_firewall_ops.remove_ip(profile, ip, log)
    if profile in do_firewall_ops.DO_FIREWALL_PROFILES:
        return do_firewall_ops.remove_ip(profile, ip, log)
    return True
