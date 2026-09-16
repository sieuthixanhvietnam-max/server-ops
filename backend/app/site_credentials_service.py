from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.crypto import encrypt_token
from app.models import SiteCredential


def persist_site_credentials(db: Session, results: list[dict], updated_by: str) -> None:
    """Auto-save admin username + new password after a change_wppass run -
    upserts per (domain, server_name), overwriting whatever was stored
    before (the just-set password IS the current one now). Only rows with
    status "OK" carry a real new_password - DRYRUN/FAIL rows are skipped, so
    a dry-run never touches the vault."""
    ok_rows = [r for r in results if r.get("status") == "OK" and r.get("new_password") and r.get("server_name")]
    if not ok_rows:
        return

    now = datetime.now(timezone.utc)
    for r in ok_rows:
        domain, server_name = r["domain"], r["server_name"]
        row = db.execute(
            select(SiteCredential).where(
                SiteCredential.domain == domain, SiteCredential.server_name == server_name
            )
        ).scalar_one_or_none()
        if row is None:
            row = SiteCredential(domain=domain, server_name=server_name)
            db.add(row)
        row.username = r.get("admin") or row.username or "-"
        row.password_encrypted = encrypt_token(r["new_password"])
        row.updated_at = now
        row.updated_by = updated_by
    db.commit()
