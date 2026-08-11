import uuid
from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from donext.models import (
    AcademicGradeStatus,
    AcademicItemType,
    AllocationMethod,
    AvailabilityType,
    EnergyLevel,
    Flexibility,
    GoalStatus,
    Intensity,
    Priority,
    ScheduleStatus,
    SchemeSelectionMode,
    SelectionRule,
    SemesterStatus,
    TaskStatus,
    WeightOrigin,
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
    academic_item_id: uuid.UUID | None = None
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
    academic_item_id: uuid.UUID | None = None
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


class AssessmentGroupInput(ApiModel):
    key: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    parent_key: str | None = Field(default=None, max_length=80)
    name: str = Field(min_length=1, max_length=160)
    allocation_method: AllocationMethod = AllocationMethod.equal
    relative_weight_percent: float | None = Field(default=None, ge=0, le=100)
    weight_origin: WeightOrigin = WeightOrigin.unknown
    extraction_confidence: float = Field(default=1, ge=0, le=1)
    source_text: str | None = Field(default=None, max_length=2000)


class AcademicItemInput(ApiModel):
    key: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    group_key: str | None = Field(default=None, max_length=80)
    item_type: AcademicItemType = AcademicItemType.other
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    due_at: datetime | None = None
    direct_weight_percent: float | None = Field(default=None, ge=0, le=100)
    relative_weight_percent: float | None = Field(default=None, ge=0, le=100)
    points_possible: float | None = Field(default=None, gt=0)
    points_earned: float | None = Field(default=None, ge=0)
    grade_status: AcademicGradeStatus = AcademicGradeStatus.ungraded
    weight_origin: WeightOrigin = WeightOrigin.unknown
    extraction_confidence: float = Field(default=1, ge=0, le=1)
    minimum_required_percent: float | None = Field(default=None, ge=0, le=100)
    extra_credit: bool = False
    source_text: str | None = Field(default=None, max_length=2000)
    source_references: list[str] = Field(default_factory=list, max_length=20)
    estimated_minutes: int = Field(default=180, ge=15, le=10080)

    @model_validator(mode="after")
    def validate_grade(self) -> "AcademicItemInput":
        if self.points_earned is not None and self.points_possible is None:
            raise ValueError("points_possible is required when points_earned is set")
        return self


class GradingSchemeComponentInput(ApiModel):
    target_group_key: str | None = Field(default=None, max_length=80)
    target_item_key: str | None = Field(default=None, max_length=80)
    weight_percent: float = Field(ge=0, le=100)
    selection_rule: SelectionRule = SelectionRule.all
    selection_count: int | None = Field(default=None, ge=1, le=1000)
    is_extra_credit: bool = False
    minimum_required_percent: float | None = Field(default=None, ge=0, le=100)

    @model_validator(mode="after")
    def validate_target_and_selection(self) -> "GradingSchemeComponentInput":
        if (self.target_group_key is None) == (self.target_item_key is None):
            raise ValueError("exactly one grading component target is required")
        if self.selection_rule in {SelectionRule.best_n, SelectionRule.drop_lowest_n}:
            if self.selection_count is None:
                raise ValueError("selection_count is required for best/drop rules")
        elif self.selection_count is not None:
            raise ValueError("selection_count is only valid for best/drop rules")
        return self


class GradingSchemeInput(ApiModel):
    key: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=160)
    selection_mode: SchemeSelectionMode = SchemeSelectionMode.fixed
    is_primary: bool = False
    is_complete: bool = False
    components: list[GradingSchemeComponentInput] = Field(default_factory=list, max_length=200)


class CourseGradingReplace(ApiModel):
    current_grade: float | None = Field(default=None, ge=0, le=100)
    target_grade: float | None = Field(default=None, ge=0, le=100)
    groups: list[AssessmentGroupInput] = Field(default_factory=list, max_length=200)
    items: list[AcademicItemInput] = Field(default_factory=list, max_length=500)
    schemes: list[GradingSchemeInput] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def validate_references(self) -> "CourseGradingReplace":
        group_keys = [group.key for group in self.groups]
        item_keys = [item.key for item in self.items]
        scheme_keys = [scheme.key for scheme in self.schemes]
        if len(group_keys) != len(set(group_keys)):
            raise ValueError("assessment group keys must be unique")
        if len(item_keys) != len(set(item_keys)):
            raise ValueError("academic item keys must be unique")
        if len(scheme_keys) != len(set(scheme_keys)):
            raise ValueError("grading scheme keys must be unique")
        group_key_set = set(group_keys)
        item_key_set = set(item_keys)
        for group in self.groups:
            if group.parent_key and group.parent_key not in group_key_set:
                raise ValueError(f"unknown parent group: {group.parent_key}")
            if group.parent_key == group.key:
                raise ValueError("an assessment group cannot be its own parent")
        for item in self.items:
            if item.group_key and item.group_key not in group_key_set:
                raise ValueError(f"unknown item group: {item.group_key}")
        for scheme in self.schemes:
            for component in scheme.components:
                if component.target_group_key not in group_key_set and component.target_group_key:
                    raise ValueError(f"unknown component group: {component.target_group_key}")
                if component.target_item_key not in item_key_set and component.target_item_key:
                    raise ValueError(f"unknown component item: {component.target_item_key}")
        return self


class AssessmentGroupRead(ApiModel):
    id: uuid.UUID
    parent_group_id: uuid.UUID | None
    name: str
    allocation_method: AllocationMethod
    relative_weight_percent: float | None
    weight_origin: WeightOrigin
    extraction_confidence: float
    source_text: str | None


class AcademicItemRead(ApiModel):
    id: uuid.UUID
    course_id: uuid.UUID
    assessment_group_id: uuid.UUID | None
    task_id: uuid.UUID | None = None
    item_type: AcademicItemType
    name: str
    description: str | None
    due_at: datetime | None
    direct_weight_percent: float | None
    relative_weight_percent: float | None
    points_possible: float | None
    points_earned: float | None
    grade_status: AcademicGradeStatus
    weight_origin: WeightOrigin
    extraction_confidence: float
    minimum_required_percent: float | None
    extra_credit: bool
    source_text: str | None
    source_references: list[str]


class GradingSchemeComponentRead(ApiModel):
    id: uuid.UUID
    assessment_group_id: uuid.UUID | None
    academic_item_id: uuid.UUID | None
    weight_percent: float
    selection_rule: SelectionRule
    selection_count: int | None
    is_extra_credit: bool
    minimum_required_percent: float | None


class GradingSchemeRead(ApiModel):
    id: uuid.UUID
    name: str
    selection_mode: SchemeSelectionMode
    is_primary: bool
    is_complete: bool
    components: list[GradingSchemeComponentRead]


class CourseGradingRead(ApiModel):
    course: CourseRead
    groups: list[AssessmentGroupRead]
    items: list[AcademicItemRead]
    schemes: list[GradingSchemeRead]
    warnings: list[str]


class AcademicItemUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    due_at: datetime | None = None
    direct_weight_percent: float | None = Field(default=None, ge=0, le=100)
    relative_weight_percent: float | None = Field(default=None, ge=0, le=100)
    points_possible: float | None = Field(default=None, gt=0)
    points_earned: float | None = Field(default=None, ge=0)
    grade_status: AcademicGradeStatus | None = None
    weight_origin: WeightOrigin | None = None
    minimum_required_percent: float | None = Field(default=None, ge=0, le=100)
    extra_credit: bool | None = None


AcademicImpactTier = Literal["critical", "high", "normal", "low"]


class AcademicImpactReason(ApiModel):
    code: str
    label: str


class AcademicImpactRead(ApiModel):
    academic_item_id: uuid.UUID
    task_id: uuid.UUID | None
    tier: AcademicImpactTier
    effective_weight_percent: float
    minimum_weight_percent: float
    maximum_weight_percent: float
    weight_origin: WeightOrigin
    blocking_rule: str | None
    reasons: list[AcademicImpactReason]


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


class CourseOutlineImport(ApiModel):
    course: CourseCreate
    grading: CourseGradingReplace
    meetings: list[FixedEventCreate] = Field(default_factory=list, max_length=30)
    replace_existing: bool = False


class CourseOutlineImportRead(ApiModel):
    course: CourseRead
    updated_existing: bool
    meetings_created: int


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


ScheduleBlockType = Literal["focus", "commitment", "goal", "break", "personal"]


class ScheduleBlockCreate(ApiModel):
    title: str = Field(min_length=1, max_length=200)
    task_id: uuid.UUID | None = None
    fixed_event_id: uuid.UUID | None = None
    goal_id: uuid.UUID | None = None
    start_at: datetime
    end_at: datetime
    block_type: ScheduleBlockType = "focus"
    locked: bool = False

    @model_validator(mode="after")
    def validate_block(self) -> "ScheduleBlockCreate":
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        if self.start_at.tzinfo is None or self.end_at.tzinfo is None:
            raise ValueError("schedule block timestamps must include a timezone")
        links = (self.task_id, self.fixed_event_id, self.goal_id)
        if sum(value is not None for value in links) > 1:
            raise ValueError("a schedule block can link to only one resource")
        return self


class ScheduleBlockUpdate(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    task_id: uuid.UUID | None = None
    fixed_event_id: uuid.UUID | None = None
    goal_id: uuid.UUID | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    block_type: ScheduleBlockType | None = None
    locked: bool | None = None


class ScheduleBlockRead(ApiModel):
    id: uuid.UUID
    schedule_version_id: uuid.UUID
    title: str
    task_id: uuid.UUID | None
    fixed_event_id: uuid.UUID | None
    goal_id: uuid.UUID | None
    start_at: datetime
    end_at: datetime
    block_type: str
    locked: bool
    source: str
    stability_weight: float
    created_at: datetime
    updated_at: datetime


class ScheduleRead(ApiModel):
    id: uuid.UUID
    semester_id: uuid.UUID
    version_number: int
    reason: str
    status: ScheduleStatus
    accepted_at: datetime | None
    blocks: list[ScheduleBlockRead]
    created_at: datetime
    updated_at: datetime


class OutlineCourseProposal(ApiModel):
    code: str | None = None
    name: str | None = None
    instructor: str | None = None
    confidence: float = Field(ge=0, le=1)


OutlineItemKind = Literal["assignment", "exam", "quiz", "project", "paper", "lab", "other"]
OutlineDocumentType = Literal["course_outline", "course_schedule", "lecture_material", "unknown"]


class OutlineItemProposal(ApiModel):
    key: str | None = None
    group_key: str | None = None
    name: str
    kind: OutlineItemKind
    deadline_at: datetime | None = None
    weight_percent: float | None = Field(default=None, ge=0, le=100)
    relative_weight_percent: float | None = Field(default=None, ge=0, le=100)
    points_possible: float | None = Field(default=None, gt=0)
    weight_origin: WeightOrigin = WeightOrigin.unknown
    minimum_required_percent: float | None = Field(default=None, ge=0, le=100)
    extra_credit: bool = False
    estimated_minutes: int = Field(ge=15, le=10080)
    confidence: float = Field(ge=0, le=1)
    source_text: str


class OutlineMeetingProposal(ApiModel):
    title: str
    day_of_week: int = Field(ge=0, le=6)
    start_time: time
    end_time: time
    location: str | None = None
    confidence: float = Field(ge=0, le=1)
    source_text: str


class OutlineExtractionRead(ApiModel):
    file_name: str
    source_files: list[str] = Field(default_factory=list)
    document_types: list[OutlineDocumentType] = Field(default_factory=list)
    course: OutlineCourseProposal
    items: list[OutlineItemProposal]
    groups: list[AssessmentGroupInput] = Field(default_factory=list)
    schemes: list[GradingSchemeInput] = Field(default_factory=list)
    grading_evidence: list[str] = Field(default_factory=list)
    meetings: list[OutlineMeetingProposal]
    warnings: list[str]
