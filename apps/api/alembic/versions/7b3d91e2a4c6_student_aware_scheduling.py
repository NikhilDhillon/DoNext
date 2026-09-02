"""student-aware scheduling contracts

Revision ID: 7b3d91e2a4c6
Revises: f2c8d1e4a907
Create Date: 2026-09-01 18:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "7b3d91e2a4c6"
down_revision: str | Sequence[str] | None = "f2c8d1e4a907"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "courses",
        sa.Column(
            "delivery_mode", sa.String(length=32), nullable=False, server_default="scheduled"
        ),
    )
    op.add_column("courses", sa.Column("first_content_available_at", sa.DateTime(timezone=True)))
    op.add_column("fixed_events", sa.Column("course_id", sa.Uuid()))
    op.add_column("fixed_events", sa.Column("meeting_kind", sa.String(length=32)))
    op.create_foreign_key(
        "fk_fixed_events_course_id",
        "fixed_events",
        "courses",
        ["course_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_fixed_events_course_id", "fixed_events", ["course_id"])
    op.add_column(
        "tasks",
        sa.Column("estimate_origin", sa.String(length=32), nullable=False, server_default="manual"),
    )

    # This is a pre-launch cutover: normalize active academic work to the agreed defaults.
    op.execute(
        """
        UPDATE tasks AS task
        SET estimated_minutes = CASE
                WHEN item.item_type = 'assignment' THEN 150
                WHEN item.item_type = 'quiz' THEN 120
                WHEN item.item_type IN ('midterm', 'final_exam') THEN 480
                ELSE task.estimated_minutes
            END,
            remaining_minutes = CASE
                WHEN item.item_type = 'assignment' THEN 150
                WHEN item.item_type = 'quiz' THEN 120
                WHEN item.item_type IN ('midterm', 'final_exam') THEN 480
                ELSE task.remaining_minutes
            END,
            estimate_origin = CASE
                WHEN item.item_type IN ('midterm', 'final_exam') THEN 'pending_exam'
                WHEN item.item_type IN ('assignment', 'quiz') THEN 'system_default'
                ELSE task.estimate_origin
            END
        FROM academic_items AS item
        WHERE task.academic_item_id = item.id
          AND task.status IN ('pending', 'in_progress')
        """
    )
    op.execute(
        """
        UPDATE fixed_events AS event
        SET meeting_kind = CASE
                WHEN lower(event.title) LIKE '%lab%' THEN 'lab'
                WHEN lower(event.title) LIKE '%tutorial%' THEN 'tutorial'
                WHEN lower(event.title) LIKE '%seminar%' THEN 'seminar'
                WHEN lower(event.title) LIKE '%studio%' THEN 'studio'
                ELSE 'lecture'
            END
        WHERE event.category = 'class'
        """
    )
    op.execute(
        """
        UPDATE fixed_events AS event
        SET course_id = course.id
        FROM courses AS course
        WHERE event.category = 'class'
          AND event.semester_id = course.semester_id
          AND lower(event.title) LIKE lower(course.code) || '%'
        """
    )
    op.create_check_constraint(
        "ck_course_async_content_time",
        "courses",
        "delivery_mode <> 'asynchronous' OR first_content_available_at IS NOT NULL",
    )
    op.create_check_constraint(
        "ck_event_class_association",
        "fixed_events",
        "category <> 'class' OR (course_id IS NOT NULL AND meeting_kind IS NOT NULL)",
    )

    op.drop_constraint("ck_preferences_preferred_sleep", "user_preferences", type_="check")
    op.drop_constraint("ck_preferences_buffer", "user_preferences", type_="check")
    op.drop_column("user_preferences", "preferred_sleep_minutes")
    op.drop_column("user_preferences", "preserve_free_time_percent")
    op.drop_column("user_preferences", "auto_apply_low_impact_changes")


def downgrade() -> None:
    op.drop_constraint("ck_event_class_association", "fixed_events", type_="check")
    op.drop_constraint("ck_course_async_content_time", "courses", type_="check")
    op.add_column(
        "user_preferences",
        sa.Column(
            "auto_apply_low_impact_changes", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "user_preferences",
        sa.Column("preserve_free_time_percent", sa.Integer(), nullable=False, server_default="15"),
    )
    op.add_column(
        "user_preferences",
        sa.Column("preferred_sleep_minutes", sa.Integer(), nullable=False, server_default="480"),
    )
    op.create_check_constraint(
        "ck_preferences_buffer",
        "user_preferences",
        "preserve_free_time_percent BETWEEN 0 AND 100",
    )
    op.create_check_constraint(
        "ck_preferences_preferred_sleep",
        "user_preferences",
        "preferred_sleep_minutes >= minimum_sleep_minutes",
    )
    op.drop_column("tasks", "estimate_origin")
    op.drop_index("ix_fixed_events_course_id", table_name="fixed_events")
    op.drop_constraint("fk_fixed_events_course_id", "fixed_events", type_="foreignkey")
    op.drop_column("fixed_events", "meeting_kind")
    op.drop_column("fixed_events", "course_id")
    op.drop_column("courses", "first_content_available_at")
    op.drop_column("courses", "delivery_mode")
