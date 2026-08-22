"""add schedule revision feedback

Revision ID: f2c8d1e4a907
Revises: e6a1c4d8f209
Create Date: 2026-08-22 15:35:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f2c8d1e4a907"
down_revision: str | Sequence[str] | None = "e6a1c4d8f209"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user_preferences", sa.Column("schedule_revision_policy", sa.JSON()))
    op.add_column("schedule_versions", sa.Column("revision_of_proposal_id", sa.Uuid()))
    op.add_column("schedule_versions", sa.Column("revision_feedback", sa.JSON()))
    op.create_foreign_key(
        "fk_schedule_versions_revision_of_proposal_id",
        "schedule_versions",
        "schedule_versions",
        ["revision_of_proposal_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_schedule_versions_revision_of_proposal_id",
        "schedule_versions",
        ["revision_of_proposal_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_schedule_versions_revision_of_proposal_id", table_name="schedule_versions")
    op.drop_constraint(
        "fk_schedule_versions_revision_of_proposal_id",
        "schedule_versions",
        type_="foreignkey",
    )
    op.drop_column("schedule_versions", "revision_feedback")
    op.drop_column("schedule_versions", "revision_of_proposal_id")
    op.drop_column("user_preferences", "schedule_revision_policy")
