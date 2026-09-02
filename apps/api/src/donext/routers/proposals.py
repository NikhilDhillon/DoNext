import hashlib
import json
import logging
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal, Protocol, cast
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from sqlalchemy import Table, func, select
from sqlalchemy.orm import selectinload

from donext.academic_impact import calculate_weights
from donext.dependencies import CurrentUser, DbSession
from donext.errors import ApiError
from donext.models import (
    AcademicItem,
    AcademicItemType,
    AssessmentGroup,
    AvailabilityWindow,
    Course,
    CourseDeliveryMode,
    EstimateOrigin,
    FixedEvent,
    Goal,
    GoalStatus,
    GradingScheme,
    GradingSchemeComponent,
    MeetingKind,
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
from donext.schedule_revision import (
    RevisionInterpretation,
    ScheduleRevisionPolicy,
    interpret_revision_feedback,
)
from donext.scheduler import (
    SchedulingItem,
    SchedulingPolicy,
    SchedulingResult,
    SchedulingWindow,
    solve_schedule,
)
from donext.schemas import (
    ExtraFocusDecision,
    GenerationBlockingInput,
    GenerationExamRequirement,
    ProposalSummaryRead,
    ScheduleBlockCreate,
    ScheduleBlockRead,
    ScheduleBlockUpdate,
    ScheduleGenerationRequirementsRead,
    ScheduleProposalGenerate,
    ScheduleProposalRead,
    ScheduleRevisionRequest,
    sleep_window_minutes,
)

router = APIRouter(tags=["schedule proposals"])
logger = logging.getLogger(__name__)
PRIORITY_RANK = {"optional": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
ROLLOVER_BUFFER_MINUTES = 60
COMPLETE_TIMEOUT_WARNING = "Everything fits. Regenerate for a different arrangement."
PARTIAL_TIMEOUT_WARNING = (
    "Some work did not fit \u2014 see unresolved items below. "
    "Regenerate for a different arrangement."
)


@dataclass(frozen=True)
class CourseReadiness:
    ready_at: datetime | None
    source: Literal["lecture", "asynchronous", "missing"]


def _course_readiness(
    events: list[FixedEvent],
    courses: list[Course],
    timezone: ZoneInfo,
) -> dict[uuid.UUID, CourseReadiness]:
    readiness: dict[uuid.UUID, CourseReadiness] = {}
    for course in courses:
        if course.delivery_mode == CourseDeliveryMode.asynchronous:
            ready_at = (
                aware(course.first_content_available_at).astimezone(timezone)
                if course.first_content_available_at is not None
                else None
            )
            readiness[course.id] = CourseReadiness(
                ready_at, "asynchronous" if ready_at else "missing"
            )
            continue
        lecture_ends = [
            aware(event.end_at).astimezone(timezone)
            for event in events
            if event.category == "class"
            and event.course_id == course.id
            and event.meeting_kind == MeetingKind.lecture
        ]
        readiness[course.id] = CourseReadiness(
            min(lecture_ends) if lecture_ends else None,
            "lecture" if lecture_ends else "missing",
        )
    return readiness


class FingerprintRecord(Protocol):
    id: object
    updated_at: datetime
    __table__: Table


def _solver_timeout_warning(*, has_unscheduled: bool) -> str:
    return PARTIAL_TIMEOUT_WARNING if has_unscheduled else COMPLETE_TIMEOUT_WARNING


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
        revision_of_proposal_id=proposal.revision_of_proposal_id,
        horizon_start=proposal.horizon_start or date.min,
        horizon_end=proposal.horizon_end or date.min,
        stale=(
            proposal.status == ScheduleStatus.proposed
            and proposal.input_fingerprint != input_fingerprint(db, user, proposal.semester_id)
        ),
        generation_summary=summary,
        revision_feedback=proposal.revision_feedback,
    )


def _horizon(semester: Semester, timezone: ZoneInfo) -> tuple[date, date]:
    today = datetime.now(UTC).astimezone(timezone).date()
    start = max(today, semester.start_date)
    return start, min(start + timedelta(days=13), semester.end_date)


def _generation_requirements(
    db: DbSession, user: User, semester: Semester
) -> ScheduleGenerationRequirementsRead:
    timezone = resolve_timezone(user.timezone)
    horizon_start, horizon_end = _horizon(semester, timezone)
    courses = list(db.scalars(select(Course).where(Course.semester_id == semester.id)))
    course_by_id = {course.id: course for course in courses}
    course_ids = list(course_by_id)
    items = (
        list(db.scalars(select(AcademicItem).where(AcademicItem.course_id.in_(course_ids))))
        if course_ids
        else []
    )
    tasks = list(
        db.scalars(
            select(Task).where(
                Task.user_id == user.id,
                Task.academic_item_id.in_([item.id for item in items]),
                Task.status.in_((TaskStatus.pending, TaskStatus.in_progress)),
            )
        )
    )
    task_by_item = {task.academic_item_id: task for task in tasks}
    events = list(db.scalars(select(FixedEvent).where(FixedEvent.user_id == user.id)))
    readiness = _course_readiness(events, courses, timezone)
    exams: list[GenerationExamRequirement] = []
    blocking: list[GenerationBlockingInput] = []
    blocked_courses: set[uuid.UUID] = set()
    for item in items:
        task = task_by_item.get(item.id)
        if item.due_at is None or task is None:
            continue
        due_at = aware(item.due_at).astimezone(timezone)
        if (
            item.item_type in {AcademicItemType.midterm, AcademicItemType.final_exam}
            and horizon_start <= due_at.date() <= horizon_end
            and task.estimate_origin == EstimateOrigin.pending_exam
        ):
            course = course_by_id[item.course_id]
            exams.append(
                GenerationExamRequirement(
                    academic_item_id=item.id,
                    task_id=task.id,
                    course_code=course.code,
                    name=item.name,
                    due_at=due_at,
                    default_minutes=480,
                )
            )
        if item.item_type == AcademicItemType.assignment:
            course_readiness = readiness.get(item.course_id)
            if (
                course_readiness is None or course_readiness.ready_at is None
            ) and item.course_id not in blocked_courses:
                blocked_courses.add(item.course_id)
                course = course_by_id[item.course_id]
                blocking.append(
                    GenerationBlockingInput(
                        code="COURSE_READINESS_MISSING",
                        course_id=course.id,
                        message=(
                            f"{course.code} needs a lecture or asynchronous content-available "
                            "time before assignments can be scheduled."
                        ),
                    )
                )
    return ScheduleGenerationRequirementsRead(
        horizon_start=horizon_start,
        horizon_end=horizon_end,
        exams=exams,
        blocking_inputs=blocking,
    )


@router.get(
    "/semesters/{semester_id}/schedule/generation-requirements",
    response_model=ScheduleGenerationRequirementsRead,
)
def generation_requirements(
    semester_id: uuid.UUID, db: DbSession, current_user: CurrentUser
) -> ScheduleGenerationRequirementsRead:
    semester = owned_semester(db, current_user.id, semester_id)
    return _generation_requirements(db, current_user, semester)


@router.post(
    "/semesters/{semester_id}/schedule/proposals",
    response_model=ScheduleProposalRead,
    status_code=201,
)
def generate_proposal(
    semester_id: uuid.UUID,
    db: DbSession,
    current_user: CurrentUser,
    payload: ScheduleProposalGenerate | None = None,
) -> ScheduleProposalRead:
    semester = owned_semester(db, current_user.id, semester_id)
    requirements = _generation_requirements(db, current_user, semester)
    if requirements.exams:
        raise ApiError(
            "SCHEDULER_ESTIMATE_REQUIRED",
            "Choose preparation time for the exams inside this plan.",
            409,
            {"exams": [exam.model_dump(mode="json") for exam in requirements.exams]},
        )
    if requirements.blocking_inputs:
        raise ApiError(
            "SCHEDULER_INPUT_INCOMPLETE",
            "Confirm course readiness before generating this schedule.",
            422,
            {
                "blocking_inputs": [
                    item.model_dump(mode="json") for item in requirements.blocking_inputs
                ]
            },
        )
    proposal = _build_proposal(
        db,
        current_user,
        semester_id,
        extra_focus_decision=payload.extra_focus_decision if payload else None,
    )
    db.commit()
    return proposal_read(db, current_user, owned_proposal(db, current_user.id, proposal.id))


def _build_proposal(
    db: DbSession,
    current_user: User,
    semester_id: uuid.UUID,
    *,
    revision_of: ScheduleVersion | None = None,
    interpretation: RevisionInterpretation | None = None,
    extra_focus_decision: ExtraFocusDecision | None = None,
) -> ScheduleVersion:
    semester = owned_semester(db, current_user.id, semester_id)
    timezone = resolve_timezone(current_user.timezone)
    horizon_start, horizon_end = _horizon(semester, timezone)
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
    if existing and revision_of is None:
        existing.status = ScheduleStatus.superseded

    latest_version = db.scalar(
        select(func.max(ScheduleVersion.version_number)).where(
            ScheduleVersion.user_id == current_user.id
        )
    )
    current_input_fingerprint = input_fingerprint(db, current_user, semester_id)
    proposal = ScheduleVersion(
        user_id=current_user.id,
        semester_id=semester_id,
        base_schedule_version_id=accepted.id if accepted else None,
        revision_of_proposal_id=revision_of.id if revision_of else None,
        version_number=(latest_version or 0) + 1,
        reason=(
            "Revised 14-day proposal"
            if revision_of is not None
            else "Deterministic 14-day proposal"
        ),
        status=ScheduleStatus.proposed,
        horizon_start=horizon_start,
        horizon_end=horizon_end,
        input_fingerprint=current_input_fingerprint,
        revision_feedback=(
            {
                "policy": interpretation.policy.model_dump(mode="json"),
                "interpreter": interpretation.source,
                "note_applied": interpretation.note_applied,
                "summary": interpretation.policy.summary,
            }
            if interpretation is not None
            else None
        ),
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
        freeze_until.astimezone(timezone),
    )
    policy = interpretation.policy if interpretation is not None else None
    if policy is not None:
        windows = _apply_avoid_time_ranges(windows, policy, timezone)
    preferred_session_minutes = _preferred_session_minutes(
        preferences.preferred_session_minutes, policy
    )
    courses = list(db.scalars(select(Course).where(Course.semester_id == semester.id)))
    items, item_links, warnings = _scheduling_items(
        db,
        current_user.id,
        semester,
        horizon_start,
        horizon_end,
        preserved,
        preferred_session_minutes,
        timezone,
        windows,
        _course_readiness(events, courses, timezone),
    )
    scheduler_policy = _scheduler_policy(policy)
    solve_seconds = 3.0 if revision_of is not None else 5.0
    result = solve_schedule(
        items,
        windows,
        preferences.minimum_break_minutes,
        time_limit_seconds=solve_seconds,
        policy=scheduler_policy,
    )
    used_windows = windows
    used_buffer = False
    used_extra_focus = False
    sleep_reduction = 0

    urgent_shortfall = any(
        item.risk_tier >= 4
        and item.kind in {"task", "exam_prep"}
        and result.scheduled_minutes[item.id] < item.target_minutes
        for item in items
    )
    if urgent_shortfall:
        buffer_windows = _scheduling_windows(
            horizon_start,
            horizon_end,
            availability,
            occurrences,
            preserved,
            preferences,
            timezone,
            freeze_until.astimezone(timezone),
            release_buffer=True,
        )
        if policy is not None:
            buffer_windows = _apply_avoid_time_ranges(buffer_windows, policy, timezone)
        buffer_result = solve_schedule(
            items,
            buffer_windows,
            preferences.minimum_break_minutes,
            time_limit_seconds=solve_seconds,
            policy=scheduler_policy,
        )
        if _required_academic_minutes(items, buffer_result) > _required_academic_minutes(
            items, result
        ):
            result = buffer_result
            used_windows = buffer_windows
            used_buffer = True

    if _required_academic_shortfall(items, result):
        extra_windows = _scheduling_windows(
            horizon_start,
            horizon_end,
            availability,
            occurrences,
            preserved,
            preferences,
            timezone,
            freeze_until.astimezone(timezone),
            release_buffer=used_buffer,
            remove_focus_cap=True,
        )
        if policy is not None:
            extra_windows = _apply_avoid_time_ranges(extra_windows, policy, timezone)
        extra_result = solve_schedule(
            items,
            extra_windows,
            preferences.minimum_break_minutes,
            time_limit_seconds=solve_seconds,
            policy=scheduler_policy,
        )
        extra_by_day = _additional_minutes_by_day(result, extra_result, timezone)
        if extra_by_day and _required_academic_minutes(
            items, extra_result
        ) > _required_academic_minutes(items, result):
            request_fingerprint = _extra_focus_fingerprint(current_input_fingerprint, extra_by_day)
            decision_matches = (
                extra_focus_decision is not None
                and extra_focus_decision.request_fingerprint == request_fingerprint
            )
            if extra_focus_decision is None or not decision_matches:
                protected = _protected_work(items, result)
                db.rollback()
                raise ApiError(
                    "SCHEDULER_EXTRA_FOCUS_PERMISSION_REQUIRED",
                    "Required academic work needs focus time above your preferred limit.",
                    409,
                    {
                        "request_fingerprint": request_fingerprint,
                        "total_extra_minutes": sum(extra_by_day.values()),
                        "extra_minutes_by_day": [
                            {"date": day.isoformat(), "minutes": minutes}
                            for day, minutes in sorted(extra_by_day.items())
                        ],
                        "resulting_focus_by_day": _scheduled_minutes_by_day(extra_result, timezone),
                        "protected_work": protected,
                    },
                )
            if extra_focus_decision.approved:
                result = extra_result
                used_windows = extra_windows
                used_extra_focus = True

    if _required_academic_shortfall(items, result):
        preferred_sleep = sleep_window_minutes(
            preferences.default_sleep_time, preferences.default_wake_time
        )
        maximum_reduction = max(preferred_sleep - preferences.minimum_sleep_minutes, 0)
        for reduction in range(15, maximum_reduction + 1, 15):
            sleep_windows = _scheduling_windows(
                horizon_start,
                horizon_end,
                availability,
                occurrences,
                preserved,
                preferences,
                timezone,
                freeze_until.astimezone(timezone),
                release_buffer=used_buffer,
                remove_focus_cap=used_extra_focus,
                sleep_reduction_minutes=reduction,
            )
            if policy is not None:
                sleep_windows = _apply_avoid_time_ranges(sleep_windows, policy, timezone)
            sleep_result = solve_schedule(
                items,
                sleep_windows,
                preferences.minimum_break_minutes,
                time_limit_seconds=min(solve_seconds, 1.0),
                policy=scheduler_policy,
            )
            if _required_academic_minutes(items, sleep_result) > _required_academic_minutes(
                items, result
            ):
                result = sleep_result
                used_windows = sleep_windows
                sleep_reduction = reduction
            if not _required_academic_shortfall(items, result):
                break
    for placement in result.placements:
        task_id, goal_id, block_type = item_links[placement.item_id]
        db.add(
            ScheduledBlock(
                schedule_version_id=proposal.id,
                user_id=current_user.id,
                task_id=task_id,
                goal_id=goal_id,
                title=placement.title,
                start_at=placement.start_at,
                end_at=placement.end_at,
                block_type=block_type,
                locked=False,
                source="generated",
                stability_weight=0.5,
                reason_code=placement.reason_code,
                reason_details=_placement_capacity_details(
                    placement.reason_details,
                    placement.start_at,
                    windows,
                    result,
                    timezone,
                    used_buffer,
                    used_extra_focus,
                    sleep_reduction,
                ),
            )
        )
    scheduled_total = sum(result.scheduled_minutes.values())
    unscheduled = _unscheduled_summary(items, result.scheduled_minutes, item_links, used_windows)
    if result.timed_out:
        warnings.append(_solver_timeout_warning(has_unscheduled=bool(unscheduled)))
    proposal.generation_summary = ProposalSummaryRead(
        solve_status=result.status,
        coverage_status="partial" if unscheduled else "complete",
        timed_out=result.timed_out,
        used_baseline=result.used_baseline,
        scheduled_minutes=scheduled_total,
        requested_minutes=sum(item.target_minutes for item in items),
        eligible_capacity_minutes=result.eligible_capacity_minutes,
        protected_free_minutes=result.protected_free_minutes,
        solver_runtime_ms=result.runtime_ms,
        academic_requested_minutes=sum(
            item.target_minutes for item in items if item.kind in {"task", "exam_prep"}
        ),
        academic_scheduled_minutes=sum(
            result.scheduled_minutes[item.id]
            for item in items
            if item.kind in {"task", "exam_prep"}
        ),
        opportunistic_scheduled_minutes=sum(
            result.scheduled_minutes[item.id] for item in items if item.kind == "distant_task"
        ),
        exam_preparation=_exam_summary(db, items, item_links, result),
        flexible_adjustments=_flexible_adjustments(items, result),
        rollover_by_day=_rollover_summary(windows, result, timezone, used_buffer),
        extra_focus_by_day=(
            _additional_minutes_summary(windows, result, timezone, used_buffer)
            if used_extra_focus
            else []
        ),
        sleep_by_day=_sleep_summary(
            horizon_start,
            horizon_end,
            preferences,
            sleep_reduction,
            result,
            timezone,
        ),
        preserved_blocks=len(preserved),
        generated_blocks=len(result.placements),
        warnings=warnings,
        unscheduled=unscheduled,
    ).model_dump(mode="json")
    logger.info(
        "schedule proposal generated requested=%s scheduled=%s capacity=%s blocks=%s "
        "runtime_ms=%s timed_out=%s baseline=%s",
        sum(item.target_minutes for item in items),
        scheduled_total,
        result.eligible_capacity_minutes,
        len(result.placements),
        result.runtime_ms,
        result.timed_out,
        result.used_baseline,
    )
    db.flush()
    return proposal


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
    validate_focus_hours(db, current_user, payload.start_at, payload.end_at)
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
    if "start_at" in values or "end_at" in values:
        validate_focus_hours(db, current_user, start_at, end_at)
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


def validate_focus_hours(
    db: DbSession,
    user: User,
    start_at: datetime,
    end_at: datetime,
) -> None:
    timezone = resolve_timezone(user.timezone)
    local_start = start_at.astimezone(timezone)
    local_end = end_at.astimezone(timezone)
    ends_at_midnight = (
        local_end.date() == local_start.date() + timedelta(days=1)
        and local_end.timetz().replace(tzinfo=None) == time.min
    )
    if local_start.date() != local_end.date() and not ends_at_midnight:
        raise ApiError(
            "OUTSIDE_FOCUS_HOURS",
            "Choose a time inside your saved focus hours for one day.",
            422,
        )
    windows = list(
        db.scalars(select(AvailabilityWindow).where(AvailabilityWindow.user_id == user.id))
    )
    if any(
        interval_start <= local_start and local_end <= interval_end
        for interval_start, interval_end in availability_intervals(
            local_start.date(), windows, timezone
        )
    ):
        return
    raise ApiError(
        "OUTSIDE_FOCUS_HOURS",
        "Choose a time inside your saved focus hours for that day.",
        422,
    )


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


@router.post(
    "/schedule-proposals/{proposal_id}/revise",
    response_model=ScheduleProposalRead,
    status_code=201,
)
def revise_proposal(
    proposal_id: uuid.UUID,
    payload: ScheduleRevisionRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> ScheduleProposalRead:
    previous = owned_proposal(db, current_user.id, proposal_id)
    preferences = db.scalar(select(UserPreference).where(UserPreference.user_id == current_user.id))
    if preferences is None:
        raise ApiError("NOT_FOUND", "Planning preferences not found.", 404)
    interpretation = interpret_revision_feedback(
        payload,
        _revision_activities(db, current_user.id, previous),
        cast(dict[str, object] | None, preferences.schedule_revision_policy),
    )
    fallback_reasons = {
        "too_packed",
        "sessions_too_long",
        "sessions_too_short",
        "balance_activities",
    }
    if interpretation.source == "fallback" and not fallback_reasons.intersection(payload.reasons):
        raise ApiError(
            "REVISION_FEEDBACK_UNAVAILABLE",
            "DoNext could not interpret that timing feedback. Your current draft is unchanged.",
            503,
        )
    if payload.remember:
        preferences.schedule_revision_policy = interpretation.policy.model_dump(mode="json")
        db.flush()
    revised = _build_proposal(
        db,
        current_user,
        previous.semester_id,
        revision_of=previous,
        interpretation=interpretation,
    )
    revised_feedback = dict(revised.revision_feedback or {})
    revised_feedback["changes"] = _revision_change_summary(previous, revised)
    revised.revision_feedback = revised_feedback
    previous.status = ScheduleStatus.rejected
    db.commit()
    return proposal_read(db, current_user, owned_proposal(db, current_user.id, revised.id))


def _revision_activities(
    db: DbSession, user_id: uuid.UUID, proposal: ScheduleVersion
) -> list[dict[str, object]]:
    task_ids = {block.task_id for block in proposal.blocks if block.task_id is not None}
    goal_ids = {block.goal_id for block in proposal.blocks if block.goal_id is not None}
    tasks = {
        task.id: task
        for task in db.scalars(select(Task).where(Task.user_id == user_id, Task.id.in_(task_ids)))
    }
    goals = {
        goal.id: goal
        for goal in db.scalars(select(Goal).where(Goal.user_id == user_id, Goal.id.in_(goal_ids)))
    }
    activities: dict[str, dict[str, object]] = {}
    for block in proposal.blocks:
        duration = round((aware(block.end_at) - aware(block.start_at)).total_seconds() / 60)
        if block.task_id is not None and block.task_id in tasks:
            task = tasks[block.task_id]
            source_id = f"task:{task.id}"
            priority = task.priority.value
        elif block.goal_id is not None and block.goal_id in goals:
            goal = goals[block.goal_id]
            source_id = f"goal:{goal.id}"
            priority = goal.priority.value
        else:
            continue
        entry = activities.setdefault(
            source_id,
            {
                "source_id": source_id,
                "name": block.title,
                "priority": priority,
                "scheduled_minutes": 0,
            },
        )
        entry["scheduled_minutes"] = cast(int, entry["scheduled_minutes"]) + duration
    summary = ProposalSummaryRead.model_validate(proposal.generation_summary or {})
    for unresolved in summary.unscheduled:
        identifier = str(unresolved.get("id", ""))
        identifier_parts = identifier.split(":", 2)
        if len(identifier_parts) < 2:
            continue
        normalized = (
            f"{'goal' if identifier_parts[0] in {'goal', 'flex'} else 'task'}:{identifier_parts[1]}"
        )
        entry = activities.setdefault(
            normalized,
            {
                "source_id": normalized,
                "name": str(unresolved.get("name", "Activity")),
                "priority": "unknown",
                "scheduled_minutes": 0,
            },
        )
        entry["remaining_minutes"] = unresolved.get("remaining_minutes", 0)
    return sorted(activities.values(), key=lambda activity: str(activity["source_id"]))


def _revision_change_summary(previous: ScheduleVersion, revised: ScheduleVersion) -> dict[str, int]:
    previous_generated = [block for block in previous.blocks if block.source != "preserved"]
    revised_generated = [block for block in revised.blocks if block.source != "preserved"]
    previous_minutes = sum(
        round((aware(block.end_at) - aware(block.start_at)).total_seconds() / 60)
        for block in previous_generated
    )
    revised_minutes = sum(
        round((aware(block.end_at) - aware(block.start_at)).total_seconds() / 60)
        for block in revised_generated
    )
    previous_signatures = Counter(
        (
            block.task_id,
            block.goal_id,
            block.title,
            aware(block.start_at),
            aware(block.end_at),
        )
        for block in previous_generated
    )
    revised_signatures = Counter(
        (
            block.task_id,
            block.goal_id,
            block.title,
            aware(block.start_at),
            aware(block.end_at),
        )
        for block in revised_generated
    )
    removed_placements = previous_signatures - revised_signatures
    added_placements = revised_signatures - previous_signatures
    return {
        "blocks_changed": max(removed_placements.total(), added_placements.total()),
        "block_count_delta": len(revised_generated) - len(previous_generated),
        "scheduled_minutes_delta": revised_minutes - previous_minutes,
    }


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
    courses = list(
        db.scalars(select(Course).where(Course.semester_id == semester_id).order_by(Course.id))
    )
    course_ids = [course.id for course in courses]
    academic_items = (
        list(
            db.scalars(
                select(AcademicItem)
                .where(AcademicItem.course_id.in_(course_ids))
                .order_by(AcademicItem.id)
            )
        )
        if course_ids
        else []
    )
    groups = (
        list(
            db.scalars(
                select(AssessmentGroup)
                .where(AssessmentGroup.course_id.in_(course_ids))
                .order_by(AssessmentGroup.id)
            )
        )
        if course_ids
        else []
    )
    schemes = (
        list(
            db.scalars(
                select(GradingScheme)
                .where(GradingScheme.course_id.in_(course_ids))
                .order_by(GradingScheme.id)
            )
        )
        if course_ids
        else []
    )
    scheme_ids = [scheme.id for scheme in schemes]
    components = (
        list(
            db.scalars(
                select(GradingSchemeComponent)
                .where(GradingSchemeComponent.grading_scheme_id.in_(scheme_ids))
                .order_by(GradingSchemeComponent.id)
            )
        )
        if scheme_ids
        else []
    )
    for source_record in [*courses, *academic_items, *groups, *schemes, *components]:
        for source_column in source_record.__table__.columns:
            name = str(source_column.name)
            if name not in {"created_at", "updated_at"}:
                rows.append(getattr(source_record, name))
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
        block_start = aware(block.start_at)
        block_date = block_start.astimezone(UTC).date()
        eligible_generated = (
            block.source == "generated"
            and not block.locked
            and block_start >= freeze_until
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
    not_before: datetime,
    *,
    release_buffer: bool = False,
    remove_focus_cap: bool = False,
    sleep_reduction_minutes: int = 0,
) -> list[SchedulingWindow]:
    windows: list[SchedulingWindow] = []
    for offset in range((end_date - start_date).days + 1):
        current = start_date + timedelta(days=offset)
        available = [
            (max(start_at, not_before), end_at)
            for start_at, end_at in availability_intervals(current, availability, timezone)
            if end_at > not_before
        ]
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
        sleep_start_date = (
            current + timedelta(days=1) if preferences.default_sleep_time == time.min else current
        )
        sleep_start = datetime.combine(
            sleep_start_date, preferences.default_sleep_time, tzinfo=timezone
        )
        wake = datetime.combine(current, preferences.default_wake_time, tzinfo=timezone)
        later_bedtime = sleep_reduction_minutes // 2
        earlier_wake = sleep_reduction_minutes - later_bedtime
        sleep_start += timedelta(minutes=later_bedtime)
        wake -= timedelta(minutes=earlier_wake)
        day_end = datetime.combine(current + timedelta(days=1), time.min, tzinfo=timezone)
        exclusions.extend(
            [
                (datetime.combine(current, time.min, tzinfo=timezone), wake),
                (sleep_start, day_end),
            ]
        )
        open_intervals = subtract_intervals(available, exclusions)
        open_minutes = interval_minutes(open_intervals)
        focus_limited_minutes = (
            open_minutes
            if remove_focus_cap
            else min(open_minutes, preferences.maximum_daily_focus_minutes)
        )
        protected_free = (
            0 if release_buffer else min(ROLLOVER_BUFFER_MINUTES, focus_limited_minutes)
        )
        usable = max(focus_limited_minutes - protected_free, 0)
        usable -= usable % 5
        for start_at, end_at in open_intervals:
            duration = round((end_at - start_at).total_seconds() / 60)
            duration -= duration % 5
            if duration >= 5:
                energy = next(
                    (
                        window.energy_level.value
                        for window in availability
                        if window.day_of_week == current.weekday()
                        and datetime.combine(current, window.start_time, tzinfo=timezone)
                        <= start_at
                        and datetime.combine(
                            current + timedelta(days=1) if window.end_time == time.min else current,
                            window.end_time,
                            tzinfo=timezone,
                        )
                        >= end_at
                    ),
                    "medium",
                )
                windows.append(
                    SchedulingWindow(
                        start_at,
                        start_at + timedelta(minutes=duration),
                        energy,
                        usable,
                        protected_free,
                    )
                )
    return windows


def _apply_avoid_time_ranges(
    windows: list[SchedulingWindow],
    policy: ScheduleRevisionPolicy,
    timezone: ZoneInfo,
) -> list[SchedulingWindow]:
    adjusted: list[SchedulingWindow] = []
    for window in windows:
        day = window.start_at.astimezone(timezone).date()
        exclusions: list[Interval] = []
        for blocked in policy.avoid_time_ranges:
            if blocked.weekday is not None and blocked.weekday != day.weekday():
                continue
            exclusions.append(
                (
                    datetime.combine(day, blocked.start, tzinfo=timezone),
                    datetime.combine(day, blocked.end, tzinfo=timezone),
                )
            )
        for start_at, end_at in subtract_intervals([(window.start_at, window.end_at)], exclusions):
            if end_at > start_at:
                adjusted.append(
                    SchedulingWindow(
                        start_at,
                        end_at,
                        window.energy_level,
                        window.daily_capacity_minutes,
                        window.protected_free_minutes,
                    )
                )
    return adjusted


def _preferred_session_minutes(current: int, policy: ScheduleRevisionPolicy | None) -> int:
    if policy is None or policy.session_length_preference == "same":
        return current
    change = -15 if policy.session_length_preference == "shorter" else 15
    return min(max(current + change, 15), 240)


def _scheduler_policy(policy: ScheduleRevisionPolicy | None) -> SchedulingPolicy | None:
    if policy is None:
        return None
    return SchedulingPolicy(
        max_blocks_per_day=policy.max_blocks_per_day,
        preferred_time_ranges=tuple(
            (value.weekday, value.start, value.end) for value in policy.preferred_time_ranges
        ),
    )


def _required_academic_minutes(items: list[SchedulingItem], result: SchedulingResult) -> int:
    scheduled = result.scheduled_minutes
    return sum(
        scheduled[item.id] for item in items if item.required and item.kind in {"task", "exam_prep"}
    )


def _required_academic_shortfall(items: list[SchedulingItem], result: SchedulingResult) -> bool:
    scheduled = result.scheduled_minutes
    return any(
        item.required
        and item.kind in {"task", "exam_prep"}
        and scheduled[item.id] < item.target_minutes
        for item in items
    )


def _scheduled_minutes_by_day(
    result: SchedulingResult, timezone: ZoneInfo
) -> list[dict[str, object]]:
    totals: dict[date, int] = {}
    for placement in result.placements:
        start_at = placement.start_at.astimezone(timezone)
        end_at = placement.end_at.astimezone(timezone)
        totals[start_at.date()] = totals.get(start_at.date(), 0) + round(
            (end_at - start_at).total_seconds() / 60
        )
    return [
        {"date": day.isoformat(), "minutes": minutes} for day, minutes in sorted(totals.items())
    ]


def _additional_minutes_by_day(
    baseline: SchedulingResult, expanded: SchedulingResult, timezone: ZoneInfo
) -> dict[date, int]:
    def totals(result: SchedulingResult) -> dict[date, int]:
        return {
            date.fromisoformat(cast(str, row["date"])): cast(int, row["minutes"])
            for row in _scheduled_minutes_by_day(result, timezone)
        }

    baseline_totals = totals(baseline)
    return {
        day: minutes - baseline_totals.get(day, 0)
        for day, minutes in totals(expanded).items()
        if minutes > baseline_totals.get(day, 0)
    }


def _extra_focus_fingerprint(input_value: str, extra_by_day: dict[date, int]) -> str:
    encoded = json.dumps(
        [input_value, [(day.isoformat(), value) for day, value in sorted(extra_by_day.items())]],
        separators=(",", ":"),
    ).encode()
    return hashlib.sha256(encoded).hexdigest()


def _protected_work(
    items: list[SchedulingItem], result: SchedulingResult
) -> list[dict[str, object]]:
    scheduled = result.scheduled_minutes
    return [
        {
            "id": item.id,
            "name": item.title,
            "deadline": item.due_at.isoformat() if item.due_at else None,
            "remaining_minutes": item.target_minutes - scheduled[item.id],
        }
        for item in items
        if item.required
        and item.kind in {"task", "exam_prep"}
        and scheduled[item.id] < item.target_minutes
    ]


def _window_cap_by_day(windows: list[SchedulingWindow]) -> dict[date, int]:
    result: dict[date, int] = {}
    for window in windows:
        day = window.start_at.date()
        if window.daily_capacity_minutes is not None:
            result[day] = window.daily_capacity_minutes
    return result


def _rollover_summary(
    normal_windows: list[SchedulingWindow],
    result: SchedulingResult,
    timezone: ZoneInfo,
    used_buffer: bool,
) -> list[dict[str, object]]:
    normal_caps = _window_cap_by_day(normal_windows)
    protected = {
        day: max(
            window.protected_free_minutes
            for window in normal_windows
            if window.start_at.date() == day
        )
        for day in normal_caps
    }
    scheduled = {
        date.fromisoformat(cast(str, row["date"])): cast(int, row["minutes"])
        for row in _scheduled_minutes_by_day(result, timezone)
    }
    return [
        {
            "date": day.isoformat(),
            "retained_minutes": protected[day] - consumed,
            "consumed_minutes": consumed,
        }
        for day, cap in sorted(normal_caps.items())
        if (
            consumed := min(
                max(scheduled.get(day, 0) - cap, 0) if used_buffer else 0,
                protected[day],
            )
        )
        or cap >= 0
    ]


def _additional_minutes_summary(
    normal_windows: list[SchedulingWindow],
    result: SchedulingResult,
    timezone: ZoneInfo,
    used_buffer: bool,
) -> list[dict[str, object]]:
    caps = _window_cap_by_day(normal_windows)
    return [
        {
            "date": cast(str, row["date"]),
            "approved_minutes": extra,
            "used_minutes": extra,
        }
        for row in _scheduled_minutes_by_day(result, timezone)
        if (
            extra := max(
                cast(int, row["minutes"])
                - caps.get(date.fromisoformat(cast(str, row["date"])), 0)
                - (ROLLOVER_BUFFER_MINUTES if used_buffer else 0),
                0,
            )
        )
    ]


def _placement_capacity_details(
    original: dict[str, object],
    start_at: datetime,
    normal_windows: list[SchedulingWindow],
    result: SchedulingResult,
    timezone: ZoneInfo,
    used_buffer: bool,
    used_extra_focus: bool,
    sleep_reduction: int,
) -> dict[str, object]:
    day = start_at.astimezone(timezone).date()
    caps = _window_cap_by_day(normal_windows)
    totals = {
        date.fromisoformat(cast(str, row["date"])): cast(int, row["minutes"])
        for row in _scheduled_minutes_by_day(result, timezone)
    }
    above_normal = max(totals.get(day, 0) - caps.get(day, 0), 0)
    return {
        **original,
        "rollover_capacity_used": used_buffer and above_normal > 0,
        "extra_focus_capacity_used": (
            used_extra_focus and above_normal > (ROLLOVER_BUFFER_MINUTES if used_buffer else 0)
        ),
        "reduced_sleep_capacity_used": sleep_reduction > 0,
        "sleep_reduction_minutes": sleep_reduction,
    }


def _sleep_summary(
    start_date: date,
    end_date: date,
    preferences: UserPreference,
    reduction: int,
    result: SchedulingResult,
    timezone: ZoneInfo,
) -> list[dict[str, object]]:
    if reduction <= 0:
        return []
    preferred = sleep_window_minutes(preferences.default_sleep_time, preferences.default_wake_time)
    summary: list[dict[str, object]] = []
    later_limit = reduction // 2
    earlier_limit = reduction - later_limit
    for offset in range((end_date - start_date).days + 1):
        day = start_date + timedelta(days=offset)
        wake = datetime.combine(day, preferences.default_wake_time, tzinfo=timezone)
        sleep_day = day + timedelta(days=1) if preferences.default_sleep_time == time.min else day
        bedtime = datetime.combine(sleep_day, preferences.default_sleep_time, tzinfo=timezone)
        earlier_used = 0
        later_used = 0
        for placement in result.placements:
            block_start = placement.start_at.astimezone(timezone)
            block_end = placement.end_at.astimezone(timezone)
            if block_start.date() != day:
                continue
            if block_start < wake:
                earlier_used = max(
                    earlier_used,
                    min(round((wake - block_start).total_seconds() / 60), earlier_limit),
                )
            if block_end > bedtime:
                later_used = max(
                    later_used,
                    min(round((block_end - bedtime).total_seconds() / 60), later_limit),
                )
        actual_reduction = earlier_used + later_used
        if actual_reduction <= 0:
            continue
        summary.append(
            {
                "date": day.isoformat(),
                "preferred_minutes": preferred,
                "planned_minutes": preferred - actual_reduction,
                "reduction_minutes": actual_reduction,
                "minimum_minutes": preferences.minimum_sleep_minutes,
            }
        )
    return summary


def _exam_summary(
    db: DbSession,
    items: list[SchedulingItem],
    links: dict[str, tuple[uuid.UUID | None, uuid.UUID | None, str]],
    result: SchedulingResult,
) -> list[dict[str, object]]:
    scheduled = result.scheduled_minutes
    summary: list[dict[str, object]] = []
    for item in items:
        if item.kind != "exam_prep":
            continue
        task_id = links[item.id][0]
        task = db.get(Task, task_id) if task_id else None
        summary.append(
            {
                "task_id": task_id,
                "name": item.title,
                "deadline": item.due_at,
                "total_estimate_minutes": item.target_minutes,
                "remaining_prep_minutes": item.target_minutes - scheduled[item.id],
                "estimate_source": task.estimate_origin.value if task else "manual",
                "scheduled_prep_minutes": scheduled[item.id],
            }
        )
    return summary


def _flexible_adjustments(
    items: list[SchedulingItem], result: SchedulingResult
) -> list[dict[str, object]]:
    scheduled = result.scheduled_minutes
    return [
        {
            "id": item.id,
            "name": item.title,
            "requested_minutes": item.target_minutes,
            "scheduled_minutes": scheduled[item.id],
            "reduced_minutes": item.target_minutes - scheduled[item.id],
            "omitted": scheduled[item.id] == 0,
        }
        for item in items
        if item.kind in {"goal", "flexible_commitment"} and scheduled[item.id] < item.target_minutes
    ]


def _scheduling_items(
    db: DbSession,
    user_id: uuid.UUID,
    semester: Semester,
    horizon_start: date,
    horizon_end: date,
    preserved: list[ScheduledBlock],
    preferred_session_minutes: int,
    timezone: ZoneInfo,
    windows: list[SchedulingWindow],
    course_readiness: dict[uuid.UUID, CourseReadiness],
) -> tuple[
    list[SchedulingItem],
    dict[str, tuple[uuid.UUID | None, uuid.UUID | None, str]],
    list[str],
]:
    courses = list(db.scalars(select(Course).where(Course.semester_id == semester.id)))
    course_ids = {course.id for course in courses}
    course_codes = {course.id: course.code for course in courses}
    academic_items = list(
        db.scalars(select(AcademicItem).where(AcademicItem.course_id.in_(course_ids)))
    )
    academic_items_by_id = {item.id: item for item in academic_items}
    weights_by_item: dict[object, object] = {}
    for course in courses:
        course_items = [item for item in academic_items if item.course_id == course.id]
        groups = list(
            db.scalars(select(AssessmentGroup).where(AssessmentGroup.course_id == course.id))
        )
        schemes = list(
            db.scalars(select(GradingScheme).where(GradingScheme.course_id == course.id))
        )
        scheme_ids = [scheme.id for scheme in schemes]
        components = (
            list(
                db.scalars(
                    select(GradingSchemeComponent).where(
                        GradingSchemeComponent.grading_scheme_id.in_(scheme_ids)
                    )
                )
            )
            if scheme_ids
            else []
        )
        weights_by_item.update(calculate_weights(course_items, groups, schemes, components))
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
    preserved_goal_minutes_by_date: dict[tuple[uuid.UUID, date], int] = {}
    for block in preserved:
        minutes = round((block.end_at - block.start_at).total_seconds() / 60)
        if block.task_id:
            preserved_minutes[block.task_id] = preserved_minutes.get(block.task_id, 0) + minutes
        if block.goal_id:
            local_date = aware(block.start_at).astimezone(timezone).date()
            key = (block.goal_id, local_date)
            preserved_goal_minutes_by_date[key] = (
                preserved_goal_minutes_by_date.get(key, 0) + minutes
            )
    items: list[SchedulingItem] = []
    links: dict[str, tuple[uuid.UUID | None, uuid.UUID | None, str]] = {}
    warnings: list[str] = []
    invalid_deadlines: dict[str, list[tuple[str, date]]] = {}
    task_by_academic_item = {
        task.academic_item_id: task for task in tasks if task.academic_item_id is not None
    }
    active_exams_by_course: dict[uuid.UUID, list[tuple[AcademicItem, Task]]] = {}
    for academic_item in academic_items:
        exam_task = task_by_academic_item.get(academic_item.id)
        if (
            exam_task is None
            or academic_item.due_at is None
            or academic_item.item_type
            not in {AcademicItemType.midterm, AcademicItemType.final_exam}
        ):
            continue
        exam_due = aware(academic_item.due_at).astimezone(timezone)
        if horizon_start <= exam_due.date() <= horizon_end:
            active_exams_by_course.setdefault(academic_item.course_id, []).append(
                (academic_item, exam_task)
            )
    capacity_by_day: dict[date, int] = {}
    for window in windows:
        day = window.start_at.date()
        duration = round((window.end_at - window.start_at).total_seconds() / 60)
        raw = capacity_by_day.get(day, 0) + duration
        capacity_by_day[day] = min(
            raw,
            window.daily_capacity_minutes if window.daily_capacity_minutes is not None else raw,
        )
    for task in sorted(
        tasks,
        key=lambda value: (
            value.deadline_at is None,
            aware(value.deadline_at) if value.deadline_at else datetime.max.replace(tzinfo=UTC),
            value.name,
        ),
    ):
        if task.course_id is not None and task.course_id not in course_ids:
            continue
        if task.goal_id is not None and task.goal_id not in goal_ids:
            continue
        if task.deadline_at is None:
            warnings.append(f'"{task.name}" has no confirmed deadline and was not scheduled.')
            continue
        due_at = aware(task.deadline_at).astimezone(timezone)
        due_date = due_at.date()
        if task.course_id in course_ids and not (
            semester.start_date <= due_date <= semester.end_date
        ):
            course_code = course_codes.get(task.course_id, "Course")
            invalid_deadlines.setdefault(course_code, []).append((task.name, due_date))
            continue
        linked_item = (
            academic_items_by_id.get(task.academic_item_id) if task.academic_item_id else None
        )
        item_type = linked_item.item_type if linked_item else AcademicItemType.other
        is_exam = item_type in {AcademicItemType.midterm, AcademicItemType.final_exam}
        is_quiz = item_type == AcademicItemType.quiz
        is_assignment = item_type == AcademicItemType.assignment
        if is_exam and not (horizon_start <= due_date <= horizon_end):
            continue
        if is_exam and task.estimate_origin == EstimateOrigin.pending_exam:
            warnings.append(f'"{task.name}" needs a preparation estimate before scheduling.')
            continue
        if not is_assignment and not is_exam and not is_quiz and due_date > horizon_end:
            continue
        if is_quiz and due_date > horizon_end:
            continue

        earliest_start_at = datetime.combine(semester.start_date, time.min, tzinfo=timezone)
        readiness = course_readiness.get(task.course_id) if task.course_id else None
        if is_assignment:
            if readiness is None or readiness.ready_at is None:
                course_code = (
                    course_codes.get(task.course_id, "Course") if task.course_id else "Course"
                )
                warnings.append(
                    f'"{task.name}" is blocked because {course_code} has no confirmed '
                    "first lecture."
                )
                continue
            if due_at <= readiness.ready_at:
                warnings.append(
                    f'"{task.name}" is due before its course becomes ready; '
                    "correct the course data."
                )
                continue
            earliest_start_at = max(earliest_start_at, readiness.ready_at)

        exam_relationship: str | None = None
        active_course_exams = (
            active_exams_by_course.get(task.course_id, []) if task.course_id else []
        )
        active_course_exams.sort(key=lambda value: aware(value[0].due_at))  # type: ignore[arg-type]
        if is_assignment and active_course_exams:
            following_exam = next(
                (
                    exam
                    for exam, _exam_task in active_course_exams
                    if exam.due_at is not None and due_at <= aware(exam.due_at).astimezone(timezone)
                ),
                None,
            )
            if following_exam is not None:
                exam_relationship = "same_course_pre_exam"
            else:
                # Post-exam assignments re-enter only after the active exam task is complete.
                continue
        if task.earliest_start_at is not None:
            earliest_start_at = max(
                earliest_start_at, aware(task.earliest_start_at).astimezone(timezone)
            )
        if earliest_start_at.date() > horizon_end:
            continue
        remaining = max(task.remaining_minutes - preserved_minutes.get(task.id, 0), 0)
        if not remaining:
            continue
        overdue = due_date < horizon_start
        if overdue:
            warnings.append(
                f'"{task.name}" was due {due_date.isoformat()} and is being scheduled '
                "as overdue work."
            )
        target = remaining
        identifier = f"task:{task.id}"
        weight_result = weights_by_item.get(linked_item.id) if linked_item else None
        weight_percent = getattr(weight_result, "effective", None)
        weight_origin = getattr(weight_result, "origin", None)
        if weight_origin is not None and getattr(weight_origin, "value", "unknown") == "unknown":
            weight_percent = None
        preferred_completion_at = (
            due_at - timedelta(hours=24) if is_assignment and not overdue else due_at
        )
        capacity_deadline = max(preferred_completion_at, earliest_start_at)
        capacity_before_due = sum(
            minutes
            for day, minutes in capacity_by_day.items()
            if earliest_start_at.date() <= day <= min(capacity_deadline.date(), horizon_end)
        )
        slack_minutes = capacity_before_due - remaining
        urgent_48h = due_at <= datetime.combine(
            horizon_start + timedelta(days=2), time.min, tzinfo=timezone
        )
        if overdue:
            risk_tier = 5
        elif urgent_48h:
            risk_tier = 4
        elif exam_relationship:
            risk_tier = 3
        elif slack_minutes <= 0:
            risk_tier = 2
        else:
            risk_tier = 1
        importance_rank = (
            risk_tier * 1_000_000
            + max(100_000 - max(slack_minutes, -100_000), 0)
            + round(weight_percent or 0) * 100
            + PRIORITY_RANK[task.priority.value]
        )
        course_code = course_codes.get(task.course_id, "Course") if task.course_id else "Course"
        exam_name = "Final exam" if item_type == AcademicItemType.final_exam else "Midterm"
        title = (
            f"{course_code} · {exam_name} prep"
            if is_exam
            else f"{course_code} · Quiz prep"
            if is_quiz
            else f"{course_code} · {task.name}"
            if linked_item is not None
            else task.name
        )
        if is_assignment and due_date > horizon_end:
            kind = "distant_task"
        elif is_exam:
            kind = "exam_prep"
        else:
            kind = "task"
        scheduling_item = SchedulingItem(
            id=identifier,
            title=title,
            target_minutes=target,
            minimum_session_minutes=task.minimum_session_minutes,
            preferred_session_minutes=(
                min(
                    max(45, task.minimum_session_minutes),
                    task.maximum_session_minutes,
                )
                if is_exam
                else task.preferred_session_minutes
            ),
            maximum_session_minutes=task.maximum_session_minutes,
            priority_rank=PRIORITY_RANK[task.priority.value],
            intensity=task.intensity.value,
            kind=kind,
            importance_rank=importance_rank,
            due_at=due_at,
            earliest_start_at=max(
                earliest_start_at,
                datetime.combine(horizon_start, time.min, tzinfo=timezone),
            ),
            latest_end_at=None if overdue else due_at,
            required=task.required,
            risk_tier=risk_tier,
            slack_minutes=slack_minutes,
            weight_percent=weight_percent,
            exam_relationship=exam_relationship,
            readiness_at=readiness.ready_at if readiness else None,
            preferred_completion_at=preferred_completion_at,
        )
        items.append(scheduling_item)
        links[identifier] = (task.id, None, "focus")
    for course_code, invalid in sorted(invalid_deadlines.items()):
        examples = ", ".join(f"{name} ({deadline.isoformat()})" for name, deadline in invalid[:3])
        remainder = len(invalid) - 3
        suffix = f", plus {remainder} more" if remainder > 0 else ""
        warnings.append(
            f"{course_code} has {len(invalid)} "
            f"{'deadline' if len(invalid) == 1 else 'deadlines'} outside {semester.name} "
            f"({semester.start_date.isoformat()} to {semester.end_date.isoformat()}) and they were "
            f"not scheduled. Review the imported dates: {examples}{suffix}."
        )
    for goal in goals:
        if goal.id not in goal_ids:
            continue
        if goal.planning_kind == "flexible_commitment":
            rule = goal.schedule_rule or {}
            cadence = rule.get("cadence")
            target_minutes = rule.get("target_minutes")
            if not isinstance(target_minutes, int) or target_minutes <= 0:
                warnings.append(f'"{goal.name}" has an invalid flexible schedule target.')
                continue
            if cadence == "weekly":
                flexible_date_sets = _weekly_target_date_sets(horizon_start, horizon_end)
                targets = [
                    max(
                        target_minutes
                        - sum(
                            preserved_goal_minutes_by_date.get((goal.id, eligible_date), 0)
                            for eligible_date in eligible_dates
                        ),
                        0,
                    )
                    for eligible_dates in flexible_date_sets
                ]
            elif cadence == "selected_days":
                selected_days = rule.get("days_of_week")
                if not isinstance(selected_days, list):
                    warnings.append(f'"{goal.name}" has no selected scheduling days.')
                    continue
                matching_dates = [
                    horizon_start + timedelta(days=offset)
                    for offset in range((horizon_end - horizon_start).days + 1)
                    if (horizon_start + timedelta(days=offset)).weekday() in selected_days
                ]
                flexible_date_sets = [
                    frozenset({matching_date}) for matching_date in matching_dates
                ]
                targets = [
                    max(
                        target_minutes
                        - preserved_goal_minutes_by_date.get((goal.id, matching_date), 0),
                        0,
                    )
                    for matching_date in matching_dates
                ]
            else:
                warnings.append(f'"{goal.name}" has an unsupported flexible schedule rule.')
                continue
            for eligible_dates, target in zip(flexible_date_sets, targets, strict=True):
                if target <= 0:
                    continue
                first_eligible_date = min(eligible_dates)
                suffix = f":{first_eligible_date.isoformat()}"
                identifier = f"flex:{goal.id}{suffix}"
                items.append(
                    SchedulingItem(
                        identifier,
                        goal.name,
                        target,
                        min(15, preferred_session_minutes),
                        preferred_session_minutes,
                        max(120, preferred_session_minutes),
                        PRIORITY_RANK[goal.priority.value],
                        "moderate",
                        "flexible_commitment",
                        eligible_dates,
                    )
                )
                links[identifier] = (None, goal.id, "commitment")
            continue
        for eligible_dates in _weekly_target_date_sets(horizon_start, horizon_end):
            target = max(
                goal.preferred_weekly_minutes
                - sum(
                    preserved_goal_minutes_by_date.get((goal.id, eligible_date), 0)
                    for eligible_date in eligible_dates
                ),
                0,
            )
            if target <= 0:
                continue
            identifier = f"goal:{goal.id}:{min(eligible_dates).isoformat()}"
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
                    eligible_dates,
                )
            )
            links[identifier] = (None, goal.id, "goal")
    return items, links, warnings


def _weekly_target_date_sets(horizon_start: date, horizon_end: date) -> list[frozenset[date]]:
    """Split the rolling horizon into consecutive seven-day target buckets."""
    date_sets: list[frozenset[date]] = []
    week_start = horizon_start
    while week_start <= horizon_end:
        eligible_dates = frozenset(
            week_start + timedelta(days=offset)
            for offset in range(7)
            if week_start + timedelta(days=offset) <= horizon_end
        )
        if eligible_dates:
            date_sets.append(eligible_dates)
        week_start += timedelta(days=7)
    return date_sets


def _unscheduled_summary(
    items: list[SchedulingItem],
    scheduled_minutes: dict[str, int],
    links: dict[str, tuple[uuid.UUID | None, uuid.UUID | None, str]],
    windows: list[SchedulingWindow],
) -> list[dict[str, object]]:
    unresolved: list[dict[str, object]] = []
    flexible: dict[uuid.UUID, dict[str, object]] = {}
    for item in items:
        scheduled = scheduled_minutes[item.id]
        remaining = item.target_minutes - scheduled
        _, goal_id, block_type = links[item.id]
        if block_type in {"commitment", "goal"} and goal_id is not None:
            entry = flexible.setdefault(
                goal_id,
                {
                    "id": f"{'flex' if block_type == 'commitment' else 'goal'}:{goal_id}",
                    "name": item.title,
                    "requested_minutes": 0,
                    "scheduled_minutes": 0,
                    "remaining_minutes": 0,
                    "dates": [],
                },
            )
            entry["requested_minutes"] = cast(int, entry["requested_minutes"]) + item.target_minutes
            entry["scheduled_minutes"] = cast(int, entry["scheduled_minutes"]) + scheduled
            entry["remaining_minutes"] = cast(int, entry["remaining_minutes"]) + remaining
            if remaining > 0 and item.eligible_dates:
                dates = cast(list[str], entry["dates"])
                dates.extend(value.isoformat() for value in sorted(item.eligible_dates))
            continue
        if remaining > 0:
            reason_code, reason = _shortfall_reason(item, windows)
            unresolved.append(
                {
                    "id": item.id,
                    "name": item.title,
                    "deadline": item.due_at.isoformat() if item.due_at else None,
                    "requested_minutes": item.target_minutes,
                    "scheduled_minutes": scheduled,
                    "remaining_minutes": remaining,
                    "capacity_needed_minutes": remaining,
                    "blocking_constraints": [reason_code],
                    "reason_code": reason_code,
                    "reason": reason,
                }
            )
    for entry in flexible.values():
        dates = cast(list[str], entry.pop("dates"))
        if cast(int, entry["remaining_minutes"]) <= 0:
            continue
        entry["reason_code"] = "DAILY_CAPACITY_LIMIT"
        entry["reason"] = (
            f"The selected days reached their focus or protected free-time limit: "
            f"{', '.join(sorted(set(dates)))}."
            if dates
            else "Higher-priority work used the remaining focus capacity."
        )
        unresolved.append(entry)
    return unresolved


def _shortfall_reason(item: SchedulingItem, windows: list[SchedulingWindow]) -> tuple[str, str]:
    if item.latest_end_at is not None and windows:
        earliest_window = min(window.start_at for window in windows)
        if item.latest_end_at <= earliest_window:
            return "DEADLINE_PASSED", "Its confirmed deadline has already passed."
    compatible_dates = {
        window.start_at.date()
        for window in windows
        if item.eligible_dates is None or window.start_at.date() in item.eligible_dates
    }
    if item.eligible_dates is not None and not compatible_dates:
        return (
            "NO_ELIGIBLE_DAY",
            "Its selected weekdays have no opening inside the current focus hours.",
        )
    if item.kind in {"task", "exam_prep", "distant_task"}:
        return (
            "ACADEMIC_CAPACITY_LIMIT",
            "Earlier or higher-impact deadlines used the remaining eligible focus capacity.",
        )
    return (
        "DAILY_CAPACITY_LIMIT",
        "The available days reached their focus or protected free-time limit.",
    )


def _record_edit(proposal: ScheduleVersion) -> None:
    summary = dict(proposal.generation_summary or {})
    current = summary.get("moved_blocks", 0)
    summary["moved_blocks"] = (current if isinstance(current, int) else 0) + 1
    proposal.generation_summary = summary
