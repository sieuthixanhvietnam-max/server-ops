import re

# Conservative hostname/domain whitelist: labels of letters/digits/hyphens,
# TLD of letters only. Rejects anything that could break out of a shell
# argument or contain path traversal - this is the first layer of defense
# against command injection, on top of args always being passed as script
# positional parameters (never interpolated into script text).
_DOMAIN_RE = re.compile(
    r"^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$"
)


def is_valid_domain(domain: str) -> bool:
    return bool(_DOMAIN_RE.match(domain.strip()))


def validate_domains(domains: list[str]) -> tuple[list[str], list[str]]:
    """Returns (valid, invalid) domain lists."""
    valid, invalid = [], []
    for d in domains:
        d = d.strip().lower()
        if is_valid_domain(d):
            valid.append(d)
        else:
            invalid.append(d)
    return valid, invalid


# Every "Tạo WordPress mới" template lives at <server_name>.wp-template.site
# (see the site-trang.com -> wp-template.site migration) and is each
# server's wptt Website_chinh - the one domain every future clone on that
# server is sourced from. clone_wpsite/create_wpsite overwrite an existing
# target unconditionally, so letting a template domain through as a TARGET
# would let one fat-fingered request permanently destroy the one asset a
# whole PIC's future site creation depends on, with no backup to restore
# from. This is deliberately a plain suffix check, not a DB flag - Domain
# is a full-replace-on-sync table, so a persisted "is_template" column
# would need to survive every resync; the naming convention is already the
# single source of truth by construction.
TEMPLATE_DOMAIN_SUFFIX = ".wp-template.site"


def is_template_domain(domain: str) -> bool:
    return domain.strip().lower().endswith(TEMPLATE_DOMAIN_SUFFIX)


def is_valid_ip(ip: str) -> bool:
    parts = ip.strip().split(".")
    if len(parts) != 4:
        return False
    try:
        return all(0 <= int(p) <= 255 for p in parts)
    except ValueError:
        return False
