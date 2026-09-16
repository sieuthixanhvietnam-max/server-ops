from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CfWhitelistIp

# The IPs that used to be the hardcoded WHITELIST_IPS constant in
# ops/cf_ops.py - seeded once so migrating to a DB-backed list doesn't
# silently drop bot/office IPs that were already relied on. Only inserts
# missing rows; further changes go through the "Whitelist IP" page.
SEED_CF_WHITELIST_IPS = [
    "8.222.213.17",
    "104.253.193.165", "122.248.206.212", "139.59.224.39",
    "142.111.69.199", "159.192.43.132", "139.59.227.174",
    "166.88.119.110", "166.88.119.210", "166.88.119.211",
    "166.88.119.214", "166.88.119.249", "166.88.119.250",
    "166.88.119.251", "171.233.128.13", "192.168.1.5",
    "192.168.1.70", "192.177.66.44", "192.177.68.187",
    "192.177.68.225", "192.177.68.226", "192.177.68.35",
    "192.177.68.48", "192.177.71.1", "192.177.71.113",
    "192.177.71.221", "192.177.71.222", "192.177.71.61",
    "192.177.71.78", "192.177.85.79",
    "23.230.31.115", "3.90.129.137", "54.254.237.225",
]


def seed_cf_whitelist_ips(db: Session) -> None:
    existing = {r.ip for r in db.execute(select(CfWhitelistIp)).scalars().all()}
    for ip in SEED_CF_WHITELIST_IPS:
        if ip not in existing:
            db.add(CfWhitelistIp(
                label="", ip=ip, is_active=True,
                note="Migrated từ WHITELIST_IPS hardcode", created_at=datetime.now(timezone.utc),
            ))
    db.commit()


def get_active_whitelist_ips(db: Session) -> list[str]:
    rows = db.execute(
        select(CfWhitelistIp.ip).where(CfWhitelistIp.is_active.is_(True))
    ).scalars().all()
    return list(rows)
