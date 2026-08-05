import uuid
from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from donext.models import (
    AvailabilityType,
    EnergyLevel,
    Flexibility,
    GoalStatus,
    Intensity,
    Priority,
    SemesterStatus,
    TaskStatus,
)


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Message(ApiModel):
    message: str


class UserRegister(ApiModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    timezone: str = Field(default="America/Vancouver", min_length=1, max_length=64)


class UserLogin(ApiModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserRead(ApiModel):
    id: uuid.UUID
    email: EmailStr
    name: str
    timezone: str
    onboarding_completed_at: datetime | None
    created_at: datetime


class UserPreferenceBase(ApiModel):
    minimum_sleep_minutes: int = Field(default=420, ge=240, le=720)
    preferred_sleep_minutes: int = Field(default=480, ge=240, le=720)
    default_wake_time: time = time(7, 0)
    default_sleep_time: time = time(23, 0)
    maximum_daily_focus_minutes: int = Field(default=480, ge=30, le=960)
    preferred_session_minutes: int = Field(default=50, ge=10, le=240)
    minimum_break_minutes: int = Field(default=10, ge=5, le=120)
    freeze_window_minutes: int = Field(default=240, ge=0, le=1440)
    preserve_free_time_percent: int = Field(default=15, ge=0, le=100)
    auto_apply_low_impact_changes: bool = False

    @model_validator(mode="after")
    def validate_sleep(self) -> "UserPreferenceBase":
        if self.preferred_sleep_minutes < self.minimum_sleep_minutes:
            raise ValueError("preferred sleep must be at least the minimum sleep")
        return self


class UserPreferenceUpdate(ApiModel):
    minimum_sleep_minutes: int | None = Field(default=None, ge=240, le=720)
    preferred_sleep_minutes: int | None = Field(default=None, ge=240, le=720)
    default_wake_time: time | None = None
    default_sleep_time: time | None = None
    maximum_daily_focus_minutes: int | None = Field(default=None, ge=30, le=960)
    preferred_session_minutes: int | None = Field(default=None, ge=10, le=240)
    minimum_break_minutes: int | None = Field(default=None, ge=5, le=120)
    freeze_window_minutes: int | None = Field(default=None, ge=0, le=1440)
    preserve_free_time_percent: int | None = Field(default=None, ge=0, le=100)
    auto_apply_low_impact_changes: bool | None = None


class UserPreferenceRead(UserPreferenceBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class SemesterBase(ApiModel):
    name: str = Field(min_length=1, max_length=120)
    start_date: date
    end_date: date
    status: SemesterStatus = SemesterStatus.planned

    @model_validator(mode="after")
    def validate_dates(self) -> "SemesterBase":
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class SemesterCreate(SemesterBase):
    pass


class SemesterUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    start_date: date | None = None
    end_date: date | None = None
    status: SemesterStatus | None = None


class SemesterRead(SemesterBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class CourseBase(ApiModel):
    name: str = Field(min_length=1, max_length=160)
    code: str = Field(min_length=1, max_length=32)
    instructor: str | None = Field(default=None, max_length=120)
    credits: float | None = Field(default=None, gt=0, le=30)
    current_grade: float | None = Field(default=None, ge=0, le=100)
    target_grade: float | None = Field(default=None, ge=0, le=100)
    difficulty: int = Field(default=3, ge=1, le=5)
    weekly_study_target_minutes: int = Field(default=180, ge=0, le=10080)


class CourseCreate(CourseBase):
    pass


class CourseUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    code: str | None = Field(default=None, min_length=1, max_length=32)
    instructor: str | None = Field(default=None, max_length=120)
    credits: float | None = Field(default=None, gt=0, le=30)
    current_grade: float | None = Field(default=None, ge=0, le=100)
    target_grade: float | None = Field(default=None, ge=0, le=100)
    difficulty: int | None = Field(default=None, ge=1, le=5)
    weekly_study_target_minutes: int | None = Field(default=None, ge=0, le=10080)


class CourseRead(CourseBase):
    id: uuid.UUID
    semester_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class TaskBase(ApiModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    course_id: uuid.UUID | None = None
    goal_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None
    status: TaskStatus = TaskStatus.pending
    priority: Priority = Priority.medium
    flexibility: Flexibility = Flexibility.medium
    intensity: Intensity = Intensity.moderate
    estimated_minutes: int = Field(ge=1, le=100000)
    remaining_minutes: int | None = Field(default=None, ge=0, le=100000)
    minimum_session_minutes: int = Field(default=25, ge=5, le=480)
    preferred_session_minutes: int = Field(default=50, ge=5, le=480)
    maximum_session_minutes: int = Field(default=120, ge=5, le=720)
    earliest_start_at: datetime | None = None
    deadline_at: datetime | None = None
    required: bool = True

    @model_validator(mode="after")
    def validate_session_lengths(self) -> "TaskBase":
        if not (
            self.minimum_session_minutes
            <= self.preferred_session_minutes
            <= self.maximum_session_minutes
        ):
            raise ValueError("session lengths must be ordered minimum, preferred, maximum")
        if (
            self.earliest_start_at
            and self.deadline_at
            and self.deadline_at <= self.earliest_start_at
        ):
            raise ValueError("deadline_at must be after earliest_start_at")
        return self


class TaskCreate(TaskBase):
    pass


class TaskUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    course_id: uuid.UUID | None = None
    goal_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None
    status: TaskStatus | None = None
    priority: Priority | None = None
    flexibility: Flexibility | None = None
    intensity: Intensity | None = None
    estimated_minutes: int | None = Field(default=None, ge=1, le=100000)
    remaining_minutes: int | None = Field(default=None, ge=0, le=100000)
    minimum_session_minutes: int | None = Field(default=None, ge=5, le=480)
    preferred_session_minutes: int | None = Field(default=None, ge=5, le=480)
    maximum_session_minutes: int | None = Field(default=None, ge=5, le=720)
    earliest_start_at: datetime | None = None
    deadline_at: datetime | None = None
    required: bool | None = None


class TaskRead(TaskBase):
    id: uuid.UUID
    remaining_minutes: int
    created_at: datetime
    updated_at: datetime


class FixedEventBase(ApiModel):
    title: str = Field(min_length=1, max_length=200)
    semester_id: uuid.UUID | None = None
    category: str = Field(default="personal", min_length=1, max_length=64)
    start_at: datetime
    end_at: datetime
    recurrence_rule: str | None = Field(default=None, max_length=500)
    location: str | None = Field(default=None, max_length=200)
    commute_before_minutes: int = Field(default=0, ge=0, le=1440)
    commute_after_minutes: int = Field(default=0, ge=0, le=1440)
    locked: bool = True

    @model_validator(mode="after")
    def validate_times(self) -> "FixedEventBase":
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class FixedEventCreate(FixedEventBase):
    pass


class FixedEventUpdate(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    semester_id: uuid.UUID | None = None
    category: str | None = Field(default=None, min_length=1, max_length=64)
    start_at: datetime | None = None
    end_at: datetime | None = None
    recurrence_rule: str | None = Field(default=None, max_length=500)
    location: str | None = Field(default=None, max_length=200)
    commute_before_minutes: int | None = Field(default=None, ge=0, le=1440)
    commute_after_minutes: int | None = Field(default=None, ge=0, le=1440)
    locked: bool | None = None


class FixedEventRead(FixedEventBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class GoalBase(ApiModel):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None
    semester_id: uuid.UUID | None = None
    category: str = Field(default="personal", min_length=1, max_length=64)
    status: GoalStatus = GoalStatus.active
    priority: Priority = Priority.medium
    start_date: date
    target_date: date | None = None
    target_description: str | None = None
    minimum_weekly_minutes: int = Field(default=30, ge=0, le=10080)
    preferred_weekly_minutes: int = Field(default=120, ge=0, le=10080)
    maximum_weekly_minutes: int = Field(default=240, ge=0, le=10080)
    minimum_session_minutes: int = Field(default=25, ge=5, le=480)
    preferred_session_minutes: int = Field(default=50, ge=5, le=480)
    maximum_session_minutes: int = Field(default=120, ge=5, le=720)
    preferred_sessions_per_week: int = Field(default=3, ge=1, le=21)
    maintenance_weekly_minutes: int = Field(default=25, ge=0, le=10080)
    reducible_during_busy_weeks: bool = True
    progress_type: str | None = Field(default=None, max_length=64)
    current_progress: float | None = Field(default=None, ge=0)
    target_progress: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_effort(self) -> "GoalBase":
        if not (
            self.minimum_weekly_minutes
            <= self.preferred_weekly_minutes
            <= self.maximum_weekly_minutes
        ):
            raise ValueError("weekly effort must be ordered minimum, preferred, maximum")
        if not (
            self.minimum_session_minutes
            <= self.preferred_session_minutes
            <= self.maximum_session_minutes
        ):
            raise ValueError("session lengths must be ordered minimum, preferred, maximum")
        if self.target_date and self.target_date < self.start_date:
            raise ValueError("target_date must be on or after start_date")
        return self


class GoalCreate(GoalBase):
    pass


class GoalUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None
    semester_id: uuid.UUID | None = None
    category: str | None = Field(default=None, min_length=1, max_length=64)
    status: GoalStatus | None = None
    priority: Priority | None = None
    start_date: date | None = None
    target_date: date | None = None
    target_description: str | None = None
    minimum_weekly_minutes: int | None = Field(default=None, ge=0, le=10080)
    preferred_weekly_minutes: int | None = Field(default=None, ge=0, le=10080)
    maximum_weekly_minutes: int | None = Field(default=None, ge=0, le=10080)
    minimum_session_minutes: int | None = Field(default=None, ge=5, le=480)
    preferred_session_minutes: int | None = Field(default=None, ge=5, le=480)
    maximum_session_minutes: int | None = Field(default=None, ge=5, le=720)
    preferred_sessions_per_week: int | None = Field(default=None, ge=1, le=21)
    maintenance_weekly_minutes: int | None = Field(default=None, ge=0, le=10080)
    reducible_during_busy_weeks: bool | None = None
    progress_type: str | None = Field(default=None, max_length=64)
    current_progress: float | None = Field(default=None, ge=0)
    target_progress: float | None = Field(default=None, gt=0)


class GoalRead(GoalBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class AvailabilityInput(ApiModel):
    day_of_week: int = Field(ge=0, le=6)
    start_time: time
    end_time: time
    type: AvailabilityType = AvailabilityType.available
    energy_level: EnergyLevel = EnergyLevel.medium

    @model_validator(mode="after")
    def validate_times(self) -> "AvailabilityInput":
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class AvailabilityReplace(ApiModel):
    windows: list[AvailabilityInput] = Field(max_length=100)


class AvailabilityRead(AvailabilityInput):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
