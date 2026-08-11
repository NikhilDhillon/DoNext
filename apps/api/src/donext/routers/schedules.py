import uuid
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from donext.dependencies import CurrentUser, DbSession
from donext.errors import ApiError
from donext.models import Course, ScheduledBlock, ScheduleStatus, ScheduleVersion, Semester, User
from donext.routers.events import owned_event
from donext.routers.goals import owned_goal
from donext.routers.semesters import owned_semester
from donext.routers.tasks import owned_task
from donext.schemas import ScheduleBlockCreate, ScheduleBlockRead, ScheduleBlockUpdate, ScheduleRead

router = APIRouter(tags=["schedules"])


def user_timezone(user: User) -> ZoneInfo:
    try:
        return ZoneInfo(user.timezone)
    except ZoneInfoNotFoundError as error:
        raise ApiError("VALIDATION_ERROR", "The account timezone is not supported.", 422) from error


def accepted_schedule(
    db: DbSession, user_id: uuid.UUID, semester_id: uuid.UUID
) -> ScheduleVersion | None:
    return db.scalar(
        select(ScheduleVersion)
        .where(
            ScheduleVersion.user_id == user_id,
            ScheduleVersion.semester_id == semester_id,
            ScheduleVersion.status == ScheduleStatus.accepted,
        )
        .options(selectinload(ScheduleVersion.blocks))
    )


def owned_block(db: DbSession, user_id: uuid.UUID, block_id: uuid.UUID) -> ScheduledBlock:
    block = db.scalar(
        select(ScheduledBlock).where(
            ScheduledBlock.id == block_id,
            ScheduledBlock.user_id == user_id,
        )
    )
    if block is None:
        raise ApiError("NOT_FOUND", "Schedule block not found.", 404)
    return block


def validate_links(
    db: DbSession,
    user_id: uuid.UUID,
    semester_id: uuid.UUID,
    task_id: uuid.UUID | None,
    fixed_event_id: uuid.UUID | None,
    goal_id: uuid.UUID | None,
) -> None:
    if sum(value is not None for value in (task_id, fixed_event_id, goal_id)) > 1:
        raise ApiError("VALIDATION_ERROR", "A schedule block can link to only one resource.", 422)
    if task_id:
        task = owned_task(db, user_id, task_id)
        if task.course_id:
            course_semester_id = db.scalar(
                select(Course.semester_id).where(Course.id == task.course_id)
            )
            if course_semester_id != semester_id:
                raise ApiError("VALIDATION_ERROR", "The task belongs to another semester.", 422)
    if fixed_event_id:
        event = owned_event(db, user_id, fixed_event_id)
        if event.semester_id is not None and event.semester_id != semester_id:
            raise ApiError("VALIDATION_ERROR", "The event belongs to another semester.", 422)
    if goal_id:
        goal = owned_goal(db, user_id, goal_id)
        if goal.semester_id is not None and goal.semester_id != semester_id:
            raise ApiError("VALIDATION_ERROR", "The goal belongs to another semester.", 422)


def validate_times(
    db: DbSession,
    user: User,
    semester: Semester,
    schedule_id: uuid.UUID,
    start_at: datetime,
    end_at: datetime,
    excluding_block_id: uuid.UUID | None = None,
) -> None:
    if start_at.tzinfo is None or end_at.tzinfo is None:
        raise ApiError(
            "VALIDATION_ERROR", "Schedule block timestamps must include a timezone.", 422
        )
    if end_at <= start_at:
        raise ApiError("VALIDATION_ERROR", "Schedule block end time must follow its start.", 422)
    timezone = user_timezone(user)
    local_start = start_at.astimezone(timezone).date()
    local_end = end_at.astimezone(timezone).date()
    if local_start < semester.start_date or local_end > semester.end_date:
        raise ApiError("VALIDATION_ERROR", "The schedule block must fall within its semester.", 422)

    overlap_query = select(ScheduledBlock.id).where(
        ScheduledBlock.schedule_version_id == schedule_id,
        ScheduledBlock.locked.is_(True),
        ScheduledBlock.start_at < end_at,
        ScheduledBlock.end_at > start_at,
    )
    if excluding_block_id:
        overlap_query = overlap_query.where(ScheduledBlock.id != excluding_block_id)
    if db.scalar(overlap_query) is not None:
        raise ApiError("SCHEDULE_CONFLICT", "That time overlaps a locked schedule block.", 409)


def create_manual_schedule(
    db: DbSession, user_id: uuid.UUID, semester_id: uuid.UUID
) -> ScheduleVersion:
    latest_version = db.scalar(
        select(func.max(ScheduleVersion.version_number)).where(ScheduleVersion.user_id == user_id)
    )
    schedule = ScheduleVersion(
        user_id=user_id,
        semester_id=semester_id,
        version_number=(latest_version or 0) + 1,
        reason="Manual planning",
        status=ScheduleStatus.accepted,
        accepted_at=datetime.now(UTC),
    )
    db.add(schedule)
    db.flush()
    return schedule


@router.get("/semesters/{semester_id}/schedule", response_model=ScheduleRead | None)
def get_schedule(
    semester_id: uuid.UUID, db: DbSession, current_user: CurrentUser
) -> ScheduleVersion | None:
    owned_semester(db, current_user.id, semester_id)
    return accepted_schedule(db, current_user.id, semester_id)


@router.post(
    "/semesters/{semester_id}/schedule/blocks",
    response_model=ScheduleBlockRead,
    status_code=201,
)
def create_schedule_block(
    semester_id: uuid.UUID,
    payload: ScheduleBlockCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> ScheduledBlock:
    semester = owned_semester(db, current_user.id, semester_id)
    validate_links(
        db,
        current_user.id,
        semester_id,
        payload.task_id,
        payload.fixed_event_id,
        payload.goal_id,
    )
    schedule = accepted_schedule(db, current_user.id, semester_id)
    if schedule is None:
        schedule = create_manual_schedule(db, current_user.id, semester_id)
    validate_times(db, current_user, semester, schedule.id, payload.start_at, payload.end_at)
    block = ScheduledBlock(
        schedule_version_id=schedule.id,
        user_id=current_user.id,
        source="manual",
        stability_weight=1.0,
        **payload.model_dump(),
    )
    db.add(block)
    db.commit()
    db.refresh(block)
    return block


@router.patch("/schedule-blocks/{block_id}", response_model=ScheduleBlockRead)
def update_schedule_block(
    block_id: uuid.UUID,
    payload: ScheduleBlockUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> ScheduledBlock:
    block = owned_block(db, current_user.id, block_id)
    schedule = db.get(ScheduleVersion, block.schedule_version_id)
    if schedule is None or schedule.status != ScheduleStatus.accepted:
        raise ApiError("SCHEDULE_NOT_EDITABLE", "Only the accepted schedule can be edited.", 409)
    semester = owned_semester(db, current_user.id, schedule.semester_id)
    values = payload.model_dump(exclude_unset=True)
    task_id = values.get("task_id", block.task_id)
    fixed_event_id = values.get("fixed_event_id", block.fixed_event_id)
    goal_id = values.get("goal_id", block.goal_id)
    validate_links(db, current_user.id, semester.id, task_id, fixed_event_id, goal_id)
    start_at = values.get("start_at", block.start_at)
    end_at = values.get("end_at", block.end_at)
    validate_times(db, current_user, semester, schedule.id, start_at, end_at, block.id)
    for field, value in values.items():
        setattr(block, field, value)
    db.commit()
    db.refresh(block)
    return block


@router.delete("/schedule-blocks/{block_id}", status_code=204)
def delete_schedule_block(block_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> None:
    block = owned_block(db, current_user.id, block_id)
    schedule_status = db.scalar(
        select(ScheduleVersion.status).where(ScheduleVersion.id == block.schedule_version_id)
    )
    if schedule_status != ScheduleStatus.accepted:
        raise ApiError("SCHEDULE_NOT_EDITABLE", "Only the accepted schedule can be edited.", 409)
    db.delete(block)
    db.commit()
