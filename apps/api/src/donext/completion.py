"""All completion arithmetic in one place. No router touches `remaining_minutes` directly.

Recompute, never patch: `apply_completion_state` derives `remaining_minutes` and `status` from a
task's full session set every time it is called, because the overrun rule below is not
associative - deleting a mistyped session cannot be undone by subtracting it back out.
"""

import hashlib
import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from donext import clock
from donext.effort_learning import update_effort_completion
from donext.models import (
    ScheduledBlock,
    ScheduleStatus,
    ScheduleVersion,
    Task,
    TaskStatus,
    WorkOutcome,
    WorkSession,
)
from donext.planning import aware


def block_fingerprint(anchor_id: uuid.UUID, start_at: datetime, end_at: datetime) -> str:
    """Identify a block by what it is (its task or goal, plus its times), not its row id.

    `_copy_preserved_blocks` copies `task_id`/`goal_id`, `start_at`, and `end_at` verbatim into
    every regenerated schedule version, so this fingerprint survives regeneration even though the
    block's row identifier does not.
    """

    payload = json.dumps(
        [
            str(anchor_id),
            aware(start_at).astimezone(UTC).isoformat(),
            aware(end_at).astimezone(UTC).isoformat(),
        ],
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def logged_minutes(db: Session, task_id: uuid.UUID) -> int:
    """The actual minutes logged against a task - independent of the plan of record."""

    return (
        db.scalar(
            select(func.coalesce(func.sum(WorkSession.minutes), 0)).where(
                WorkSession.task_id == task_id
            )
        )
        or 0
    )


def minutes_done(db: Session, task: Task) -> int:
    """How much of a task is done, for resizing its estimate.

    Backward compatible with tasks that predate sessions: the outer `max` keeps a legacy task's
    already-reduced `remaining_minutes` from being forgotten the first time its estimate is
    resized, while a task with logged sessions is read from them once they exist.
    """

    logged = logged_minutes(db, task.id)
    return max(logged, max(task.estimated_minutes - task.remaining_minutes, 0))


def apply_completion_state(db: Session, task: Task) -> None:
    """Recompute remaining work and status from the task's full session set.

    Every write path that touches a task's sessions - create, edit, delete, timer stop, and
    `/complete` - calls this afterward instead of writing `remaining_minutes` itself.
    """

    locked = db.scalar(select(Task).where(Task.id == task.id).with_for_update())
    assert locked is not None
    sessions = list(
        db.scalars(
            select(WorkSession)
            .where(WorkSession.task_id == locked.id)
            .order_by(WorkSession.local_date, WorkSession.created_at)
        )
    )
    logged = sum(session.minutes for session in sessions)
    # `not_started` rows are an answered "no" for rollover purposes, but they never decide
    # whether the work is finished.
    deciding = [session for session in sessions if session.outcome != WorkOutcome.not_started]
    finished = bool(deciding) and deciding[-1].outcome == WorkOutcome.finished

    if finished:
        locked.remaining_minutes = 0
        locked.status = TaskStatus.completed
        # Finishing early hands back the accepted time reserved for work that will not happen;
        # otherwise `_scheduling_items` drops the completed task but nothing prunes its future
        # blocks, and they sit on the calendar as phantoms.
        release_future_accepted_time(db, locked.user_id, locked)
    elif logged < locked.estimated_minutes:
        locked.remaining_minutes = max(locked.estimated_minutes - logged, 0)
        locked.status = TaskStatus.in_progress if logged > 0 else TaskStatus.pending
    else:
        # Clamping to zero would make finished-looking-but-unfinished work vanish from every
        # future plan (`_scheduling_items` keeps only `remaining_minutes > 0`). One preferred
        # session is a standing placeholder, recomputed identically every time, that keeps the
        # work visible and re-asks the question at the next check-in instead of inventing a
        # percentage markup.
        locked.remaining_minutes = locked.preferred_session_minutes
        locked.status = TaskStatus.in_progress

    update_effort_completion(
        db,
        locked,
        actual_minutes=logged,
        checked_in=finished,
        completed_on=deciding[-1].local_date if deciding else None,
    )


def release_future_accepted_time(db: Session, user_id: uuid.UUID, task: Task) -> tuple[int, int]:
    """Hand back the accepted-schedule time work was holding, and say how much that was.

    Used both when deactivating an academic item and when a task finishes early: either way, the
    blocks reserved for work that will not happen go with it. Time that has already begun is left
    alone - the student may have spent it, and a record of what happened is not the plan's to
    rewrite. Drafts are left alone: this change makes any open draft stale, so it is regenerated
    before it can be accepted anyway.
    """

    now = clock.now()
    blocks = list(
        db.scalars(
            select(ScheduledBlock)
            .join(ScheduleVersion, ScheduleVersion.id == ScheduledBlock.schedule_version_id)
            .where(
                ScheduledBlock.user_id == user_id,
                ScheduledBlock.task_id == task.id,
                ScheduleVersion.status == ScheduleStatus.accepted,
            )
        )
    )
    released_minutes = 0
    released_blocks = 0
    for block in blocks:
        if aware(block.start_at) <= now:
            continue
        released_minutes += round(
            (aware(block.end_at) - aware(block.start_at)).total_seconds() / 60
        )
        released_blocks += 1
        db.delete(block)
    return released_blocks, released_minutes
