from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


_IS_SQLITE = settings.database_url.startswith("sqlite")
# UTCDateTime (db_types.py) stores naive UTC - DATETIME on SQLite,
# TIMESTAMP WITHOUT TIME ZONE on Postgres (its real production DB - this
# whole function used to silently no-op there, which is how a batch of new
# columns once made it into models.py without ever reaching the live table).
_TIMESTAMP_TYPE = "DATETIME" if _IS_SQLITE else "TIMESTAMP WITHOUT TIME ZONE"


def _existing_columns(conn, table: str) -> set[str]:
    if _IS_SQLITE:
        return {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
    rows = conn.execute(
        text("SELECT column_name FROM information_schema.columns WHERE table_name = :t"), {"t": table}
    )
    return {row[0] for row in rows}


def _add_column_if_missing(conn, table: str, column: str, coltype_sql: str) -> None:
    if column in _existing_columns(conn, table):
        return
    # Postgres supports IF NOT EXISTS directly; SQLite's ADD COLUMN doesn't,
    # hence the explicit existence check above covering both dialects.
    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {coltype_sql}"))
    conn.commit()


def _widen_to_numeric_if_needed(conn, table: str, column: str, precision: int, scale: int) -> None:
    """provider_costs.amount_vnd started as BIGINT (whole VNĐ assumed), then
    real entries turned out to carry cents (e.g. converted from a USD
    invoice) - BIGINT rejects any fractional part outright. SQLite has no
    rigid column typing (an INTEGER-affinity column already stores a REAL
    losslessly if the value doesn't fit as an integer), so this only matters
    for Postgres. Re-running the same ALTER TYPE on an already-NUMERIC
    column is a cheap no-op, so this doesn't need an existence guard like
    _add_column_if_missing."""
    if _IS_SQLITE:
        return
    conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE NUMERIC({precision},{scale})"))
    conn.commit()


def ensure_schema_migrations() -> None:
    """Base.metadata.create_all only creates missing tables - it never alters
    an existing one when a model gains a new column. Ad-hoc ALTER TABLE ADD
    COLUMN for each such case (no Alembic in this project), dialect-aware
    since production runs Postgres while local/dev may run SQLite."""
    with engine.connect() as conn:
        _add_column_if_missing(conn, "jobs", "created_ip", "VARCHAR DEFAULT ''")
        _add_column_if_missing(conn, "domain_change_logs", "from_server_name", "VARCHAR")
        _add_column_if_missing(conn, "servers", "last_health_status", "VARCHAR")
        _add_column_if_missing(conn, "servers", "last_health_note", "VARCHAR DEFAULT ''")
        _add_column_if_missing(conn, "servers", "last_health_checked_at", _TIMESTAMP_TYPE)
        _add_column_if_missing(conn, "changelog_entries", "change_type", "VARCHAR DEFAULT 'fix'")
        _add_column_if_missing(conn, "jobs", "fail_reason", "VARCHAR")
        _widen_to_numeric_if_needed(conn, "provider_costs", "amount_vnd", 18, 2)
        _add_column_if_missing(conn, "cf_firewall_templates", "skip_paths", "TEXT DEFAULT '[\"/wp-json/\"]'")
        _add_column_if_missing(conn, "cf_firewall_templates", "skip_verified_bot", "BOOLEAN DEFAULT TRUE")
        _add_column_if_missing(conn, "cf_firewall_templates", "skip_whitelist_ip", "BOOLEAN DEFAULT TRUE")
        _add_column_if_missing(conn, "cf_firewall_templates", "skip_asns", "TEXT DEFAULT '[\"15169\"]'")
        _add_column_if_missing(conn, "cf_firewall_templates", "allowed_ports", "TEXT DEFAULT '[\"80\", \"443\"]'")
        _add_column_if_missing(
            conn, "cf_firewall_templates", "allowed_ua_substrings", "TEXT DEFAULT '[\"mozilla\", \"opera\"]'"
        )
