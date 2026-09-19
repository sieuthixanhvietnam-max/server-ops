import logging
from collections import defaultdict
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Domain, DomainChangeLog, Server, SyncLog

logger = logging.getLogger("sync_service")

# The sync source sends "updated" as a plain "YYYY-MM-DD HH:mm[:ss]" string
# with no timezone marker - empirically it's UTC (matches wall-clock UTC at
# fetch time), so it's parsed and tagged UTC here rather than stored as a
# naive/ambiguous string, same reasoning as the UTCDateTime fix applied to
# every other timestamp in this app. Falls back to None (rather than raising)
# on anything that doesn't match, since this is a third-party field we don't
# control the format of.
def _parse_source_updated(raw: str) -> datetime | None:
    if not raw:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    logger.warning("Sync payload: unparseable 'updated' timestamp %r", raw)
    return None


async def fetch_sync_payload() -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            settings.sync_api_url,
            headers={"X-API-Key": settings.sync_api_key},
        )
        response.raise_for_status()
        return response.json()


def _diff_and_log_domains(
    db: Session,
    deduped: dict[tuple[str, str], dict],
    detected_at: datetime,
    server_names_in_payload: set[str],
) -> set[str]:
    """Returns the set of server_names whose domains were skipped this cycle
    (kept untouched, not diffed) because the payload reported 0 domains for
    a server that had some last sync AND that server is still listed in the
    servers payload (still alive, just a scan gap this cycle).

    A server that also disappeared from the servers payload - not just its
    domain count - is a confirmed decommission, not a scan gap: a server
    that's merely unreachable for the domain scan still normally stays
    listed as a known server in inventory. That case is deliberately NOT
    added to the returned set, so its stale domains fall through to the
    normal diff below and get purged + logged like any other real removal
    (this is the follow-through for the "let the next one confirm" comment
    below - confirmed via a live check on production 2026-09-19: source
    servers gcp-bearvinarm-dts-01/gcp-sop-dts-01 were deleted on GCP after
    a migrate job, dropped out of the servers payload immediately, but
    their 59+28 old domain rows were still sitting in the domains table
    with no purge path at all before this fix)."""
    existing = db.query(
        Domain.domain, Domain.server_name, Domain.provider, Domain.profile
    ).all()
    existing_keys = {(row.domain, row.server_name) for row in existing}
    existing_by_key = {(row.domain, row.server_name): row for row in existing}

    if not existing_keys:
        # First sync ever (or DB was empty) - nothing to diff against, so
        # logging every domain as "added" would just be bootstrap noise.
        return set()

    # A server that had >=1 domain last sync but reports exactly 0 this
    # cycle almost always means the sync source failed to enumerate it (e.g.
    # the server was mid-downtime when the source tried to scan it), not
    # that every single domain on it was actually deleted at once. Confirmed
    # in production 2026-08-19: ali-cos-martechs-g-brands dropped from 42
    # domains to 0 in one cycle (08:37) while it was unreachable over SSH,
    # then came back with the exact same 42 domains re-added at 10:07 -
    # pure flapping, logged as a false removed+added pair for every domain.
    old_server_names = {server_name for _, server_name in existing_keys}
    new_domain_counts = defaultdict(int)
    for _, server_name in deduped:
        new_domain_counts[server_name] += 1
    zero_report_server_names = {s for s in old_server_names if new_domain_counts.get(s, 0) == 0}
    decommissioned_server_names = {
        s for s in zero_report_server_names if s not in server_names_in_payload
    }
    stale_server_names = zero_report_server_names - decommissioned_server_names

    if stale_server_names:
        logger.warning(
            "Sync payload: server(s) %s reported 0 domains this cycle (had domains "
            "before) but are still listed as known servers - treating as a scan gap, "
            "not a real deletion; keeping their existing domain rows untouched",
            sorted(stale_server_names),
        )
    if decommissioned_server_names:
        logger.warning(
            "Sync payload: server(s) %s reported 0 domains AND dropped out of the "
            "servers payload entirely - treating as a confirmed decommission; purging "
            "their existing domain rows",
            sorted(decommissioned_server_names),
        )

    existing_keys_for_diff = {(d, s) for d, s in existing_keys if s not in stale_server_names}
    new_keys = set(deduped.keys())

    removed_keys = existing_keys_for_diff - new_keys
    added_keys = new_keys - existing_keys_for_diff

    # A domain removed from exactly one server and added to exactly one
    # different server in the same sync cycle is a clean signal it moved
    # rather than got deleted + a coincidentally-identical domain appearing.
    # Anything less clear-cut (e.g. removed from 2 servers at once) is left
    # as plain removed/added rows - guessing a pairing there could mislead.
    removed_by_domain = defaultdict(list)
    for domain, server_name in removed_keys:
        removed_by_domain[domain].append(server_name)
    added_by_domain = defaultdict(list)
    for domain, server_name in added_keys:
        added_by_domain[domain].append(server_name)

    moved_domains = {
        domain
        for domain in set(removed_by_domain) & set(added_by_domain)
        if len(removed_by_domain[domain]) == 1 and len(added_by_domain[domain]) == 1
    }

    changes = []
    for domain, server_name in removed_keys:
        if domain in moved_domains:
            continue
        row = existing_by_key[(domain, server_name)]
        changes.append(
            DomainChangeLog(
                event_type="removed",
                domain=domain,
                server_name=server_name,
                provider=row.provider,
                profile=row.profile,
                detected_at=detected_at,
            )
        )
    for domain, server_name in added_keys:
        if domain in moved_domains:
            continue
        item = deduped[(domain, server_name)]
        changes.append(
            DomainChangeLog(
                event_type="added",
                domain=domain,
                server_name=server_name,
                provider=item.get("provider", ""),
                profile=item.get("profile", ""),
                detected_at=detected_at,
            )
        )
    for domain in moved_domains:
        from_server = removed_by_domain[domain][0]
        to_server = added_by_domain[domain][0]
        item = deduped[(domain, to_server)]
        changes.append(
            DomainChangeLog(
                event_type="moved",
                domain=domain,
                server_name=to_server,
                from_server_name=from_server,
                provider=item.get("provider", ""),
                profile=item.get("profile", ""),
                detected_at=detected_at,
            )
        )

    if changes:
        db.bulk_save_objects(changes)

    return stale_server_names


_DOMAIN_CONFLICT_FIELDS = ("profile", "provider", "server_ip", "updated")


def _replace_domains(
    db: Session,
    domains: list[dict],
    detected_at: datetime,
    server_names_in_payload: set[str],
) -> int:
    # Source data can list the same domain multiple times (e.g. shared across
    # servers, or exact duplicate rows) - dedupe on (domain, server_name),
    # last one wins. If the discarded copy actually disagrees on profile/
    # provider/server_ip/updated (not just a harmless exact repeat), that's a
    # real upstream data-quality issue - surface it instead of silently
    # dropping it.
    deduped: dict[tuple[str, str], dict] = {}
    for item in domains:
        key = (item["domain"], item.get("server_name", ""))
        prev = deduped.get(key)
        if prev is not None and any(prev.get(f) != item.get(f) for f in _DOMAIN_CONFLICT_FIELDS):
            logger.warning(
                "Sync payload: duplicate (domain, server_name)=%s with conflicting data - "
                "kept %s, discarded %s",
                key,
                {f: item.get(f) for f in _DOMAIN_CONFLICT_FIELDS},
                {f: prev.get(f) for f in _DOMAIN_CONFLICT_FIELDS},
            )
        deduped[key] = item

    stale_server_names = _diff_and_log_domains(db, deduped, detected_at, server_names_in_payload)

    # Domains belonging to a server flagged as "didn't report this cycle"
    # (see _diff_and_log_domains) are excluded from the usual full
    # delete+reinsert below, so their rows survive this sync untouched.
    preserved_count = 0
    delete_query = db.query(Domain)
    if stale_server_names:
        preserved_count = db.query(Domain).filter(Domain.server_name.in_(stale_server_names)).count()
        delete_query = delete_query.filter(~Domain.server_name.in_(stale_server_names))
    delete_query.delete(synchronize_session=False)

    db.bulk_save_objects(
        [
            Domain(
                domain=item["domain"],
                profile=item.get("profile", ""),
                provider=item.get("provider", ""),
                server_ip=item.get("server_ip", ""),
                server_name=item.get("server_name", ""),
                source_updated=_parse_source_updated(item.get("updated", "")),
            )
            for item in deduped.values()
        ]
    )
    return len(deduped) + preserved_count


def _replace_servers(db: Session, servers: list[dict]) -> int:
    deduped = {item["server_name"]: item for item in servers}

    db.query(Server).delete()
    db.bulk_save_objects(
        [
            Server(
                server_name=item["server_name"],
                ip=item.get("ip", ""),
                provider=item.get("provider", ""),
                profile=item.get("profile", ""),
                domains_count=item.get("domains_count", 0),
                source_updated=_parse_source_updated(item.get("updated", "")),
            )
            for item in deduped.values()
        ]
    )
    return len(deduped)


async def run_sync(db: Session) -> SyncLog:
    try:
        payload = await fetch_sync_payload()
        synced_at = datetime.now(timezone.utc)
        server_names_in_payload = {s["server_name"] for s in payload.get("servers", [])}
        domains_count = _replace_domains(
            db, payload.get("domains", []), synced_at, server_names_in_payload
        )
        servers_count = _replace_servers(db, payload.get("servers", []))
        log = SyncLog(
            synced_at=synced_at,
            total_domains=domains_count,
            total_servers=servers_count,
            success=True,
        )
        db.add(log)
        db.commit()
        return log
    except Exception as exc:
        db.rollback()
        logger.exception("Sync failed")
        log = SyncLog(
            synced_at=datetime.now(timezone.utc),
            total_domains=0,
            total_servers=0,
            success=False,
            error_message=str(exc),
        )
        db.add(log)
        db.commit()
        return log
