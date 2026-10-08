from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Domain, Server
from app.ops.validation import is_valid_domain


def resolve_domain_server(
    db: Session, domain: str, server_name: str | None = None
) -> tuple[dict | None, str | None]:
    """Look up which server a domain is deployed on, from our synced
    inventory. Returns (None, error) if not found or ambiguous (found on
    more than one server) - we never guess which one to target for a
    destructive action. Pass server_name (from the caller, e.g. ClonePair.
    source_server) to disambiguate explicitly instead - common for a domain
    like a blank WP template deployed identically on every box, where
    "ambiguous" isn't a data problem, just a name that needs a server
    alongside it."""
    stmt = select(Domain).where(Domain.domain == domain)
    if server_name:
        stmt = stmt.where(Domain.server_name == server_name)
    rows = db.execute(stmt).scalars().all()
    if not rows:
        detail = f"domain not found on server {server_name!r}" if server_name else "domain not found in synced inventory"
        return None, detail
    if len(rows) > 1:
        servers = ", ".join(sorted({r.server_name for r in rows}))
        return None, f"ambiguous - found on {len(rows)} servers ({servers})"
    row = rows[0]
    return {"ip": row.server_ip, "profile": row.profile, "server_name": row.server_name}, None


def resolve_plugin_entries(db: Session, domains: list[str]) -> tuple[list[dict], list[str]]:
    entries, errors = [], []
    for d in domains:
        d = d.strip().lower()
        if not is_valid_domain(d):
            errors.append(f"{d}: invalid domain format")
            continue
        server, err = resolve_domain_server(db, d)
        if err:
            errors.append(f"{d}: {err}")
            continue
        entries.append({"domain": d, "ip": server["ip"], "profile": server["profile"]})
    return entries, errors


def resolve_destination_server(db: Session, server_name: str) -> Server | None:
    """Restore's destination doesn't go through resolve_domain_server - the
    domain being restored may no longer exist anywhere in the synced
    inventory (that's the whole point of a disaster-recovery restore), so
    the destination is a direct, explicit Server pick instead."""
    return db.execute(select(Server).where(Server.server_name == server_name)).scalar_one_or_none()
