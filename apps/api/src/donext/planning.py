import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from donext.errors import ApiError
from donext.models import (
    AcademicItem,
    AvailabilityType,
    AvailabilityWindow,
    Course,
    FixedEvent,
    Goal,
    ScheduledBlock,
    ScheduleStatus,
    ScheduleVersion,
    Semester,
    Task,
    TaskStatus,
    User,
    UserPreference,
)
from donext.schemas import (
    PlanningCapacityRead,
    PlanningDayRead,
    PlanningEntryRead,
    PlanningTaskRead,
    PlanningViewRead,
    SemesterDeadlineRead,
    SemesterPlanningRead,
    SemesterRead,
    SemesterRisk,
    SemesterWeekRead,
)

WEEKDAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
Interval = tuple[datetime, datetime]


@dataclass(frozen=True)
class EventOccurrence:
    event: FixedEvent
    start_at: datetime
    end_at: datetime


def resolve_timezone(value: str) -> ZoneInfo:
    try:
        return ZoneInfo(value)
    except ZoneInfoNotFoundError as error:
        raise ApiError("VALIDATION_ERROR", "The account timezone is not supported.", 422) from error


def aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def day_bounds(day: date, timezone: ZoneInfo) -> Interval:
    return (
        datetime.combine(day, time.min, tzinfo=timezone),
        datetime.combine(day + timedelta(days=1), time.min, tzinfo=timezone),
    )


def merge_intervals(intervals: list[Interval]) -> list[Interval]:
    merged: list[Interval] = []
    for start_at, end_at in sorted(intervals, key=lambda interval: interval[0]):
        if end_at <= start_at:
            continue
        if not merged or start_at > merged[-1][1]:
            merged.append((start_at, end_at))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end_at))
    return merged


def subtract_intervals(intervals: list[Interval], exclusions: list[Interval]) -> list[Interval]:
    remaining = merge_intervals(intervals)
    for excluded_start, excluded_end in merge_intervals(exclusions):
        next_remaining: list[Interval] = []
        for start_at, end_at in remaining:
            if excluded_end <= start_at or excluded_start >= end_at:
                next_remaining.append((start_at, end_at))
                continue
            if excluded_start > start_at:
                next_remaining.append((start_at, min(excluded_start, end_at)))
            if excluded_end < end_at:
                next_remaining.append((max(excluded_end, start_at), end_at))
        remaining = next_remaining
    return remaining


def interval_minutes(intervals: list[Interval]) -> int:
    return round(
        sum(
            (end_at.astimezone(UTC) - start_at.astimezone(UTC)).total_seconds()
            for start_at, end_at in intervals
        )
        / 60
    )


def clipped_interval(start_at: datetime, end_at: datetime, bounds: Interval) -> Interval | None:
    clipped_start = max(start_at, bounds[0])
    clipped_end = min(end_at, bounds[1])
    return (clipped_start, clipped_end) if clipped_end > clipped_start else None


def parse_weekly_rule(rule: str) -> tuple[set[int], datetime | None] | None:
    try:
        parts = dict(part.split("=", 1) for part in rule.split(";") if "=" in part)
        if parts.get("FREQ") != "WEEKLY" or not parts.get("BYDAY"):
            return None
        weekdays = {WEEKDAYS[value] for value in parts["BYDAY"].split(",")}
        until_text = parts.get("UNTIL")
        until = (
            datetime.strptime(until_text, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
            if until_text
            else None
        )
        return weekdays, until
    except (KeyError, ValueError):
        return None


def expand_events(
    events: list[FixedEvent],
    start_date: date,
    end_date: date,
    timezone: ZoneInfo,
) -> tuple[list[EventOccurrence], list[str]]:
    occurrences: list[EventOccurrence] = []
    warnings: list[str] = []
    range_start, _ = day_bounds(start_date, timezone)
    _, range_end = day_bounds(end_date - timedelta(days=1), timezone)
    for event in events:
        base_start = aware(event.start_at).astimezone(timezone)
        base_end = aware(event.end_at).astimezone(timezone)
        if not event.recurrence_rule:
            if base_start < range_end and base_end > range_start:
                occurrences.append(EventOccurrence(event, base_start, base_end))
            continue

        parsed = parse_weekly_rule(event.recurrence_rule)
        if parsed is None:
            warnings.append(f'Review the unsupported recurrence rule for "{event.title}".')
            if base_start < range_end and base_end > range_start:
                occurrences.append(EventOccurrence(event, base_start, base_end))
            continue

        weekdays, until = parsed
        wall_duration = base_end.replace(tzinfo=None) - base_start.replace(tzinfo=None)
        for offset in range((end_date - start_date).days):
            occurrence_date = start_date + timedelta(days=offset)
            if occurrence_date < base_start.date() or occurrence_date.weekday() not in weekdays:
                continue
            occurrence_start = datetime.combine(
                occurrence_date, base_start.timetz().replace(tzinfo=None), tzinfo=timezone
            )
            if until is not None and occurrence_start.astimezone(UTC) > until:
                continue
            occurrences.append(
                EventOccurrence(event, occurrence_start, occurrence_start + wall_duration)
            )
    return sorted(occurrences, key=lambda occurrence: occurrence.start_at), warnings


def availability_intervals(
    day: date, windows: list[AvailabilityWindow], timezone: ZoneInfo
) -> list[Interval]:
    positive: list[Interval] = []
    unavailable: list[Interval] = []
    for window in windows:
        if window.day_of_week != day.weekday():
            continue
        interval = (
            datetime.combine(day, window.start_time, tzinfo=timezone),
            datetime.combine(day, window.end_time, tzinfo=timezone),
        )
        if window.type == AvailabilityType.unavailable:
            unavailable.append(interval)
        else:
            positive.append(interval)
    return subtract_intervals(positive, unavailable)


def planner_entries(
    occurrences: list[EventOccurrence],
    blocks: list[ScheduledBlock],
    tasks: dict[uuid.UUID, Task],
    course_codes: dict[uuid.UUID, str],
    timezone: ZoneInfo,
) -> list[PlanningEntryRead]:
    entries: list[PlanningEntryRead] = []
    for occurrence in occurrences:
        event = occurrence.event
        entries.append(
            PlanningEntryRead(
                id=f"event:{event.id}:{occurrence.start_at.date().isoformat()}",
                kind="fixed_event",
                source_id=event.id,
                title=event.title,
                start_at=occurrence.start_at,
                end_at=occurrence.end_at,
                block_type="commitment",
                category=event.category,
                location=event.location,
                task_id=None,
                task_status=None,
                goal_id=None,
                course_code=None,
                locked=event.locked,
                recurring=event.recurrence_rule is not None,
                editable=False,
            )
        )
    for block in blocks:
        task = tasks.get(block.task_id) if block.task_id else None
        entries.append(
            PlanningEntryRead(
                id=f"block:{block.id}",
                kind="scheduled_block",
                source_id=block.id,
                title=block.title,
                start_at=aware(block.start_at).astimezone(timezone),
                end_at=aware(block.end_at).astimezone(timezone),
                block_type=block.block_type,
                category=block.block_type,
                location=None,
                task_id=block.task_id,
                task_status=task.status if task else None,
                goal_id=block.goal_id,
                course_code=course_codes.get(task.course_id) if task and task.course_id else None,
                locked=block.locked,
                recurring=False,
                editable=True,
            )
        )
    return sorted(entries, key=lambda entry: entry.start_at)


def build_planning_view(
    db: Session, user: User, start_date: date, end_date: date
) -> PlanningViewRead:
    timezone = resolve_timezone(user.timezone)
    range_start, _ = day_bounds(start_date, timezone)
    _, range_end = day_bounds(end_date - timedelta(days=1), timezone)
    events = list(db.scalars(select(FixedEvent).where(FixedEvent.user_id == user.id)))
    occurrences, warnings = expand_events(events, start_date, end_date, timezone)
    blocks = list(
        db.scalars(
            select(ScheduledBlock)
            .join(ScheduleVersion)
            .where(
                ScheduledBlock.user_id == user.id,
                ScheduleVersion.status == ScheduleStatus.accepted,
                ScheduledBlock.start_at < range_end.astimezone(UTC),
                ScheduledBlock.end_at > range_start.astimezone(UTC),
            )
            .order_by(ScheduledBlock.start_at)
        )
    )
    all_tasks = list(
        db.scalars(
            select(Task).where(
                Task.user_id == user.id,
                Task.status.in_((TaskStatus.pending, TaskStatus.in_progress)),
                Task.remaining_minutes > 0,
            )
        )
    )
    tasks = {task.id: task for task in all_tasks}
    courses = list(db.scalars(select(Course).join(Semester).where(Semester.user_id == user.id)))
    course_codes = {course.id: course.code for course in courses}
    goals = list(db.scalars(select(Goal).where(Goal.user_id == user.id)))
    goal_names = {goal.id: goal.name for goal in goals}
    entries = planner_entries(occurrences, blocks, tasks, course_codes, timezone)
    windows = list(
        db.scalars(select(AvailabilityWindow).where(AvailabilityWindow.user_id == user.id))
    )
    preferences = db.scalar(select(UserPreference).where(UserPreference.user_id == user.id))
    if preferences is None:
        preferences = UserPreference(user_id=user.id)
    if not windows:
        warnings.append("Add availability in Settings to calculate realistic focus capacity.")

    days: list[PlanningDayRead] = []
    for offset in range((end_date - start_date).days):
        current_date = start_date + timedelta(days=offset)
        bounds = day_bounds(current_date, timezone)
        available = availability_intervals(current_date, windows, timezone)
        commitment_intervals: list[Interval] = []
        for occurrence in occurrences:
            clipped = clipped_interval(
                occurrence.start_at - timedelta(minutes=occurrence.event.commute_before_minutes),
                occurrence.end_at + timedelta(minutes=occurrence.event.commute_after_minutes),
                bounds,
            )
            if clipped:
                commitment_intervals.append(clipped)
        for block in blocks:
            if block.block_type != "commitment":
                continue
            clipped = clipped_interval(
                aware(block.start_at).astimezone(timezone),
                aware(block.end_at).astimezone(timezone),
                bounds,
            )
            if clipped:
                commitment_intervals.append(clipped)
        focus_intervals: list[Interval] = []
        for block in blocks:
            if block.block_type not in {"focus", "goal"}:
                continue
            clipped = clipped_interval(
                aware(block.start_at).astimezone(timezone),
                aware(block.end_at).astimezone(timezone),
                bounds,
            )
            if clipped:
                focus_intervals.append(clipped)
        open_intervals = subtract_intervals(available, commitment_intervals)
        open_minutes = interval_minutes(open_intervals)
        protected_minutes = round(open_minutes * preferences.preserve_free_time_percent / 100)
        usable_minutes = max(open_minutes - protected_minutes, 0)
        planned_minutes = interval_minutes(merge_intervals(focus_intervals))
        days.append(
            PlanningDayRead(
                date=current_date,
                capacity=PlanningCapacityRead(
                    available_minutes=interval_minutes(available),
                    commitment_minutes=interval_minutes(merge_intervals(commitment_intervals)),
                    usable_focus_minutes=usable_minutes,
                    planned_focus_minutes=planned_minutes,
                    protected_free_minutes=protected_minutes,
                    remaining_focus_minutes=max(usable_minutes - planned_minutes, 0),
                    preferred_sleep_minutes=preferences.preferred_sleep_minutes,
                ),
            )
        )

    scheduled_task_ids = set(
        db.scalars(
            select(ScheduledBlock.task_id)
            .join(ScheduleVersion)
            .where(
                ScheduledBlock.user_id == user.id,
                ScheduledBlock.task_id.is_not(None),
                ScheduleVersion.status == ScheduleStatus.accepted,
            )
        )
    )
    unscheduled = [
        PlanningTaskRead(
            id=task.id,
            name=task.name,
            remaining_minutes=task.remaining_minutes,
            deadline_at=aware(task.deadline_at).astimezone(timezone) if task.deadline_at else None,
            priority=task.priority,
            intensity=task.intensity,
            course_code=course_codes.get(task.course_id) if task.course_id else None,
            goal_name=goal_names.get(task.goal_id) if task.goal_id else None,
        )
        for task in all_tasks
        if task.id not in scheduled_task_ids
    ]
    unscheduled.sort(
        key=lambda task: (
            task.deadline_at is None,
            task.deadline_at or datetime.max.replace(tzinfo=timezone),
            task.name,
        )
    )
    now = datetime.now(UTC)
    next_entry = next((entry for entry in entries if entry.end_at.astimezone(UTC) > now), None)
    return PlanningViewRead(
        start_date=start_date,
        end_date=end_date - timedelta(days=1),
        timezone=user.timezone,
        entries=entries,
        days=days,
        unscheduled_tasks=unscheduled,
        next_entry_id=next_entry.id if next_entry else None,
        warnings=list(dict.fromkeys(warnings)),
    )


def build_semester_view(db: Session, user: User, semester: Semester) -> SemesterPlanningRead:
    timezone = resolve_timezone(user.timezone)
    end_exclusive = semester.end_date + timedelta(days=1)
    planner = build_planning_view(db, user, semester.start_date, end_exclusive)
    courses = list(db.scalars(select(Course).where(Course.semester_id == semester.id)))
    course_codes = {course.id: course.code for course in courses}
    course_ids = list(course_codes)
    tasks = list(
        db.scalars(
            select(Task).where(
                Task.user_id == user.id,
                Task.status.in_((TaskStatus.pending, TaskStatus.in_progress)),
                Task.remaining_minutes > 0,
            )
        )
    )
    semester_tasks = [
        task
        for task in tasks
        if task.course_id in course_codes or (task.course_id is None and task.goal_id is not None)
    ]
    academic_items = (
        list(db.scalars(select(AcademicItem).where(AcademicItem.course_id.in_(course_ids))))
        if course_ids
        else []
    )
    task_by_academic_item = {
        task.academic_item_id: task for task in semester_tasks if task.academic_item_id is not None
    }
    deadlines: list[SemesterDeadlineRead] = []
    seen_task_ids: set[uuid.UUID] = set()
    for item in academic_items:
        if item.due_at is None:
            continue
        item_due_at = aware(item.due_at).astimezone(timezone)
        if not semester.start_date <= item_due_at.date() <= semester.end_date:
            continue
        task = task_by_academic_item.get(item.id)
        if task:
            seen_task_ids.add(task.id)
        deadlines.append(
            SemesterDeadlineRead(
                id=item.id,
                name=item.name,
                due_at=item_due_at,
                course_code=course_codes.get(item.course_id),
                remaining_minutes=task.remaining_minutes if task else None,
                weight_percent=item.direct_weight_percent,
            )
        )
    for task in semester_tasks:
        if task.deadline_at is None or task.id in seen_task_ids:
            continue
        task_due_at = aware(task.deadline_at).astimezone(timezone)
        if not semester.start_date <= task_due_at.date() <= semester.end_date:
            continue
        deadlines.append(
            SemesterDeadlineRead(
                id=task.id,
                name=task.name,
                due_at=task_due_at,
                course_code=course_codes.get(task.course_id) if task.course_id else None,
                remaining_minutes=task.remaining_minutes,
                weight_percent=None,
            )
        )
    deadlines.sort(key=lambda item: item.due_at)

    has_availability = any(day.capacity.available_minutes > 0 for day in planner.days)
    weeks: list[SemesterWeekRead] = []
    for index, week_start in enumerate(
        (
            semester.start_date + timedelta(days=offset)
            for offset in range(0, (end_exclusive - semester.start_date).days, 7)
        ),
        start=1,
    ):
        week_end = min(week_start + timedelta(days=6), semester.end_date)
        week_days = [day for day in planner.days if week_start <= day.date <= week_end]
        demand = sum(
            task.remaining_minutes
            for task in semester_tasks
            if task.deadline_at
            and week_start <= aware(task.deadline_at).astimezone(timezone).date() <= week_end
        )
        capacity = sum(day.capacity.usable_focus_minutes for day in week_days)
        commitments = sum(day.capacity.commitment_minutes for day in week_days)
        scheduled = sum(day.capacity.planned_focus_minutes for day in week_days)
        load_percent = round(demand / capacity * 100) if capacity > 0 else None
        risk: SemesterRisk
        if not has_availability:
            risk = "unknown"
        elif load_percent is None or load_percent > 100:
            risk = "high"
        elif load_percent > 75:
            risk = "medium"
        else:
            risk = "low"
        weeks.append(
            SemesterWeekRead(
                week_number=index,
                start_date=week_start,
                end_date=week_end,
                demand_minutes=demand,
                capacity_minutes=capacity,
                commitment_minutes=commitments,
                scheduled_minutes=scheduled,
                load_percent=load_percent,
                risk=risk,
            )
        )

    total_demand = sum(task.remaining_minutes for task in semester_tasks)
    total_capacity = sum(week.capacity_minutes for week in weeks)
    today = datetime.now(UTC).astimezone(timezone)
    upcoming = sum(1 for deadline in deadlines if deadline.due_at >= today)
    return SemesterPlanningRead(
        semester=SemesterRead.model_validate(semester),
        total_demand_minutes=total_demand,
        total_capacity_minutes=total_capacity,
        open_capacity_minutes=max(total_capacity - total_demand, 0),
        upcoming_deadlines=upcoming,
        incomplete_data=not has_availability
        or any(task.deadline_at is None for task in semester_tasks),
        weeks=weeks,
        deadlines=deadlines,
    )
