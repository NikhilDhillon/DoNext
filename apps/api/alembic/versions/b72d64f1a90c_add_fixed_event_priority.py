"""add fixed event priority

Revision ID: b72d64f1a90c
Revises: a31f2c8d9e07
Create Date: 2026-08-21 13:35:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b72d64f1a90c"
down_revision: str | Sequence[str] | None = "a31f2c8d9e07"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "fixed_events",
        sa.Column(
            "priority",
            sa.Enum(
                "critical",
                "high",
                "medium",
                "low",
                "optional",
                name="priority",
                native_enum=False,
            ),
            server_default="medium",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("fixed_events", "priority")
