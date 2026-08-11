"""add schedule proposal metadata

Revision ID: c84e1a9b7d32
Revises: 9d7c2a8f4b10
Create Date: 2026-08-11 10:45:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c84e1a9b7d32"
down_revision: str | Sequence[str] | None = "9d7c2a8f4b10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("schedule_versions", sa.Column("base_schedule_version_id", sa.Uuid()))
    op.add_column("schedule_versions", sa.Column("horizon_start", sa.Date()))
    op.add_column("schedule_versions", sa.Column("horizon_end", sa.Date()))
    op.add_column("schedule_versions", sa.Column("input_fingerprint", sa.String(length=64)))
    op.add_column("schedule_versions", sa.Column("generation_summary", sa.JSON()))
    op.create_foreign_key(
        "fk_schedule_versions_base_schedule_version_id",
        "schedule_versions",
        "schedule_versions",
        ["base_schedule_version_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_schedule_versions_base_schedule_version_id",
        "schedule_versions",
        ["base_schedule_version_id"],
    )
    op.add_column("scheduled_blocks", sa.Column("reason_code", sa.String(length=64)))
    op.add_column("scheduled_blocks", sa.Column("reason_details", sa.JSON()))


def downgrade() -> None:
    op.drop_column("scheduled_blocks", "reason_details")
    op.drop_column("scheduled_blocks", "reason_code")
    op.drop_index("ix_schedule_versions_base_schedule_version_id", table_name="schedule_versions")
    op.drop_constraint(
        "fk_schedule_versions_base_schedule_version_id",
        "schedule_versions",
        type_="foreignkey",
    )
    op.drop_column("schedule_versions", "generation_summary")
    op.drop_column("schedule_versions", "input_fingerprint")
    op.drop_column("schedule_versions", "horizon_end")
    op.drop_column("schedule_versions", "horizon_start")
    op.drop_column("schedule_versions", "base_schedule_version_id")
