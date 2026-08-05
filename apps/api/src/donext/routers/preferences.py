import uuid

from fastapi import APIRouter
from sqlalchemy import select

from donext.dependencies import CurrentUser, DbSession
from donext.errors import ApiError
from donext.models import UserPreference
from donext.schemas import UserPreferenceRead, UserPreferenceUpdate

router = APIRouter(prefix="/preferences", tags=["preferences"])


def current_preferences(db: DbSession, user_id: uuid.UUID) -> UserPreference:
    preferences = db.scalar(select(UserPreference).where(UserPreference.user_id == user_id))
    if preferences is None:
        raise ApiError("NOT_FOUND", "Planning preferences not found.", 404)
    return preferences


@router.get("", response_model=UserPreferenceRead)
def get_preferences(db: DbSession, current_user: CurrentUser) -> UserPreference:
    return current_preferences(db, current_user.id)


@router.patch("", response_model=UserPreferenceRead)
def update_preferences(
    payload: UserPreferenceUpdate, db: DbSession, current_user: CurrentUser
) -> UserPreference:
    preferences = current_preferences(db, current_user.id)
    values = payload.model_dump(exclude_unset=True)
    minimum_sleep = values.get("minimum_sleep_minutes", preferences.minimum_sleep_minutes)
    preferred_sleep = values.get("preferred_sleep_minutes", preferences.preferred_sleep_minutes)
    if preferred_sleep < minimum_sleep:
        raise ApiError(
            "VALIDATION_ERROR",
            "Preferred sleep must be at least the minimum sleep.",
            422,
        )
    for field, value in values.items():
        setattr(preferences, field, value)
    db.commit()
    db.refresh(preferences)
    return preferences
