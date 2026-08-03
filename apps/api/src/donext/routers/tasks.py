import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select

from donext.dependencies import CurrentUser, DbSession
from donext.errors import ApiError
from donext.models import Task, TaskStatus
from donext.routers.courses import owned_course
from donext.schemas import TaskCreate, TaskRead, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])


def owned_task(db: DbSession, user_id: uuid.UUID, task_id: uuid.UUID) -> Task:
    task = db.scalar(select(Task).where(Task.id == task_id, Task.user_id == user_id))
    if task is None:
        raise ApiError("NOT_FOUND", "Task not found.", 404)
    return task


def validate_task_links(
    db: DbSession,
    user_id: uuid.UUID,
    course_id: uuid.UUID | None,
    goal_id: uuid.UUID | None,
    parent_task_id: uuid.UUID | None,
) -> None:
    if course_id:
        owned_course(db, user_id, course_id)
    if goal_id:
        from donext.routers.goals import owned_goal

        owned_goal(db, user_id, goal_id)
    if parent_task_id:
        owned_task(db, user_id, parent_task_id)


@router.get("", response_model=list[TaskRead])
def list_tasks(
    db: DbSession,
    current_user: CurrentUser,
    status: Annotated[TaskStatus | None, Query()] = None,
) -> list[Task]:
    query = select(Task).where(Task.user_id == current_user.id)
    if status:
        query = query.where(Task.status == status)
    query = query.order_by(Task.deadline_at.asc().nullslast(), Task.created_at.desc())
    return list(db.scalars(query))


@router.post("", response_model=TaskRead, status_code=201)
def create_task(payload: TaskCreate, db: DbSession, current_user: CurrentUser) -> Task:
    validate_task_links(
        db, current_user.id, payload.course_id, payload.goal_id, payload.parent_task_id
    )
    values = payload.model_dump()
    if values["remaining_minutes"] is None:
        values["remaining_minutes"] = payload.estimated_minutes
    task = Task(user_id=current_user.id, **values)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.get("/{task_id}", response_model=TaskRead)
def get_task(task_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> Task:
    return owned_task(db, current_user.id, task_id)


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(
    task_id: uuid.UUID,
    payload: TaskUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> Task:
    task = owned_task(db, current_user.id, task_id)
    values = payload.model_dump(exclude_unset=True)
    validate_task_links(
        db,
        current_user.id,
        values.get("course_id", task.course_id),
        values.get("goal_id", task.goal_id),
        values.get("parent_task_id", task.parent_task_id),
    )
    if values.get("parent_task_id") == task.id:
        raise ApiError("VALIDATION_ERROR", "A task cannot be its own parent.", 422)
    minimum = values.get("minimum_session_minutes", task.minimum_session_minutes)
    preferred = values.get("preferred_session_minutes", task.preferred_session_minutes)
    maximum = values.get("maximum_session_minutes", task.maximum_session_minutes)
    if not minimum <= preferred <= maximum:
        raise ApiError("VALIDATION_ERROR", "Task session lengths are inconsistent.", 422)
    earliest = values.get("earliest_start_at", task.earliest_start_at)
    deadline = values.get("deadline_at", task.deadline_at)
    if earliest and deadline and deadline <= earliest:
        raise ApiError("VALIDATION_ERROR", "Task deadline must follow its start time.", 422)
    for field, value in values.items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> None:
    task = owned_task(db, current_user.id, task_id)
    db.delete(task)
    db.commit()


@router.post("/{task_id}/complete", response_model=TaskRead)
def complete_task(task_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> Task:
    task = owned_task(db, current_user.id, task_id)
    task.status = TaskStatus.completed
    task.remaining_minutes = 0
    db.commit()
    db.refresh(task)
    return task
