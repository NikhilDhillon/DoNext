"""add flexible commitment scheduling

Revision ID: a31f2c8d9e07
Revises: c84e1a9b7d32
Create Date: 2026-08-21 11:15:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a31f2c8d9e07"
down_revision: str | Sequence[str] | None = "c84e1a9b7d32"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "goals",
        sa.Column(
            "planning_kind",
            sa.String(length=32),
            server_default="goal",
            nullable=False,
        ),
    )
    op.add_column("goals", sa.Column("schedule_rule", sa.JSON(), nullable=True))
    op.create_check_constraint(
        "ck_goal_planning_kind",
        "goals",
        "planning_kind IN ('goal', 'flexible_commitment')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_goal_planning_kind", "goals", type_="check")
    op.drop_column("goals", "schedule_rule")
    op.drop_column("goals", "planning_kind")
