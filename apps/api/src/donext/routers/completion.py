import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from donext import clock
from donext.completion import apply_completion_state, block_fingerprint
from donext.dependencies import CurrentUser, DbSession
from donext.errors import ApiError
from donext.models import WorkLogSource, WorkOutcome, WorkSession, WorkTimer
from donext.planning import aware, resolve_timezone
from donext.routers.goals import owned_goal
from donext.routers.schedules import owned_block
from donext.routers.tasks import owned_task
from donext.schemas import (
    WorkSessionCreate,
    WorkSessionRead,
    WorkSessionUpdate,
    WorkTimerRead,
    WorkTimerStart,
    WorkTimerStop,
)

router = APIRouter(tags=["completion"])


def owned_work_session(db: DbSession, user_id: uuid.UUID, session_id: uuid.UUID) -> WorkSession:
    session = db.scalar(
        select(WorkSession).where(WorkSession.id == session_id, WorkSession.user_id == user_id)
    )
    if session is None:
        raise ApiError("NOT_FOUND", "Work session not found.", 404)
    return session


def _validate_not_future(current_user: CurrentUser, local_date: date) -> None:
    today = clock.now().astimezone(resolve_timezone(current_user.timezone)).date()
    if local_date > today:
        raise ApiError(
            "VALIDATION_ERROR", "A work session cannot be logged for a future date.", 422
        )


@router.post("/work-sessions", response_model=WorkSessionRead, status_code=201)
def create_work_session(
    payload: WorkSessionCreate,
    response: Response,
    db: DbSession,
    current_user: CurrentUser,
) -> WorkSession:
    _validate_not_future(current_user, payload.local_date)
    task = owned_task(db, current_user.id, payload.task_id) if payload.task_id else None
    goal = owned_goal(db, current_user.id, payload.goal_id) if payload.goal_id else None
    block = (
        owned_block(db, current_user.id, payload.scheduled_block_id)
        if payload.scheduled_block_id
        else None
    )
    if block is not None and (
        (task is not None and block.task_id != task.id)
        or (goal is not None and block.goal_id != goal.id)
    ):
        raise ApiError(
            "VALIDATION_ERROR", "The scheduled block does not belong to this task or goal.", 422
        )

    anchor_id = task.id if task is not None else goal.id  # type: ignore[union-attr]
    fingerprint = (
        block_fingerprint(anchor_id, block.start_at, block.end_at) if block is not None else None
    )
    existing = (
        db.scalar(
            select(WorkSession).where(
                WorkSession.user_id == current_user.id,
                WorkSession.block_fingerprint == fingerprint,
            )
        )
        if fingerprint is not None
        else None
    )

    if existing is not None:
        previous_minutes = existing.minutes
        existing.local_date = payload.local_date
        existing.minutes = payload.minutes
        existing.outcome = payload.outcome
        existing.source = payload.source
        existing.started_at = payload.started_at
        existing.ended_at = payload.ended_at
        session = existing
        response.status_code = 200
        delta = payload.minutes - previous_minutes
    else:
        session = WorkSession(
            user_id=current_user.id,
            task_id=payload.task_id,
            goal_id=payload.goal_id,
            local_date=payload.local_date,
            minutes=payload.minutes,
            outcome=payload.outcome,
            source=payload.source,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
            scheduled_block_id=payload.scheduled_block_id,
            block_fingerprint=fingerprint,
        )
        db.add(session)
        delta = payload.minutes

    db.flush()
    if task is not None:
        # A goal session advances progress instead; the remaining-minutes accounting below is
        # academic-effort-only.
        apply_completion_state(db, task)
    elif goal is not None:
        goal.current_progress = (goal.current_progress or 0) + delta
    db.commit()
    db.refresh(session)
    return session


@router.patch("/work-sessions/{session_id}", response_model=WorkSessionRead)
def update_work_session(
    session_id: uuid.UUID,
    payload: WorkSessionUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> WorkSession:
    session = owned_work_session(db, current_user.id, session_id)
    previous_minutes = session.minutes
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(session, field, value)
    if session.outcome == WorkOutcome.not_started and session.minutes != 0:
        raise ApiError("VALIDATION_ERROR", "An unanswered block cannot carry logged minutes.", 422)
    if session.started_at and session.ended_at and session.ended_at <= session.started_at:
        raise ApiError("VALIDATION_ERROR", "ended_at must follow started_at.", 422)
    db.flush()
    if session.task_id is not None:
        task = owned_task(db, current_user.id, session.task_id)
        apply_completion_state(db, task)
    else:
        assert session.goal_id is not None
        goal = owned_goal(db, current_user.id, session.goal_id)
        goal.current_progress = (goal.current_progress or 0) + (session.minutes - previous_minutes)
    db.commit()
    db.refresh(session)
    return session


@router.delete("/work-sessions/{session_id}", status_code=204)
def delete_work_session(session_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> None:
    session = owned_work_session(db, current_user.id, session_id)
    task_id, goal_id, minutes = session.task_id, session.goal_id, session.minutes
    db.delete(session)
    db.flush()
    if task_id is not None:
        task = owned_task(db, current_user.id, task_id)
        apply_completion_state(db, task)
    else:
        assert goal_id is not None
        goal = owned_goal(db, current_user.id, goal_id)
        goal.current_progress = max((goal.current_progress or 0) - minutes, 0)
    db.commit()


@router.get("/work-sessions", response_model=list[WorkSessionRead])
def list_work_sessions(
    db: DbSession,
    current_user: CurrentUser,
    date: Annotated[date | None, Query()] = None,
) -> list[WorkSession]:
    query = select(WorkSession).where(WorkSession.user_id == current_user.id)
    if date is not None:
        query = query.where(WorkSession.local_date == date)
    query = query.order_by(WorkSession.local_date.desc(), WorkSession.created_at.desc())
    return list(db.scalars(query))


@router.post("/work-timer", response_model=WorkTimerRead, status_code=201)
def start_work_timer(
    payload: WorkTimerStart,
    db: DbSession,
    current_user: CurrentUser,
) -> WorkTimer:
    task = owned_task(db, current_user.id, payload.task_id)
    block = (
        owned_block(db, current_user.id, payload.scheduled_block_id)
        if payload.scheduled_block_id
        else None
    )
    if block is not None and block.task_id != task.id:
        raise ApiError("VALIDATION_ERROR", "The scheduled block does not belong to this task.", 422)
    fingerprint = (
        block_fingerprint(task.id, block.start_at, block.end_at) if block is not None else None
    )
    timer = WorkTimer(
        user_id=current_user.id,
        task_id=task.id,
        started_at=clock.now(),
        scheduled_block_id=payload.scheduled_block_id,
        block_fingerprint=fingerprint,
    )
    db.add(timer)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        running = db.scalar(select(WorkTimer).where(WorkTimer.user_id == current_user.id))
        raise ApiError(
            "TIMER_ALREADY_RUNNING",
            "A timer is already running.",
            409,
            {
                "timer": {
                    "id": str(running.id),
                    "task_id": str(running.task_id),
                    "started_at": running.started_at.isoformat(),
                }
            }
            if running is not None
            else None,
        ) from error
    db.refresh(timer)
    return timer


@router.get("/work-timer", response_model=WorkTimerRead | None)
def get_work_timer(db: DbSession, current_user: CurrentUser) -> WorkTimer | None:
    return db.scalar(select(WorkTimer).where(WorkTimer.user_id == current_user.id))


@router.delete("/work-timer", status_code=204)
def discard_work_timer(db: DbSession, current_user: CurrentUser) -> None:
    timer = db.scalar(select(WorkTimer).where(WorkTimer.user_id == current_user.id))
    if timer is None:
        raise ApiError("NOT_FOUND", "No timer is running.", 404)
    db.delete(timer)
    db.commit()


@router.post("/work-timer/stop", response_model=WorkSessionRead)
def stop_work_timer(
    payload: WorkTimerStop,
    db: DbSession,
    current_user: CurrentUser,
) -> WorkSession:
    timer = db.scalar(select(WorkTimer).where(WorkTimer.user_id == current_user.id))
    if timer is None:
        raise ApiError("NOT_FOUND", "No timer is running.", 404)
    task = owned_task(db, current_user.id, timer.task_id)
    now = clock.now()
    started_at = aware(timer.started_at)
    elapsed = max(round((now - started_at).total_seconds() / 60), 0)
    minutes = payload.minutes if payload.minutes is not None else min(elapsed, 1440)
    if payload.outcome == WorkOutcome.not_started and minutes != 0:
        raise ApiError("VALIDATION_ERROR", "An unanswered block cannot carry logged minutes.", 422)
    local_date = started_at.astimezone(resolve_timezone(current_user.timezone)).date()

    fingerprint = timer.block_fingerprint
    existing = (
        db.scalar(
            select(WorkSession).where(
                WorkSession.user_id == current_user.id,
                WorkSession.block_fingerprint == fingerprint,
            )
        )
        if fingerprint is not None
        else None
    )
    if existing is not None:
        existing.local_date = local_date
        existing.minutes = minutes
        existing.outcome = payload.outcome
        existing.source = WorkLogSource.timer
        existing.started_at = timer.started_at
        existing.ended_at = now
        existing.scheduled_block_id = timer.scheduled_block_id
        session = existing
    else:
        session = WorkSession(
            user_id=current_user.id,
            task_id=timer.task_id,
            local_date=local_date,
            minutes=minutes,
            outcome=payload.outcome,
            source=WorkLogSource.timer,
            started_at=timer.started_at,
            ended_at=now,
            scheduled_block_id=timer.scheduled_block_id,
            block_fingerprint=fingerprint,
        )
        db.add(session)
    db.delete(timer)
    db.flush()
    apply_completion_state(db, task)
    db.commit()
    db.refresh(session)
    return session
