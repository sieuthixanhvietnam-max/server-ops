from datetime import timezone

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


class UTCDateTime(TypeDecorator):
    """SQLite has no native timezone-aware timestamp type, so plain
    DateTime(timezone=True) silently returns a naive datetime on read even
    though every write site in this codebase uses datetime.now(timezone.utc).
    A naive value serializes to JSON without a 'Z'/offset suffix, which the
    frontend's dayjs then misreads as local time instead of UTC - this
    re-attaches tzinfo=UTC on read (and normalizes to UTC before stripping
    it back off for storage) so timestamps round-trip correctly."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value
