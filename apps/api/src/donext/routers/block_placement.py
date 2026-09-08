import uuid
from datetime import UTC, date, datetime, time, timedelta

from fastapi import APIRouter
from pydantic import Field
from sqlalchemy import select

from donext.dependencies import CurrentUser, DbSession
from donext.errors import ApiError
from donext.models import AvailabilityWindow, FixedEvent, UserPreference
from donext.planning import aware, expand_events, resolve_timezone, subtract_intervals
from donext.routers.proposals import (
    _planning_now,
    _scheduling_windows,
    create_proposal_block,
    owned_proposal,
)
from donext.routers.schedules import accepted_schedule, create_schedule_block
from donext.routers.semesters import owned_semester
from donext.schemas import ApiModel, ScheduleBlockCreate, ScheduleBlockRead

router = APIRouter(tags=["schedules"])


class BlockPlacementRequest(ApiModel):
    day: date
    duration_minutes: int = Field(ge=1, le=1440)
    proposal_id: uuid.UUID | None = None


class BlockPlacementRead(ApiModel):
    start_at: datetime
    end_at: datetime
    timezone: str


class DurationBlockCreate(ScheduleBlockCreate):
    day: date
    duration_minutes: int = Field(ge=1, le=1440)
    proposal_id: uuid.UUID | None = None


@router.post(
    "/semesters/{semester_id}/schedule/block-placement",
    response_model=BlockPlacementRead,
)
def preview_block_placement(
    semester_id: uuid.UUID,
    payload: BlockPlacementRequest,
    db: DbSession,
    current_user: CurrentUser,
) -> BlockPlacementRead:
    """Find one continuous opening without changing or moving anything."""
    semester = owned_semester(db, current_user.id, semester_id)
    if not semester.start_date <= payload.day <= semester.end_date:
        raise ApiError("VALIDATION_ERROR", "Choose a date within this semester.", 422)
    schedule = (
        owned_proposal(db, current_user.id, payload.proposal_id)
        if payload.proposal_id
        else accepted_schedule(db, current_user.id, semester_id)
    )
    if schedule and schedule.semester_id != semester_id:
        raise ApiError("NOT_FOUND", "Schedule not found in this semester.", 404)
    if (
        payload.proposal_id
        and schedule
        and (
            schedule.horizon_start is None
            or schedule.horizon_end is None
            or not schedule.horizon_start <= payload.day <= schedule.horizon_end
        )
    ):
        raise ApiError("VALIDATION_ERROR", "Choose a date within this draft.", 422)
    preferences = db.scalar(select(UserPreference).where(UserPreference.user_id == current_user.id))
    if preferences is None:
        raise ApiError("NOT_FOUND", "Planning preferences not found.", 404)
    timezone = resolve_timezone(current_user.timezone)
    now = _planning_now().astimezone(timezone)
    availability = list(
        db.scalars(select(AvailabilityWindow).where(AvailabilityWindow.user_id == current_user.id))
    )
    events = list(db.scalars(select(FixedEvent).where(FixedEvent.user_id == current_user.id)))
    occurrences, warnings = expand_events(
        events, payload.day, payload.day + timedelta(days=1), timezone
    )
    if warnings:
        raise ApiError("SCHEDULER_INPUT_INCOMPLETE", warnings[0], 422)
    blocks = list(schedule.blocks) if schedule else []
    windows = _scheduling_windows(
        payload.day, payload.day, availability, occurrences, blocks, preferences, timezone, now
    )
    day_start = datetime.combine(payload.day, time.min, tzinfo=timezone)
    day_end = datetime.combine(payload.day + timedelta(days=1), time.min, tzinfo=timezone)
    used_minutes = sum(
        max(
            0,
            round(
                (
                    min(aware(block.end_at), day_end) - max(aware(block.start_at), day_start)
                ).total_seconds()
                / 60
            ),
        )
        for block in blocks
        if block.block_type in {"focus", "goal", "commitment"}
    )
    capacity = min(
        max(0, preferences.maximum_daily_focus_minutes - used_minutes),
        max((window.daily_capacity_minutes or 0 for window in windows), default=0),
    )
    gap = timedelta(minutes=preferences.minimum_break_minutes)
    openings = subtract_intervals(
        [(window.start_at, window.end_at) for window in windows],
        [(aware(block.start_at) - gap, aware(block.end_at) + gap) for block in blocks],
    )
    if payload.duration_minutes <= capacity:
        for start, end in openings:
            # Round forward to the next whole minute, never back into elapsed time.
            start = start.replace(second=0, microsecond=0) + (
                timedelta(minutes=1) if start.second or start.microsecond else timedelta()
            )
            end_at = start.astimezone(UTC) + timedelta(minutes=payload.duration_minutes)
            if end_at <= end.astimezone(UTC):
                return BlockPlacementRead(
                    start_at=start.astimezone(UTC), end_at=end_at, timezone=current_user.timezone
                )
    raise ApiError(
        "NO_BLOCK_SPACE",
        "No continuous opening fits that duration on this day. "
        "Choose another date or a shorter duration. Existing blocks will stay in place.",
        409,
    )


@router.post(
    "/semesters/{semester_id}/schedule/duration-blocks",
    response_model=ScheduleBlockRead,
    status_code=201,
)
def create_duration_block(
    semester_id: uuid.UUID,
    payload: DurationBlockCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> ScheduleBlockRead:
    placement = preview_block_placement(
        semester_id,
        BlockPlacementRequest(
            day=payload.day,
            duration_minutes=payload.duration_minutes,
            proposal_id=payload.proposal_id,
        ),
        db,
        current_user,
    )
    if placement.start_at != payload.start_at or placement.end_at != payload.end_at:
        raise ApiError(
            "BLOCK_PLACEMENT_CHANGED",
            "The available time changed. "
            "Choose the date or duration again to refresh the suggestion.",
            409,
        )
    block_payload = ScheduleBlockCreate.model_validate(
        payload.model_dump(exclude={"day", "duration_minutes", "proposal_id"})
    )
    block_payload.start_at = placement.start_at.astimezone(UTC)
    block_payload.end_at = placement.end_at.astimezone(UTC)
    block = (
        create_proposal_block(payload.proposal_id, block_payload, db, current_user)
        if payload.proposal_id
        else create_schedule_block(semester_id, block_payload, db, current_user)
    )
    return ScheduleBlockRead.model_validate(block)
