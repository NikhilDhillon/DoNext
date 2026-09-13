"""add work sessions

Revision ID: e4b17c9a2f50
Revises: c1b8e5d47a63
Create Date: 2026-09-13 09:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4b17c9a2f50"
down_revision: str | Sequence[str] | None = "c1b8e5d47a63"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def timestamp_columns() -> list[sa.Column[object]]:
    return [
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
    ]


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "work_sessions",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        sa.Column("goal_id", sa.Uuid(), nullable=True),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=False),
        sa.Column(
            "outcome",
            sa.Enum(
                "finished", "still_going", "not_started", name="workoutcome", native_enum=False
            ),
            nullable=False,
        ),
        sa.Column(
            "source",
            sa.Enum("timer", "quick_confirm", "manual", name="worklogsource", native_enum=False),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("scheduled_block_id", sa.Uuid(), nullable=True),
        sa.Column("block_fingerprint", sa.String(length=64), nullable=True),
        *timestamp_columns(),
        sa.CheckConstraint("minutes BETWEEN 0 AND 1440", name="ck_work_session_minutes"),
        sa.CheckConstraint(
            "outcome <> 'not_started' OR minutes = 0",
            name="ck_work_session_not_started_zero",
        ),
        sa.CheckConstraint(
            "ended_at IS NULL OR started_at IS NULL OR ended_at > started_at",
            name="ck_work_session_times",
        ),
        sa.CheckConstraint(
            "(task_id IS NOT NULL AND goal_id IS NULL) OR "
            "(task_id IS NULL AND goal_id IS NOT NULL)",
            name="ck_work_session_one_target",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["goal_id"], ["goals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["scheduled_block_id"], ["scheduled_blocks.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "block_fingerprint", name="uq_work_session_fingerprint"),
    )
    op.create_index(op.f("ix_work_sessions_user_id"), "work_sessions", ["user_id"])
    op.create_index(op.f("ix_work_sessions_task_id"), "work_sessions", ["task_id"])
    op.create_index(op.f("ix_work_sessions_goal_id"), "work_sessions", ["goal_id"])
    op.create_index(
        op.f("ix_work_sessions_scheduled_block_id"), "work_sessions", ["scheduled_block_id"]
    )
    op.create_index("ix_work_sessions_user_date", "work_sessions", ["user_id", "local_date"])
    op.create_index("ix_work_sessions_task_date", "work_sessions", ["task_id", "local_date"])

    op.create_table(
        "work_timers",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scheduled_block_id", sa.Uuid(), nullable=True),
        sa.Column("block_fingerprint", sa.String(length=64), nullable=True),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["scheduled_block_id"], ["scheduled_blocks.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_work_timers_user_id"), "work_timers", ["user_id"], unique=True)
    op.create_index(op.f("ix_work_timers_task_id"), "work_timers", ["task_id"])
    op.create_index(
        op.f("ix_work_timers_scheduled_block_id"), "work_timers", ["scheduled_block_id"]
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_work_timers_scheduled_block_id"), table_name="work_timers")
    op.drop_index(op.f("ix_work_timers_task_id"), table_name="work_timers")
    op.drop_index(op.f("ix_work_timers_user_id"), table_name="work_timers")
    op.drop_table("work_timers")

    op.drop_index("ix_work_sessions_task_date", table_name="work_sessions")
    op.drop_index("ix_work_sessions_user_date", table_name="work_sessions")
    op.drop_index(op.f("ix_work_sessions_scheduled_block_id"), table_name="work_sessions")
    op.drop_index(op.f("ix_work_sessions_goal_id"), table_name="work_sessions")
    op.drop_index(op.f("ix_work_sessions_task_id"), table_name="work_sessions")
    op.drop_index(op.f("ix_work_sessions_user_id"), table_name="work_sessions")
    op.drop_table("work_sessions")
