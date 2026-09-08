import uuid
from typing import cast

from fastapi import APIRouter
from sqlalchemy import select

from donext.dependencies import CurrentUser, DbSession
from donext.errors import ApiError
from donext.models import Goal, Task, UserPreference
from donext.schedule_revision import (
    ScheduleRevisionPolicy,
    describe_policy,
    read_remembered_policy,
)
from donext.schemas import UserPreferenceRead, UserPreferenceUpdate, sleep_window_minutes

router = APIRouter(prefix="/preferences", tags=["preferences"])


def current_preferences(db: DbSession, user_id: uuid.UUID) -> UserPreference:
    preferences = db.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
    if preferences is None:
        raise ApiError("NOT_FOUND", "Planning preferences not found.", 404)
    return preferences


def preferences_read(db: DbSession, preferences: UserPreference) -> UserPreferenceRead:
    read = UserPreferenceRead.model_validate(preferences)
    policy = read_remembered_policy(
        cast(dict[str, object] | None, preferences.schedule_revision_policy)
    )
    if policy is None:
        return read
    return read.model_copy(
        update={
            "remembered_schedule_preferences": describe_policy(
                policy, _activity_names(db, preferences.user_id, policy)
            )
        }
    )


def _activity_names(
    db: DbSession, user_id: uuid.UUID, policy: ScheduleRevisionPolicy
) -> dict[str, str]:
    """Resolve the "task:<id>" and "goal:<id>" ids a remembered range can be scoped to."""
    task_ids: set[uuid.UUID] = set()
    goal_ids: set[uuid.UUID] = set()
    for value in (*policy.avoid_time_ranges, *policy.preferred_time_ranges):
        kind, _, raw = (value.activity or "").partition(":")
        try:
            identifier = uuid.UUID(raw)
        except ValueError:
            continue
        if kind == "task":
            task_ids.add(identifier)
        elif kind == "goal":
            goal_ids.add(identifier)
    names: dict[str, str] = {}
    if task_ids:
        for task in db.scalars(select(Task).where(Task.user_id == user_id, Task.id.in_(task_ids))):
            names[f"task:{task.id}"] = task.name
    if goal_ids:
        for goal in db.scalars(select(Goal).where(Goal.user_id == user_id, Goal.id.in_(goal_ids))):
            names[f"goal:{goal.id}"] = goal.name
    return names


@router.get("", response_model=UserPreferenceRead)
def get_preferences(db: DbSession, current_user: CurrentUser) -> UserPreferenceRead:
    return preferences_read(db, current_preferences(db, current_user.id))


@router.delete("/remembered-schedule-preferences", status_code=204)
def forget_remembered_schedule_preferences(db: DbSession, current_user: CurrentUser) -> None:
    """Drop the standing preference a "remember this" revision saved.

    The draft on screen was built with it and keeps its shape; the next one is planned without it.
    """
    preferences = current_preferences(db, current_user.id)
    preferences.schedule_revision_policy = None
    db.commit()


@router.patch("", response_model=UserPreferenceRead)
def update_preferences(
    payload: UserPreferenceUpdate, db: DbSession, current_user: CurrentUser
) -> UserPreferenceRead:
    preferences = current_preferences(db, current_user.id)
    values = payload.model_dump(exclude_unset=True)
    minimum_sleep = values.get("minimum_sleep_minutes", preferences.minimum_sleep_minutes)
    sleep_time = values.get("default_sleep_time", preferences.default_sleep_time)
    wake_time = values.get("default_wake_time", preferences.default_wake_time)
    if sleep_window_minutes(sleep_time, wake_time) < minimum_sleep:
        raise ApiError(
            "VALIDATION_ERROR",
            "The normal bedtime-to-wake window must meet minimum sleep.",
            422,
        )
    for field, value in values.items():
        setattr(preferences, field, value)
    db.commit()
    db.refresh(preferences)
    return preferences_read(db, preferences)
