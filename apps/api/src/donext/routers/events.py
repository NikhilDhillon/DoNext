import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select

from donext.dependencies import CurrentUser, DbSession
from donext.errors import ApiError
from donext.models import FixedEvent
from donext.routers.semesters import owned_semester
from donext.schemas import FixedEventCreate, FixedEventRead, FixedEventUpdate

router = APIRouter(prefix="/events", tags=["fixed events"])


def owned_event(db: DbSession, user_id: uuid.UUID, event_id: uuid.UUID) -> FixedEvent:
    event = db.scalar(
        select(FixedEvent).where(FixedEvent.id == event_id, FixedEvent.user_id == user_id)
    )
    if event is None:
        raise ApiError("NOT_FOUND", "Event not found.", 404)
    return event


@router.get("", response_model=list[FixedEventRead])
def list_events(
    db: DbSession,
    current_user: CurrentUser,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
) -> list[FixedEvent]:
    query = select(FixedEvent).where(FixedEvent.user_id == current_user.id)
    if semester_id:
        owned_semester(db, current_user.id, semester_id)
        query = query.where(FixedEvent.semester_id == semester_id)
    return list(db.scalars(query.order_by(FixedEvent.start_at.asc())))


@router.post("", response_model=FixedEventRead, status_code=201)
def create_event(payload: FixedEventCreate, db: DbSession, current_user: CurrentUser) -> FixedEvent:
    if payload.semester_id:
        owned_semester(db, current_user.id, payload.semester_id)
    event = FixedEvent(user_id=current_user.id, **payload.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.get("/{event_id}", response_model=FixedEventRead)
def get_event(event_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> FixedEvent:
    return owned_event(db, current_user.id, event_id)


@router.patch("/{event_id}", response_model=FixedEventRead)
def update_event(
    event_id: uuid.UUID,
    payload: FixedEventUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> FixedEvent:
    event = owned_event(db, current_user.id, event_id)
    values = payload.model_dump(exclude_unset=True)
    semester_id = values.get("semester_id", event.semester_id)
    if semester_id:
        owned_semester(db, current_user.id, semester_id)
    start_at = values.get("start_at", event.start_at)
    end_at = values.get("end_at", event.end_at)
    if end_at <= start_at:
        raise ApiError("VALIDATION_ERROR", "Event end time must follow its start.", 422)
    for field, value in values.items():
        setattr(event, field, value)
    db.commit()
    db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=204)
def delete_event(event_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> None:
    event = owned_event(db, current_user.id, event_id)
    db.delete(event)
    db.commit()
