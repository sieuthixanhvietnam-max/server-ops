"""One-time data copy from the SQLite file this app used to run on into a
Postgres database whose schema has already been created (via
`Base.metadata.create_all()` - see database.py). No ORM relationships/FKs
exist in models.py, so table order doesn't matter for referential integrity;
copied in the order Base.metadata.sorted_tables returns for readability only.

Reads are done through a SQLAlchemy engine bound to the SQLite file (not raw
sqlite3) so each column's type decorator - notably UTCDateTime - runs its
process_result_value on the way out, same as the app's own reads. Passing
raw sqlite3 rows straight to Postgres would hand UTCDateTime's bind
processor a plain string instead of a datetime and crash.

Usage:
    DATABASE_URL=postgresql+psycopg2://user@localhost:5432/server_ops \
        python3 scripts/migrate_sqlite_to_postgres.py --sqlite-path server_ops.db
"""
import argparse

from sqlalchemy import create_engine, func, insert, select, text

from app import models  # noqa: F401 - registers every model on Base.metadata
from app.database import Base, engine as dst_engine


def migrate(sqlite_path: str) -> None:
    src_engine = create_engine(f"sqlite:///{sqlite_path}")

    with src_engine.connect() as src, dst_engine.begin() as dst:
        for table in Base.metadata.sorted_tables:
            rows = [dict(r._mapping) for r in src.execute(select(table)).fetchall()]
            if not rows:
                print(f"{table.name}: 0 rows (skipped)")
                continue

            dst.execute(insert(table), rows)

            if "id" in table.c:
                dst.execute(text(
                    f"SELECT setval(pg_get_serial_sequence('{table.name}', 'id'), "
                    f"(SELECT COALESCE(MAX(id), 1) FROM {table.name}))"
                ))

            src_count = len(rows)
            dst_count = dst.execute(select(func.count()).select_from(table)).scalar()
            status = "OK" if src_count == dst_count else "MISMATCH"
            print(f"{table.name}: {src_count} -> {dst_count} [{status}]")

    src_engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite-path", default="server_ops.db")
    args = parser.parse_args()
    migrate(args.sqlite_path)
