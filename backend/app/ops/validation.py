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


def is_valid_ip(ip: str) -> bool:
    parts = ip.strip().split(".")
    if len(parts) != 4:
        return False
    try:
        return all(0 <= int(p) <= 255 for p in parts)
    except ValueError:
        return False
