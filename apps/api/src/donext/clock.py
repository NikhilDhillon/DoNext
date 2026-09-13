from datetime import UTC, datetime


def now() -> datetime:
    """The single source of "now" for planning and completion. Kept patchable in tests."""

    return datetime.now(UTC)
