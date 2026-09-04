"""add task activation

Revision ID: d3f7a2c65b81
Revises: 7b3d91e2a4c6
Create Date: 2026-09-04 10:20:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d3f7a2c65b81"
down_revision: str | Sequence[str] | None = "7b3d91e2a4c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Existing work was scheduled under the old course-readiness gate, so it is already part of
    # the student's plan. Deactivating it during an upgrade would silently empty their schedule;
    # they deactivate what has not been handed out yet from the intake surface instead. Exams
    # still awaiting a preparation estimate are the exception: the old gate refused to schedule
    # them too, so they stay unactivated and are prompted for like any other known deadline.
    op.execute(
        "UPDATE tasks SET activated_at = created_at "
        "WHERE activated_at IS NULL AND estimate_origin <> 'pending_exam'"
    )


def downgrade() -> None:
    op.drop_column("tasks", "activated_at")
