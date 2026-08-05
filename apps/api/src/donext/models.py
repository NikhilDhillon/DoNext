import uuid
from datetime import date, datetime, time
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from donext.database import Base


class SemesterStatus(StrEnum):
    planned = "planned"
    active = "active"
    completed = "completed"
    archived = "archived"


class TaskStatus(StrEnum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    skipped = "skipped"


class Priority(StrEnum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"
    optional = "optional"


class Flexibility(StrEnum):
    fixed = "fixed"
    low = "low"
    medium = "medium"
    high = "high"


class Intensity(StrEnum):
    deep = "deep"
    moderate = "moderate"
    light = "light"
    administrative = "administrative"
    passive = "passive"


class GoalStatus(StrEnum):
    active = "active"
    paused = "paused"
    completed = "completed"
    archived = "archived"


class AvailabilityType(StrEnum):
    available = "available"
    unavailable = "unavailable"
    preferred = "preferred"


class EnergyLevel(StrEnum):
    high = "high"
    medium = "medium"
    low = "low"


class ScheduleStatus(StrEnum):
    proposed = "proposed"
    accepted = "accepted"
    rejected = "rejected"
    superseded = "superseded"


class UuidTimestampMixin:
    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class User(UuidTimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    timezone: Mapped[str] = mapped_column(String(64), default="America/Vancouver")
    password_hash: Mapped[str] = mapped_column(String(255))
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    sessions: Mapped[list["AuthSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    preferences: Mapped["UserPreference | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan", uselist=False
    )


class AuthSession(UuidTimestampMixin, Base):
    __tablename__ = "auth_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    user: Mapped[User] = relationship(back_populates="sessions")


class UserPreference(UuidTimestampMixin, Base):
    __tablename__ = "user_preferences"
    __table_args__ = (
        CheckConstraint("minimum_sleep_minutes > 0", name="ck_preferences_minimum_sleep"),
        CheckConstraint(
            "preferred_sleep_minutes >= minimum_sleep_minutes",
            name="ck_preferences_preferred_sleep",
        ),
        CheckConstraint(
            "preserve_free_time_percent BETWEEN 0 AND 100",
            name="ck_preferences_buffer",
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )
    minimum_sleep_minutes: Mapped[int] = mapped_column(Integer, default=420)
    preferred_sleep_minutes: Mapped[int] = mapped_column(Integer, default=480)
    default_wake_time: Mapped[time] = mapped_column(Time, default=time(7, 0))
    default_sleep_time: Mapped[time] = mapped_column(Time, default=time(23, 0))
    maximum_daily_focus_minutes: Mapped[int] = mapped_column(Integer, default=480)
    preferred_session_minutes: Mapped[int] = mapped_column(Integer, default=50)
    minimum_break_minutes: Mapped[int] = mapped_column(Integer, default=10)
    freeze_window_minutes: Mapped[int] = mapped_column(Integer, default=240)
    preserve_free_time_percent: Mapped[int] = mapped_column(Integer, default=15)
    auto_apply_low_impact_changes: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped[User] = relationship(back_populates="preferences")


class Semester(UuidTimestampMixin, Base):
    __tablename__ = "semesters"
    __table_args__ = (
        CheckConstraint("end_date >= start_date", name="ck_semester_dates"),
        Index("ix_semesters_user_status", "user_id", "status"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    status: Mapped[SemesterStatus] = mapped_column(
        Enum(SemesterStatus, native_enum=False), default=SemesterStatus.planned
    )

    courses: Mapped[list["Course"]] = relationship(cascade="all, delete-orphan")


class Course(UuidTimestampMixin, Base):
    __tablename__ = "courses"
    __table_args__ = (
        CheckConstraint("difficulty BETWEEN 1 AND 5", name="ck_course_difficulty"),
        CheckConstraint("weekly_study_target_minutes >= 0", name="ck_course_study_target"),
        UniqueConstraint("semester_id", "code", name="uq_course_semester_code"),
    )

    semester_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("semesters.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160))
    code: Mapped[str] = mapped_column(String(32))
    instructor: Mapped[str | None] = mapped_column(String(120))
    credits: Mapped[float | None] = mapped_column(Float)
    current_grade: Mapped[float | None] = mapped_column(Float)
    target_grade: Mapped[float | None] = mapped_column(Float)
    difficulty: Mapped[int] = mapped_column(Integer, default=3)
    weekly_study_target_minutes: Mapped[int] = mapped_column(Integer, default=180)


class Goal(UuidTimestampMixin, Base):
    __tablename__ = "goals"
    __table_args__ = (
        CheckConstraint(
            "minimum_weekly_minutes <= preferred_weekly_minutes AND "
            "preferred_weekly_minutes <= maximum_weekly_minutes",
            name="ck_goal_weekly_effort",
        ),
        CheckConstraint(
            "minimum_session_minutes <= preferred_session_minutes AND "
            "preferred_session_minutes <= maximum_session_minutes",
            name="ck_goal_session_effort",
        ),
        CheckConstraint("target_date IS NULL OR target_date >= start_date", name="ck_goal_dates"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    semester_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("semesters.id", ondelete="SET NULL"), index=True
    )
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(64), default="personal")
    status: Mapped[GoalStatus] = mapped_column(
        Enum(GoalStatus, native_enum=False), default=GoalStatus.active
    )
    priority: Mapped[Priority] = mapped_column(
        Enum(Priority, native_enum=False), default=Priority.medium
    )
    start_date: Mapped[date] = mapped_column(Date)
    target_date: Mapped[date | None] = mapped_column(Date)
    target_description: Mapped[str | None] = mapped_column(Text)
    minimum_weekly_minutes: Mapped[int] = mapped_column(Integer, default=30)
    preferred_weekly_minutes: Mapped[int] = mapped_column(Integer, default=120)
    maximum_weekly_minutes: Mapped[int] = mapped_column(Integer, default=240)
    minimum_session_minutes: Mapped[int] = mapped_column(Integer, default=25)
    preferred_session_minutes: Mapped[int] = mapped_column(Integer, default=50)
    maximum_session_minutes: Mapped[int] = mapped_column(Integer, default=120)
    preferred_sessions_per_week: Mapped[int] = mapped_column(Integer, default=3)
    maintenance_weekly_minutes: Mapped[int] = mapped_column(Integer, default=25)
    reducible_during_busy_weeks: Mapped[bool] = mapped_column(Boolean, default=True)
    progress_type: Mapped[str | None] = mapped_column(String(64))
    current_progress: Mapped[float | None] = mapped_column(Float)
    target_progress: Mapped[float | None] = mapped_column(Float)


class Task(UuidTimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("estimated_minutes > 0", name="ck_task_estimated_minutes"),
        CheckConstraint("remaining_minutes >= 0", name="ck_task_remaining_minutes"),
        CheckConstraint(
            "minimum_session_minutes <= preferred_session_minutes AND "
            "preferred_session_minutes <= maximum_session_minutes",
            name="ck_task_session_effort",
        ),
        CheckConstraint(
            "deadline_at IS NULL OR earliest_start_at IS NULL OR deadline_at > earliest_start_at",
            name="ck_task_dates",
        ),
        Index("ix_tasks_user_deadline", "user_id", "deadline_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("courses.id", ondelete="SET NULL"), index=True
    )
    goal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("goals.id", ondelete="SET NULL"), index=True
    )
    parent_task_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus, native_enum=False), default=TaskStatus.pending
    )
    priority: Mapped[Priority] = mapped_column(
        Enum(Priority, native_enum=False), default=Priority.medium
    )
    flexibility: Mapped[Flexibility] = mapped_column(
        Enum(Flexibility, native_enum=False), default=Flexibility.medium
    )
    intensity: Mapped[Intensity] = mapped_column(
        Enum(Intensity, native_enum=False), default=Intensity.moderate
    )
    estimated_minutes: Mapped[int] = mapped_column(Integer)
    remaining_minutes: Mapped[int] = mapped_column(Integer)
    minimum_session_minutes: Mapped[int] = mapped_column(Integer, default=25)
    preferred_session_minutes: Mapped[int] = mapped_column(Integer, default=50)
    maximum_session_minutes: Mapped[int] = mapped_column(Integer, default=120)
    earliest_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deadline_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    required: Mapped[bool] = mapped_column(Boolean, default=True)


class FixedEvent(UuidTimestampMixin, Base):
    __tablename__ = "fixed_events"
    __table_args__ = (
        CheckConstraint("end_at > start_at", name="ck_event_times"),
        CheckConstraint(
            "commute_before_minutes >= 0 AND commute_after_minutes >= 0",
            name="ck_event_commute",
        ),
        Index("ix_events_user_start", "user_id", "start_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    semester_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("semesters.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(64), default="personal")
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    recurrence_rule: Mapped[str | None] = mapped_column(String(500))
    location: Mapped[str | None] = mapped_column(String(200))
    commute_before_minutes: Mapped[int] = mapped_column(Integer, default=0)
    commute_after_minutes: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(32), default="manual")
    locked: Mapped[bool] = mapped_column(Boolean, default=True)


class AvailabilityWindow(UuidTimestampMixin, Base):
    __tablename__ = "availability_windows"
    __table_args__ = (
        CheckConstraint("day_of_week BETWEEN 0 AND 6", name="ck_availability_day"),
        CheckConstraint("end_time > start_time", name="ck_availability_times"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    day_of_week: Mapped[int] = mapped_column(Integer)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    type: Mapped[AvailabilityType] = mapped_column(
        Enum(AvailabilityType, native_enum=False), default=AvailabilityType.available
    )
    energy_level: Mapped[EnergyLevel] = mapped_column(
        Enum(EnergyLevel, native_enum=False), default=EnergyLevel.medium
    )


class ScheduleVersion(UuidTimestampMixin, Base):
    __tablename__ = "schedule_versions"
    __table_args__ = (
        CheckConstraint("version_number > 0", name="ck_schedule_version_number"),
        UniqueConstraint("user_id", "version_number", name="uq_schedule_user_version"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    semester_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("semesters.id", ondelete="CASCADE"), index=True
    )
    version_number: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(200))
    status: Mapped[ScheduleStatus] = mapped_column(
        Enum(ScheduleStatus, native_enum=False), default=ScheduleStatus.proposed
    )
    objective_score: Mapped[float | None] = mapped_column(Float)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    blocks: Mapped[list["ScheduledBlock"]] = relationship(cascade="all, delete-orphan")


class ScheduledBlock(UuidTimestampMixin, Base):
    __tablename__ = "scheduled_blocks"
    __table_args__ = (
        CheckConstraint("end_at > start_at", name="ck_scheduled_block_times"),
        CheckConstraint("stability_weight >= 0", name="ck_scheduled_block_stability"),
        Index("ix_blocks_user_start", "user_id", "start_at"),
    )

    schedule_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("schedule_versions.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), index=True
    )
    fixed_event_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("fixed_events.id", ondelete="SET NULL"), index=True
    )
    goal_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("goals.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    block_type: Mapped[str] = mapped_column(String(32))
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(32), default="manual")
    stability_weight: Mapped[float] = mapped_column(Float, default=1.0)
