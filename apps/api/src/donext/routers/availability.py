from fastapi import APIRouter
from sqlalchemy import delete, select

from donext.dependencies import CurrentUser, DbSession
from donext.models import AvailabilityWindow
from donext.schemas import AvailabilityRead, AvailabilityReplace

router = APIRouter(prefix="/availability", tags=["availability"])


@router.get("", response_model=list[AvailabilityRead])
def get_availability(db: DbSession, current_user: CurrentUser) -> list[AvailabilityWindow]:
    return list(
        db.scalars(
            select(AvailabilityWindow)
            .where(AvailabilityWindow.user_id == current_user.id)
            .order_by(AvailabilityWindow.day_of_week, AvailabilityWindow.start_time)
        )
    )


@router.put("", response_model=list[AvailabilityRead])
def replace_availability(
    payload: AvailabilityReplace, db: DbSession, current_user: CurrentUser
) -> list[AvailabilityWindow]:
    db.execute(delete(AvailabilityWindow).where(AvailabilityWindow.user_id == current_user.id))
    windows = [
        AvailabilityWindow(user_id=current_user.id, **item.model_dump()) for item in payload.windows
    ]
    db.add_all(windows)
    db.commit()
    for window in windows:
        db.refresh(window)
    return windows
