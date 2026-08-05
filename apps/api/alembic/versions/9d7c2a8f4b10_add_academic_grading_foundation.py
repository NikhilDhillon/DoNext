"""add academic grading foundation

Revision ID: 9d7c2a8f4b10
Revises: fd59b35b7ee2
Create Date: 2026-08-04 22:35:00
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "9d7c2a8f4b10"
down_revision: str | Sequence[str] | None = "fd59b35b7ee2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def timestamp_columns() -> list[sa.Column[object]]:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "assessment_groups",
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("parent_group_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column(
            "allocation_method",
            sa.Enum(
                "equal", "explicit_percent", "points", name="allocationmethod", native_enum=False
            ),
            nullable=False,
        ),
        sa.Column("relative_weight_percent", sa.Float(), nullable=True),
        sa.Column(
            "weight_origin",
            sa.Enum(
                "explicit",
                "inferred_equal",
                "calculated_from_points",
                "inherited_from_group",
                "manual",
                "unknown",
                name="weightorigin",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("extraction_confidence", sa.Float(), nullable=False),
        sa.Column("source_text", sa.Text(), nullable=True),
        *timestamp_columns(),
        sa.CheckConstraint(
            "relative_weight_percent IS NULL OR (relative_weight_percent >= 0 AND relative_weight_percent <= 100)",
            name="ck_assessment_group_relative_weight",
        ),
        sa.CheckConstraint(
            "extraction_confidence >= 0 AND extraction_confidence <= 1",
            name="ck_assessment_group_confidence",
        ),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_group_id"], ["assessment_groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("course_id", "name", name="uq_assessment_group_course_name"),
    )
    op.create_index("ix_assessment_groups_course_id", "assessment_groups", ["course_id"])
    op.create_index(
        "ix_assessment_groups_parent_group_id", "assessment_groups", ["parent_group_id"]
    )

    op.create_table(
        "academic_items",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("assessment_group_id", sa.Uuid(), nullable=True),
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
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("direct_weight_percent", sa.Float(), nullable=True),
        sa.Column("relative_weight_percent", sa.Float(), nullable=True),
        sa.Column("points_possible", sa.Float(), nullable=True),
        sa.Column("points_earned", sa.Float(), nullable=True),
        sa.Column(
            "grade_status",
            sa.Enum(
                "ungraded",
                "graded",
                "exempt",
                "missed",
                name="academicgradestatus",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "weight_origin",
            sa.Enum(
                "explicit",
                "inferred_equal",
                "calculated_from_points",
                "inherited_from_group",
                "manual",
                "unknown",
                name="weightorigin",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("extraction_confidence", sa.Float(), nullable=False),
        sa.Column("minimum_required_percent", sa.Float(), nullable=True),
        sa.Column("extra_credit", sa.Boolean(), nullable=False),
        sa.Column("source_text", sa.Text(), nullable=True),
        sa.Column("source_references", sa.Text(), nullable=True),
        *timestamp_columns(),
        sa.CheckConstraint(
            "direct_weight_percent IS NULL OR (direct_weight_percent >= 0 AND direct_weight_percent <= 100)",
            name="ck_academic_item_direct_weight",
        ),
        sa.CheckConstraint(
            "relative_weight_percent IS NULL OR (relative_weight_percent >= 0 AND relative_weight_percent <= 100)",
            name="ck_academic_item_relative_weight",
        ),
        sa.CheckConstraint("points_possible IS NULL OR points_possible > 0", name="ck_item_points"),
        sa.CheckConstraint("points_earned IS NULL OR points_earned >= 0", name="ck_item_earned"),
        sa.CheckConstraint(
            "points_earned IS NULL OR points_possible IS NULL OR points_earned <= points_possible",
            name="ck_item_earned_not_above_possible",
        ),
        sa.CheckConstraint(
            "minimum_required_percent IS NULL OR (minimum_required_percent >= 0 AND minimum_required_percent <= 100)",
            name="ck_item_minimum_required",
        ),
        sa.CheckConstraint(
            "extraction_confidence >= 0 AND extraction_confidence <= 1",
            name="ck_academic_item_confidence",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["assessment_group_id"], ["assessment_groups.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_academic_items_user_id", "academic_items", ["user_id"])
    op.create_index("ix_academic_items_course_id", "academic_items", ["course_id"])
    op.create_index(
        "ix_academic_items_assessment_group_id", "academic_items", ["assessment_group_id"]
    )
    op.create_index("ix_academic_items_course_due", "academic_items", ["course_id", "due_at"])

    op.create_table(
        "grading_schemes",
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column(
            "selection_mode",
            sa.Enum(
                "fixed",
                "best_outcome",
                "student_selected",
                name="schemeselectionmode",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        sa.Column("is_complete", sa.Boolean(), nullable=False),
        *timestamp_columns(),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("course_id", "name", name="uq_grading_scheme_course_name"),
    )
    op.create_index("ix_grading_schemes_course_id", "grading_schemes", ["course_id"])

    op.create_table(
        "grading_scheme_components",
        sa.Column("grading_scheme_id", sa.Uuid(), nullable=False),
        sa.Column("assessment_group_id", sa.Uuid(), nullable=True),
        sa.Column("academic_item_id", sa.Uuid(), nullable=True),
        sa.Column("weight_percent", sa.Float(), nullable=False),
        sa.Column(
            "selection_rule",
            sa.Enum(
                "all",
                "best_n",
                "drop_lowest_n",
                "highest_attempt",
                "latest_attempt",
                name="selectionrule",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("selection_count", sa.Integer(), nullable=True),
        sa.Column("is_extra_credit", sa.Boolean(), nullable=False),
        sa.Column("minimum_required_percent", sa.Float(), nullable=True),
        *timestamp_columns(),
        sa.CheckConstraint(
            "(assessment_group_id IS NOT NULL AND academic_item_id IS NULL) OR (assessment_group_id IS NULL AND academic_item_id IS NOT NULL)",
            name="ck_grading_component_one_target",
        ),
        sa.CheckConstraint(
            "weight_percent >= 0 AND weight_percent <= 100",
            name="ck_grading_component_weight",
        ),
        sa.CheckConstraint(
            "selection_count IS NULL OR selection_count > 0",
            name="ck_grading_component_selection_count",
        ),
        sa.CheckConstraint(
            "minimum_required_percent IS NULL OR (minimum_required_percent >= 0 AND minimum_required_percent <= 100)",
            name="ck_grading_component_minimum_required",
        ),
        sa.ForeignKeyConstraint(["grading_scheme_id"], ["grading_schemes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["assessment_group_id"], ["assessment_groups.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["academic_item_id"], ["academic_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_grading_scheme_components_grading_scheme_id",
        "grading_scheme_components",
        ["grading_scheme_id"],
    )
    op.create_index(
        "ix_grading_scheme_components_assessment_group_id",
        "grading_scheme_components",
        ["assessment_group_id"],
    )
    op.create_index(
        "ix_grading_scheme_components_academic_item_id",
        "grading_scheme_components",
        ["academic_item_id"],
    )

    op.add_column("tasks", sa.Column("academic_item_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_tasks_academic_item_id",
        "tasks",
        "academic_items",
        ["academic_item_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_tasks_academic_item_id", "tasks", ["academic_item_id"])

    # Existing task IDs are reused so the backfill is portable across PostgreSQL and SQLite.
    op.execute(
        sa.text(
            """
            INSERT INTO academic_items (
                id, user_id, course_id, item_type, name, description, due_at,
                grade_status, weight_origin, extraction_confidence, extra_credit,
                created_at, updated_at
            )
            SELECT
                id, user_id, course_id, 'other', name, description, deadline_at,
                'ungraded', 'unknown', 1.0, FALSE, created_at, updated_at
            FROM tasks
            WHERE course_id IS NOT NULL
            """
        )
    )
    op.execute(sa.text("UPDATE tasks SET academic_item_id = id WHERE course_id IS NOT NULL"))


def downgrade() -> None:
    op.drop_index("ix_tasks_academic_item_id", table_name="tasks")
    op.drop_constraint("fk_tasks_academic_item_id", "tasks", type_="foreignkey")
    op.drop_column("tasks", "academic_item_id")
    op.drop_table("grading_scheme_components")
    op.drop_table("grading_schemes")
    op.drop_table("academic_items")
    op.drop_table("assessment_groups")
