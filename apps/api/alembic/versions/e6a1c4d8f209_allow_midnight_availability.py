"""allow midnight availability

Revision ID: e6a1c4d8f209
Revises: b72d64f1a90c
Create Date: 2026-08-22 13:05:00
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e6a1c4d8f209"
down_revision: str | Sequence[str] | None = "b72d64f1a90c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_availability_times", "availability_windows", type_="check")
    op.create_check_constraint(
        "ck_availability_times",
        "availability_windows",
        "end_time > start_time OR end_time = TIME '00:00:00'",
    )


def downgrade() -> None:
    op.drop_constraint("ck_availability_times", "availability_windows", type_="check")
    op.create_check_constraint(
        "ck_availability_times",
        "availability_windows",
        "end_time > start_time",
    )
