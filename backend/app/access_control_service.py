from datetime import datetime, timezone

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AllowedIp

# Static IPs provided for the initial internal-access rollout - seeded once so
# nobody is locked out the moment the allowlist ships. Only inserts missing
# rows; further changes (edit/deactivate/remove) go through the "Access
# Control" page, not here.
SEED_ALLOWED_IPS = {
    "TODD": "192.177.71.221",
    "CARR": "23.230.31.115",
    "ROSE": "166.88.119.249",
    "PIEE": "108.165.96.45",
    "CAN": "192.177.85.83",
    "CHAT": "192.177.68.187",
    "TIMM": "192.177.66.44",
    "QUICK": "166.88.119.250",
    "CREW": "166.88.119.251",
    "BANG": "192.177.85.79",
    "BEAR": "192.177.68.226",
    "VIN": "104.253.193.165",
    "PII": "142.111.69.199",
    "RUP": "192.177.71.1",
    "SOP": "166.88.119.110",
    "COS": "166.88.119.210",
    "ARM": "171.6.245.60",
}


def seed_allowed_ips(db: Session) -> None:
    existing = {r.ip for r in db.execute(select(AllowedIp)).scalars().all()}
    for label, ip in SEED_ALLOWED_IPS.items():
        if ip not in existing:
            db.add(AllowedIp(label=label, ip=ip, is_active=True, note="", created_at=datetime.now(timezone.utc)))
    db.commit()


def get_client_ip(request: Request) -> str:
    """Resolve the real client IP. Prefers Cloudflare's/a reverse proxy's
    header over the raw socket peer, since once this app sits behind
    Cloudflare, request.client.host would just be Cloudflare's edge IP - not
    the visitor's. Only safe as long as the origin isn't reachable except
    through that trusted proxy (otherwise these headers can be spoofed)."""
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""


def is_ip_allowed(db: Session, ip: str) -> bool:
    row = db.execute(
        select(AllowedIp).where(AllowedIp.ip == ip, AllowedIp.is_active.is_(True))
    ).scalar_one_or_none()
    return row is not None
