import uuid
from typing import cast

from fastapi import APIRouter
from sqlalchemy import select

from donext.dependencies import CurrentUser, DbSession
from donext.errors import ApiError
from donext.models import Goal, GoalStatus
from donext.routers.semesters import owned_semester
from donext.schemas import GoalCreate, GoalRead, GoalUpdate

router = APIRouter(prefix="/goals", tags=["goals"])


def _schedule_weekly_minutes(rule: dict[str, object]) -> int:
    target = cast(int, rule["target_minutes"])
    if rule["cadence"] == "selected_days":
        return target * len(cast(list[object], rule["days_of_week"]))
    return target


def _normalize_flexible_effort(values: dict[str, object]) -> None:
    rule = values.get("schedule_rule")
    if not isinstance(rule, dict):
        raise ApiError(
            "VALIDATION_ERROR",
            "Flexible commitments need either weekly hours or hours on selected days.",
            422,
        )
    weekly_minutes = _schedule_weekly_minutes(rule)
    values.update(
        minimum_weekly_minutes=0,
        preferred_weekly_minutes=weekly_minutes,
        maximum_weekly_minutes=weekly_minutes,
        maintenance_weekly_minutes=0,
        reducible_during_busy_weeks=True,
    )


def owned_goal(db: DbSession, user_id: uuid.UUID, goal_id: uuid.UUID) -> Goal:
    goal = db.scalar(select(Goal).where(Goal.id == goal_id, Goal.user_id == user_id))
    if goal is None:
        raise ApiError("NOT_FOUND", "Goal not found.", 404)
    return goal


@router.get("", response_model=list[GoalRead])
def list_goals(db: DbSession, current_user: CurrentUser) -> list[Goal]:
    return list(
        db.scalars(
            select(Goal)
            .where(Goal.user_id == current_user.id)
            .order_by(Goal.status.asc(), Goal.created_at.desc())
        )
    )


@router.post("", response_model=GoalRead, status_code=201)
def create_goal(payload: GoalCreate, db: DbSession, current_user: CurrentUser) -> Goal:
    if payload.semester_id:
        owned_semester(db, current_user.id, payload.semester_id)
    values = payload.model_dump()
    if payload.planning_kind == "flexible_commitment":
        _normalize_flexible_effort(values)
    goal = Goal(user_id=current_user.id, **values)
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


@router.get("/{goal_id}", response_model=GoalRead)
def get_goal(goal_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> Goal:
    return owned_goal(db, current_user.id, goal_id)


@router.patch("/{goal_id}", response_model=GoalRead)
def update_goal(
    goal_id: uuid.UUID,
    payload: GoalUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> Goal:
    goal = owned_goal(db, current_user.id, goal_id)
    values = payload.model_dump(exclude_unset=True)
    semester_id = values.get("semester_id", goal.semester_id)
    if semester_id:
        owned_semester(db, current_user.id, semester_id)
    planning_kind = values.get("planning_kind", goal.planning_kind)
    if planning_kind == "flexible_commitment":
        if "schedule_rule" not in values:
            values["schedule_rule"] = goal.schedule_rule
        _normalize_flexible_effort(values)
    elif planning_kind == "goal":
        values["schedule_rule"] = None
    minimum = values.get("minimum_weekly_minutes", goal.minimum_weekly_minutes)
    preferred = values.get("preferred_weekly_minutes", goal.preferred_weekly_minutes)
    maximum = values.get("maximum_weekly_minutes", goal.maximum_weekly_minutes)
    if not minimum <= preferred <= maximum:
        raise ApiError("VALIDATION_ERROR", "Goal weekly effort is inconsistent.", 422)
    start_date = values.get("start_date", goal.start_date)
    target_date = values.get("target_date", goal.target_date)
    if target_date and target_date < start_date:
        raise ApiError("VALIDATION_ERROR", "Goal target date precedes its start.", 422)
    for field, value in values.items():
        setattr(goal, field, value)
    db.commit()
    db.refresh(goal)
    return goal


@router.delete("/{goal_id}", status_code=204)
def delete_goal(goal_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> None:
    goal = owned_goal(db, current_user.id, goal_id)
    db.delete(goal)
    db.commit()


@router.post("/{goal_id}/pause", response_model=GoalRead)
def pause_goal(goal_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> Goal:
    goal = owned_goal(db, current_user.id, goal_id)
    goal.status = GoalStatus.paused
    db.commit()
    db.refresh(goal)
    return goal


@router.post("/{goal_id}/resume", response_model=GoalRead)
def resume_goal(goal_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> Goal:
    goal = owned_goal(db, current_user.id, goal_id)
    goal.status = GoalStatus.active
    db.commit()
    db.refresh(goal)
    return goal
