import uuid

from fastapi import APIRouter
from sqlalchemy import select

from donext.dependencies import CurrentUser, DbSession
from donext.errors import ApiError
from donext.models import Semester
from donext.schemas import SemesterCreate, SemesterRead, SemesterUpdate

router = APIRouter(prefix="/semesters", tags=["semesters"])


def owned_semester(db: DbSession, user_id: uuid.UUID, semester_id: uuid.UUID) -> Semester:
    semester = db.scalar(
        select(Semester).where(Semester.id == semester_id, Semester.user_id == user_id)
    )
    if semester is None:
        raise ApiError("NOT_FOUND", "Semester not found.", 404)
    return semester


@router.get("", response_model=list[SemesterRead])
def list_semesters(db: DbSession, current_user: CurrentUser) -> list[Semester]:
    return list(
        db.scalars(
            select(Semester)
            .where(Semester.user_id == current_user.id)
            .order_by(Semester.start_date.desc())
        )
    )


@router.post("", response_model=SemesterRead, status_code=201)
def create_semester(payload: SemesterCreate, db: DbSession, current_user: CurrentUser) -> Semester:
    semester = Semester(user_id=current_user.id, **payload.model_dump())
    db.add(semester)
    db.commit()
    db.refresh(semester)
    return semester


@router.get("/{semester_id}", response_model=SemesterRead)
def get_semester(semester_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> Semester:
    return owned_semester(db, current_user.id, semester_id)


@router.patch("/{semester_id}", response_model=SemesterRead)
def update_semester(
    semester_id: uuid.UUID,
    payload: SemesterUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> Semester:
    semester = owned_semester(db, current_user.id, semester_id)
    values = payload.model_dump(exclude_unset=True)
    start_date = values.get("start_date", semester.start_date)
    end_date = values.get("end_date", semester.end_date)
    if end_date < start_date:
        raise ApiError("VALIDATION_ERROR", "Semester end date cannot precede its start.", 422)
    for field, value in values.items():
        setattr(semester, field, value)
    db.commit()
    db.refresh(semester)
    return semester


@router.delete("/{semester_id}", status_code=204)
def delete_semester(semester_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> None:
    semester = owned_semester(db, current_user.id, semester_id)
    db.delete(semester)
    db.commit()
