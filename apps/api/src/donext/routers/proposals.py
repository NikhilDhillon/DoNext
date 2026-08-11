import hashlib
import json
import math
import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Protocol, cast
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from sqlalchemy import Table, func, select
from sqlalchemy.orm import selectinload

from donext.dependencies import CurrentUser, DbSession
from donext.errors import ApiError
from donext.models import (
    AvailabilityWindow,
    Course,
    FixedEvent,
    Goal,
    GoalStatus,
    ScheduledBlock,
    ScheduleStatus,
    ScheduleVersion,
    Semester,
    Task,
    TaskStatus,
    User,
    UserPreference,
)
from donext.planning import (
    EventOccurrence,
    Interval,
    availability_intervals,
    aware,
    expand_events,
    interval_minutes,
    resolve_timezone,
    subtract_intervals,
)
from donext.routers.schedules import validate_links, validate_times
from donext.routers.semesters import owned_semester
from donext.scheduler import SchedulingItem, SchedulingWindow, solve_schedule
from donext.schemas import (
    ProposalSummaryRead,
    ScheduleBlockCreate,
    ScheduleBlockRead,
    ScheduleBlockUpdate,
    ScheduleProposalRead,
)

router = APIRouter(tags=["schedule proposals"])
PRIORITY_RANK = {"optional": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}


class FingerprintRecord(Protocol):
    id: object
    updated_at: datetime
    __table__: Table


def current_proposal(
    db: DbSession, user_id: uuid.UUID, semester_id: uuid.UUID
) -> ScheduleVersion | None:
    return db.scalar(
        select(ScheduleVersion)
        .where(
            ScheduleVersion.user_id == user_id,
            ScheduleVersion.semester_id == semester_id,
            ScheduleVersion.status == ScheduleStatus.proposed,
        )
        .order_by(ScheduleVersion.version_number.desc())
        .options(selectinload(ScheduleVersion.blocks))
    )


def owned_proposal(db: DbSession, user_id: uuid.UUID, proposal_id: uuid.UUID) -> ScheduleVersion:
    proposal = db.scalar(
        select(ScheduleVersion)
        .where(ScheduleVersion.id == proposal_id, ScheduleVersion.user_id == user_id)
        .options(selectinload(ScheduleVersion.blocks))
    )
    if proposal is None or proposal.status != ScheduleStatus.proposed:
        raise ApiError("NOT_FOUND", "Schedule proposal not found.", 404)
    return proposal


def proposal_read(db: DbSession, user: User, proposal: ScheduleVersion) -> ScheduleProposalRead:
    summary = ProposalSummaryRead.model_validate(proposal.generation_summary or {})
    return ScheduleProposalRead(
        id=proposal.id,
        semester_id=proposal.semester_id,
        version_number=proposal.version_number,
        reason=proposal.reason,
        status=proposal.status,
        accepted_at=proposal.accepted_at,
        blocks=sorted(
            [ScheduleBlockRead.model_validate(block) for block in proposal.blocks],
            key=lambda block: block.start_at,
        ),
        created_at=proposal.created_at,
        updated_at=proposal.updated_at,
        base_schedule_version_id=proposal.base_schedule_version_id,
        horizon_start=proposal.horizon_start or date.min,
        horizon_end=proposal.horizon_end or date.min,
        stale=(
            proposal.status == ScheduleStatus.proposed
            and proposal.input_fingerprint != input_fingerprint(db, user, proposal.semester_id)
        ),
        generation_summary=summary,
    )


@router.post(
    "/semesters/{semester_id}/schedule/proposals",
    response_model=ScheduleProposalRead,
    status_code=201,
)
def generate_proposal(
    semester_id: uuid.UUID, db: DbSession, current_user: CurrentUser
) -> ScheduleProposalRead:
    semester = owned_semester(db, current_user.id, semester_id)
    timezone = resolve_timezone(current_user.timezone)
    today = datetime.now(UTC).astimezone(timezone).date()
    horizon_start = max(today, semester.start_date)
    horizon_end = min(horizon_start + timedelta(days=13), semester.end_date)
    if horizon_end < horizon_start:
        raise ApiError("SCHEDULER_INPUT_INCOMPLETE", "The semester has already ended.", 422)

    availability = list(
        db.scalars(select(AvailabilityWindow).where(AvailabilityWindow.user_id == current_user.id))
    )
    if not availability:
        raise ApiError(
            "SCHEDULER_INPUT_INCOMPLETE",
            "Add availability before generating a schedule proposal.",
            422,
        )
    preferences = db.scalar(
        select(UserPreference).where(UserPreference.user_id == current_user.id)
    ) or UserPreference(user_id=current_user.id)
    accepted = _accepted_schedule(db, current_user.id, semester_id)
    existing = current_proposal(db, current_user.id, semester_id)
    if existing:
        existing.status = ScheduleStatus.superseded

    latest_version = db.scalar(
        select(func.max(ScheduleVersion.version_number)).where(
            ScheduleVersion.user_id == current_user.id
        )
    )
    proposal = ScheduleVersion(
        user_id=current_user.id,
        semester_id=semester_id,
        base_schedule_version_id=accepted.id if accepted else None,
        version_number=(latest_version or 0) + 1,
        reason="Deterministic 14-day proposal",
        status=ScheduleStatus.proposed,
        horizon_start=horizon_start,
        horizon_end=horizon_end,
        input_fingerprint=input_fingerprint(db, current_user, semester_id),
    )
    db.add(proposal)
    db.flush()

    freeze_until = datetime.now(UTC) + timedelta(minutes=preferences.freeze_window_minutes)
    preserved = _copy_preserved_blocks(
        db, accepted, proposal, horizon_start, horizon_end, freeze_until
    )
    events = list(db.scalars(select(FixedEvent).where(FixedEvent.user_id == current_user.id)))
    occurrences, recurrence_warnings = expand_events(
        events, horizon_start, horizon_end + timedelta(days=1), timezone
    )
    if recurrence_warnings:
        db.rollback()
        raise ApiError("SCHEDULER_INPUT_INCOMPLETE", recurrence_warnings[0], 422)

    windows = _scheduling_windows(
        horizon_start,
        horizon_end,
        availability,
        occurrences,
        preserved,
        preferences,
        timezone,
    )
    items, item_links, warnings = _scheduling_items(
        db, current_user.id, semester, horizon_start, horizon_end, preserved
    )
    result = solve_schedule(items, windows, preferences.minimum_break_minutes)
    for placement in result.placements:
        task_id, goal_id = item_links[placement.item_id]
        db.add(
            ScheduledBlock(
                schedule_version_id=proposal.id,
                user_id=current_user.id,
                task_id=task_id,
                goal_id=goal_id,
                title=placement.title,
                start_at=placement.start_at,
                end_at=placement.end_at,
                block_type="goal" if goal_id else "focus",
                locked=False,
                source="generated",
                stability_weight=0.5,
                reason_code=placement.reason_code,
                reason_details=placement.reason_details,
            )
        )
    scheduled_total = sum(result.scheduled_minutes.values())
    unscheduled = [
        {
            "id": item.id,
            "name": item.title,
            "remaining_minutes": item.target_minutes - result.scheduled_minutes[item.id],
            "reason": "Not enough eligible capacity inside this proposal.",
        }
        for item in items
        if result.scheduled_minutes[item.id] < item.target_minutes
    ]
    if result.timed_out:
        warnings.append(
            "The solver reached its time limit; this feasible draft may not be optimal."
        )
    proposal.generation_summary = ProposalSummaryRead(
        solve_status=result.status,
        scheduled_minutes=scheduled_total,
        requested_minutes=sum(item.target_minutes for item in items),
        preserved_blocks=len(preserved),
        generated_blocks=len(result.placements),
        warnings=warnings,
        unscheduled=unscheduled,
    ).model_dump(mode="json")
    db.commit()
    return proposal_read(db, current_user, owned_proposal(db, current_user.id, proposal.id))


@router.get(
    "/semesters/{semester_id}/schedule/proposal", response_model=ScheduleProposalRead | None
)
def get_proposal(
    semester_id: uuid.UUID, db: DbSession, current_user: CurrentUser
) -> ScheduleProposalRead | None:
    owned_semester(db, current_user.id, semester_id)
    proposal = current_proposal(db, current_user.id, semester_id)
    return proposal_read(db, current_user, proposal) if proposal else None


@router.post(
    "/schedule-proposals/{proposal_id}/blocks",
    response_model=ScheduleBlockRead,
    status_code=201,
)
def create_proposal_block(
    proposal_id: uuid.UUID,
    payload: ScheduleBlockCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> ScheduledBlock:
    proposal = owned_proposal(db, current_user.id, proposal_id)
    semester = owned_semester(db, current_user.id, proposal.semester_id)
    validate_links(
        db,
        current_user.id,
        semester.id,
        payload.task_id,
        payload.fixed_event_id,
        payload.goal_id,
    )
    validate_times(db, current_user, semester, proposal.id, payload.start_at, payload.end_at)
    block = ScheduledBlock(
        schedule_version_id=proposal.id,
        user_id=current_user.id,
        source="proposal_edit",
        stability_weight=2.0,
        reason_code="user_adjusted",
        reason_details={"message": "Added during proposal review."},
        **payload.model_dump(),
    )
    db.add(block)
    _record_edit(proposal)
    db.commit()
    db.refresh(block)
    return block


@router.patch(
    "/schedule-proposals/{proposal_id}/blocks/{block_id}", response_model=ScheduleBlockRead
)
def update_proposal_block(
    proposal_id: uuid.UUID,
    block_id: uuid.UUID,
    payload: ScheduleBlockUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> ScheduledBlock:
    proposal = owned_proposal(db, current_user.id, proposal_id)
    block = next((item for item in proposal.blocks if item.id == block_id), None)
    if block is None:
        raise ApiError("NOT_FOUND", "Proposal block not found.", 404)
    semester = owned_semester(db, current_user.id, proposal.semester_id)
    values = payload.model_dump(exclude_unset=True)
    task_id = values.get("task_id", block.task_id)
    fixed_event_id = values.get("fixed_event_id", block.fixed_event_id)
    goal_id = values.get("goal_id", block.goal_id)
    validate_links(db, current_user.id, semester.id, task_id, fixed_event_id, goal_id)
    start_at = values.get("start_at", aware(block.start_at))
    end_at = values.get("end_at", aware(block.end_at))
    validate_times(db, current_user, semester, proposal.id, start_at, end_at, block.id)
    for field, value in values.items():
        setattr(block, field, value)
    block.source = "proposal_edit"
    block.stability_weight = 2.0
    block.reason_code = "user_adjusted"
    block.reason_details = {"message": "Adjusted during proposal review."}
    _record_edit(proposal)
    db.commit()
    db.refresh(block)
    return block


@router.delete("/schedule-proposals/{proposal_id}/blocks/{block_id}", status_code=204)
def delete_proposal_block(
    proposal_id: uuid.UUID,
    block_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    proposal = owned_proposal(db, current_user.id, proposal_id)
    block = next((item for item in proposal.blocks if item.id == block_id), None)
    if block is None:
        raise ApiError("NOT_FOUND", "Proposal block not found.", 404)
    db.delete(block)
    _record_edit(proposal)
    db.commit()


@router.post("/schedule-proposals/{proposal_id}/accept", response_model=ScheduleProposalRead)
def accept_proposal(
    proposal_id: uuid.UUID, db: DbSession, current_user: CurrentUser
) -> ScheduleProposalRead:
    proposal = owned_proposal(db, current_user.id, proposal_id)
    if proposal.input_fingerprint != input_fingerprint(db, current_user, proposal.semester_id):
        raise ApiError(
            "PROPOSAL_STALE",
            "Planning inputs changed after this draft was generated. Generate a fresh proposal.",
            409,
        )
    accepted = _accepted_schedule(db, current_user.id, proposal.semester_id, for_update=True)
    if accepted:
        accepted.status = ScheduleStatus.superseded
    proposal.status = ScheduleStatus.accepted
    proposal.accepted_at = datetime.now(UTC)
    db.commit()
    db.refresh(proposal)
    return proposal_read(db, current_user, proposal)


@router.post("/schedule-proposals/{proposal_id}/reject", status_code=204)
def reject_proposal(proposal_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> None:
    proposal = owned_proposal(db, current_user.id, proposal_id)
    proposal.status = ScheduleStatus.rejected
    db.commit()


def input_fingerprint(db: DbSession, user: User, semester_id: uuid.UUID) -> str:
    rows: list[object] = [user.timezone]
    semester = owned_semester(db, user.id, semester_id)
    rows.extend((semester.id, semester.updated_at, semester.start_date, semester.end_date))
    for model in (Task, Goal, FixedEvent, AvailabilityWindow, UserPreference):
        records = cast(
            list[FingerprintRecord],
            list(db.scalars(select(model).where(model.user_id == user.id))),
        )
        for record in sorted(records, key=lambda value: str(value.id)):
            rows.extend((record.id, record.updated_at))
            for column in record.__table__.columns:
                name = str(column.name)
                if name not in {"id", "created_at", "updated_at", "user_id"}:
                    rows.append(getattr(record, name))
    accepted = _accepted_schedule(db, user.id, semester_id)
    if accepted:
        rows.extend((accepted.id, accepted.updated_at))
        for block in sorted(accepted.blocks, key=lambda value: str(value.id)):
            rows.extend(
                (
                    block.id,
                    block.updated_at,
                    block.start_at,
                    block.end_at,
                    block.task_id,
                    block.goal_id,
                    block.locked,
                    block.source,
                )
            )
    encoded = json.dumps(rows, default=str, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _accepted_schedule(
    db: DbSession, user_id: uuid.UUID, semester_id: uuid.UUID, for_update: bool = False
) -> ScheduleVersion | None:
    query = (
        select(ScheduleVersion)
        .where(
            ScheduleVersion.user_id == user_id,
            ScheduleVersion.semester_id == semester_id,
            ScheduleVersion.status == ScheduleStatus.accepted,
        )
        .options(selectinload(ScheduleVersion.blocks))
    )
    if for_update:
        query = query.with_for_update()
    return db.scalar(query)


def _copy_preserved_blocks(
    db: DbSession,
    accepted: ScheduleVersion | None,
    proposal: ScheduleVersion,
    horizon_start: date,
    horizon_end: date,
    freeze_until: datetime,
) -> list[ScheduledBlock]:
    preserved: list[ScheduledBlock] = []
    if accepted is None:
        return preserved
    for block in accepted.blocks:
        block_date = block.start_at.astimezone(UTC).date()
        eligible_generated = (
            block.source == "generated"
            and not block.locked
            and block.start_at >= freeze_until
            and horizon_start <= block_date <= horizon_end
        )
        if eligible_generated:
            continue
        copied = ScheduledBlock(
            schedule_version_id=proposal.id,
            user_id=block.user_id,
            task_id=block.task_id,
            fixed_event_id=block.fixed_event_id,
            goal_id=block.goal_id,
            title=block.title,
            start_at=block.start_at,
            end_at=block.end_at,
            block_type=block.block_type,
            locked=block.locked,
            source=block.source,
            stability_weight=block.stability_weight,
            reason_code=block.reason_code,
            reason_details=block.reason_details,
        )
        db.add(copied)
        preserved.append(copied)
    db.flush()
    return preserved


def _scheduling_windows(
    start_date: date,
    end_date: date,
    availability: list[AvailabilityWindow],
    occurrences: list[EventOccurrence],
    preserved: list[ScheduledBlock],
    preferences: UserPreference,
    timezone: ZoneInfo,
) -> list[SchedulingWindow]:
    windows: list[SchedulingWindow] = []
    for offset in range((end_date - start_date).days + 1):
        current = start_date + timedelta(days=offset)
        available = availability_intervals(current, availability, timezone)
        exclusions: list[Interval] = []
        for occurrence in occurrences:
            start_at = occurrence.start_at - timedelta(
                minutes=occurrence.event.commute_before_minutes
            )
            end_at = occurrence.end_at + timedelta(minutes=occurrence.event.commute_after_minutes)
            exclusions.append((start_at, end_at))
        exclusions.extend(
            (aware(block.start_at).astimezone(timezone), aware(block.end_at).astimezone(timezone))
            for block in preserved
        )
        sleep_start = datetime.combine(current, preferences.default_sleep_time, tzinfo=timezone)
        wake = datetime.combine(current, preferences.default_wake_time, tzinfo=timezone)
        exclusions.extend(
            [
                (datetime.combine(current - timedelta(days=1), time.min, tzinfo=timezone), wake),
                (
                    sleep_start,
                    datetime.combine(current + timedelta(days=1), time.min, tzinfo=timezone),
                ),
            ]
        )
        open_intervals = subtract_intervals(available, exclusions)
        open_minutes = min(
            interval_minutes(open_intervals), preferences.maximum_daily_focus_minutes
        )
        usable = math.floor(open_minutes * (100 - preferences.preserve_free_time_percent) / 100)
        remaining = usable
        for start_at, end_at in open_intervals:
            if remaining <= 0:
                break
            duration = min(round((end_at - start_at).total_seconds() / 60), remaining)
            duration -= duration % 5
            if duration >= 5:
                energy = next(
                    (
                        window.energy_level.value
                        for window in availability
                        if window.day_of_week == current.weekday()
                        and window.start_time <= start_at.timetz().replace(tzinfo=None)
                        and window.end_time >= end_at.timetz().replace(tzinfo=None)
                    ),
                    "medium",
                )
                windows.append(
                    SchedulingWindow(start_at, start_at + timedelta(minutes=duration), energy)
                )
                remaining -= duration
    return windows


def _scheduling_items(
    db: DbSession,
    user_id: uuid.UUID,
    semester: Semester,
    horizon_start: date,
    horizon_end: date,
    preserved: list[ScheduledBlock],
) -> tuple[list[SchedulingItem], dict[str, tuple[uuid.UUID | None, uuid.UUID | None]], list[str]]:
    courses = list(db.scalars(select(Course).where(Course.semester_id == semester.id)))
    course_ids = {course.id for course in courses}
    goals = list(
        db.scalars(
            select(Goal).where(
                Goal.user_id == user_id,
                Goal.status == GoalStatus.active,
            )
        )
    )
    goal_ids = {goal.id for goal in goals if goal.semester_id in {None, semester.id}}
    tasks = list(
        db.scalars(
            select(Task).where(
                Task.user_id == user_id,
                Task.status.in_((TaskStatus.pending, TaskStatus.in_progress)),
                Task.remaining_minutes > 0,
            )
        )
    )
    preserved_minutes: dict[uuid.UUID, int] = {}
    for block in preserved:
        if block.task_id:
            preserved_minutes[block.task_id] = preserved_minutes.get(block.task_id, 0) + round(
                (block.end_at - block.start_at).total_seconds() / 60
            )
    items: list[SchedulingItem] = []
    links: dict[str, tuple[uuid.UUID | None, uuid.UUID | None]] = {}
    warnings: list[str] = []
    for task in tasks:
        if task.course_id not in course_ids and task.goal_id not in goal_ids:
            continue
        if task.deadline_at is None:
            warnings.append(f'"{task.name}" has no confirmed deadline and was not scheduled.')
            continue
        due_date = task.deadline_at.astimezone(UTC).date()
        days_to_due = max((due_date - horizon_start).days + 1, 1)
        remaining = max(task.remaining_minutes - preserved_minutes.get(task.id, 0), 0)
        if not remaining:
            continue
        if due_date <= horizon_end:
            target = remaining
        else:
            target = max(
                task.minimum_session_minutes,
                math.ceil(remaining * 14 / days_to_due / 5) * 5,
            )
            target = min(target, remaining)
        identifier = f"task:{task.id}"
        items.append(
            SchedulingItem(
                identifier,
                task.name,
                target,
                task.minimum_session_minutes,
                task.preferred_session_minutes,
                task.maximum_session_minutes,
                PRIORITY_RANK[task.priority.value],
                task.intensity.value,
            )
        )
        links[identifier] = (task.id, None)
    for goal in goals:
        if goal.id not in goal_ids:
            continue
        identifier = f"goal:{goal.id}"
        target = goal.preferred_weekly_minutes * 2
        items.append(
            SchedulingItem(
                identifier,
                goal.name,
                target,
                goal.minimum_session_minutes,
                goal.preferred_session_minutes,
                goal.maximum_session_minutes,
                PRIORITY_RANK[goal.priority.value],
                "moderate",
                "goal",
            )
        )
        links[identifier] = (None, goal.id)
    return items, links, warnings


def _record_edit(proposal: ScheduleVersion) -> None:
    summary = dict(proposal.generation_summary or {})
    current = summary.get("moved_blocks", 0)
    summary["moved_blocks"] = (current if isinstance(current, int) else 0) + 1
    proposal.generation_summary = summary
