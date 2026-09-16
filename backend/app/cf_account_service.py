import asyncio
import json
import logging
from datetime import datetime, timezone

from app.config import settings
from app.crypto import decrypt_token
from app.database import SessionLocal
from app.models import CfAccount, CfZone
from app.ops import cf_ops

logger = logging.getLogger("cf_account_service")

# Held around every CF account/zone sync - manual (button click) or
# automatic (periodic loop) - so the two never run concurrently and double
# up Cloudflare API calls against the same accounts. asyncio.Lock is
# event-loop-only, so it must be acquired/released from async code around
# the asyncio.to_thread(...) call, never from inside the sync worker itself.
cf_sync_lock = asyncio.Lock()


def _label_of(account: CfAccount) -> str:
    return f"{account.label} ({account.email})" if account.email else account.label


def _fetch_zones(account: CfAccount) -> list[dict]:
    """Master-discovered accounts have no token of their own - they're
    synced with the shared settings.cf_api_token, filtered to just that
    account's zones via account.id. Manually-added accounts use their own
    decrypted token and see whatever zones that token has access to."""
    if account.source == "master":
        if not account.cf_account_id:
            raise RuntimeError("master account missing cf_account_id")
        return cf_ops.list_zones_for_account(settings.cf_api_token, account.cf_account_id)
    token = decrypt_token(account.api_token_encrypted)
    return cf_ops.list_all_zones(token)


def _replace_zones(db, account: CfAccount, zones: list[dict]) -> None:
    now = datetime.now(timezone.utc)
    db.query(CfZone).filter(CfZone.account_id == account.id).delete()
    db.bulk_save_objects(
        [
            CfZone(
                account_id=account.id,
                domain=z.get("name", ""),
                zone_id=z.get("id", ""),
                status=z.get("status", ""),
                plan=(z.get("plan") or {}).get("name", ""),
                nameservers=json.dumps(z.get("name_servers", []), ensure_ascii=False),
                created_on=z.get("created_on", "") or "",
                last_synced_at=now,
            )
            for z in zones
        ]
    )
    account.zone_count = len(zones)
    account.last_sync_status = "ok"
    account.last_sync_error = None
    account.last_synced_at = now
    db.commit()


def _sync_one(db, account: CfAccount, log) -> None:
    try:
        zones = _fetch_zones(account)
    except Exception as exc:
        account.last_sync_status = "error"
        account.last_sync_error = str(exc)[:500]
        account.last_synced_at = datetime.now(timezone.utc)
        db.commit()
        log(f"[fail] {_label_of(account)}: {exc}")
        return
    _replace_zones(db, account, zones)
    log(f"[ ok ] {_label_of(account)}: {len(zones)} zone(s)")


def sync_one_account(account_id: int, log) -> dict:
    db = SessionLocal()
    try:
        acc = db.get(CfAccount, account_id)
        if not acc:
            log(f"[fail] account id={account_id} not found")
            return {"status": "error", "note": "account not found"}
        _sync_one(db, acc, log)
        return {
            "label": acc.label, "email": acc.email, "status": acc.last_sync_status,
            "zone_count": acc.zone_count, "note": acc.last_sync_error or "",
        }
    finally:
        db.close()


def sync_all_accounts(log, source: str | None = None) -> list[dict]:
    db = SessionLocal()
    try:
        query = db.query(CfAccount).filter(CfAccount.is_active.is_(True))
        if source:
            query = query.filter(CfAccount.source == source)
        accounts = query.all()
        log(f"Syncing {len(accounts)} active Cloudflare account(s)...")
        results = []
        for acc in accounts:
            _sync_one(db, acc, log)
            results.append(
                {
                    "label": acc.label, "email": acc.email, "status": acc.last_sync_status,
                    "zone_count": acc.zone_count, "note": acc.last_sync_error or "",
                }
            )
        return results
    finally:
        db.close()


def discover_master_accounts(log) -> dict:
    """One-time (or repeatable) discovery pass: settings.cf_api_token is
    scoped to "All accounts" under the org's master Cloudflare login, so a
    single credential can enumerate every sub-account and its zones - no
    per-account token needed. Upserts CfAccount rows by cf_account_id, then
    syncs each one's zones immediately."""
    db = SessionLocal()
    try:
        if not settings.cf_api_token:
            log("[fail] CF_API_TOKEN không được cấu hình")
            return {"discovered": 0, "zones": 0}

        try:
            cf_accounts = cf_ops.list_accounts(settings.cf_api_token)
        except Exception as exc:
            log(f"[fail] không thể liệt kê account qua Master Token: {exc}")
            return {"discovered": 0, "zones": 0}

        log(f"Khám phá {len(cf_accounts)} account qua Master Token...")
        now = datetime.now(timezone.utc)
        total_zones = 0
        for a in cf_accounts:
            cf_account_id = a.get("id")
            name = a.get("name") or cf_account_id
            acc = db.query(CfAccount).filter(CfAccount.cf_account_id == cf_account_id).first()
            if acc:
                acc.label = name
                acc.source = "master"
            else:
                acc = CfAccount(
                    label=name,
                    email="",
                    cf_account_id=cf_account_id,
                    api_token_encrypted=None,
                    source="master",
                    is_active=True,
                    created_at=now,
                    last_sync_status="never",
                )
                db.add(acc)
                db.flush()
            db.commit()
            _sync_one(db, acc, log)
            total_zones += acc.zone_count
        return {"discovered": len(cf_accounts), "zones": total_zones}
    finally:
        db.close()
