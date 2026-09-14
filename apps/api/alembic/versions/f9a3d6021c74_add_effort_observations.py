"""add effort observations

Revision ID: f9a3d6021c74
Revises: e4b17c9a2f50
Create Date: 2026-09-14 09:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f9a3d6021c74"
down_revision: str | Sequence[str] | None = "e4b17c9a2f50"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "effort_observations",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=True),
        sa.Column(
            "item_type",
            sa.Enum(
                "assignment",
                "project",
                "quiz",
                "midterm",
                "final_exam",
                "presentation",
                "reading",
                "lab",
                "other",
                name="academicitemtype",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("estimated_minutes", sa.Integer(), nullable=False),
        sa.Column(
            "estimate_origin",
            sa.Enum(
                "pending_exam",
                "system_default",
                "student_provided",
                "manual",
                name="estimateorigin",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("actual_minutes", sa.Integer(), nullable=True),
        sa.Column("completed_on", sa.Date(), nullable=True),
        sa.Column("excluded_reason", sa.String(length=32), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("estimated_minutes > 0", name="ck_effort_observation_estimated"),
        sa.CheckConstraint(
            "actual_minutes IS NULL OR actual_minutes >= 0",
            name="ck_effort_observation_actual",
        ),
        sa.CheckConstraint(
            "excluded_reason IS NULL OR excluded_reason IN "
            "('fallback_estimate', 'no_time_logged', 'not_checked_in')",
            name="ck_effort_observation_excluded_reason",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("task_id", name="uq_effort_observations_task_id"),
    )
    op.create_index(op.f("ix_effort_observations_user_id"), "effort_observations", ["user_id"])
    op.create_index(op.f("ix_effort_observations_task_id"), "effort_observations", ["task_id"])
    op.create_index(op.f("ix_effort_observations_course_id"), "effort_observations", ["course_id"])
    op.create_index(
        "ix_effort_observations_user_course_type",
        "effort_observations",
        ["user_id", "course_id", "item_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_effort_observations_user_course_type", table_name="effort_observations")
    op.drop_index(op.f("ix_effort_observations_course_id"), table_name="effort_observations")
    op.drop_index(op.f("ix_effort_observations_task_id"), table_name="effort_observations")
    op.drop_index(op.f("ix_effort_observations_user_id"), table_name="effort_observations")
    op.drop_table("effort_observations")
