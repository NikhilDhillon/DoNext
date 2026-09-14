import uuid

from fastapi import APIRouter
from sqlalchemy import select

from donext.dependencies import CurrentUser, DbSession
from donext.effort_learning import effort_observations, suggest_effort
from donext.errors import ApiError
from donext.models import AcademicItemType, Course, CourseDeliveryMode, Semester
from donext.planning import academic_effort_default
from donext.routers.semesters import owned_semester
from donext.schemas import CourseCreate, CourseRead, CourseUpdate, EffortCalibrationRead

router = APIRouter(tags=["courses"])


def owned_course(db: DbSession, user_id: uuid.UUID, course_id: uuid.UUID) -> Course:
    course = db.scalar(
        select(Course)
        .join(Semester, Semester.id == Course.semester_id)
        .where(Course.id == course_id, Semester.user_id == user_id)
    )
    if course is None:
        raise ApiError("NOT_FOUND", "Course not found.", 404)
    return course


@router.get("/semesters/{semester_id}/courses", response_model=list[CourseRead])
def list_courses(semester_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> list[Course]:
    owned_semester(db, current_user.id, semester_id)
    return list(
        db.scalars(
            select(Course).where(Course.semester_id == semester_id).order_by(Course.code.asc())
        )
    )


@router.post("/semesters/{semester_id}/courses", response_model=CourseRead, status_code=201)
def create_course(
    semester_id: uuid.UUID,
    payload: CourseCreate,
    db: DbSession,
    current_user: CurrentUser,
) -> Course:
    owned_semester(db, current_user.id, semester_id)
    values = payload.model_dump()
    values["code"] = payload.code.strip().upper()
    course = Course(semester_id=semester_id, **values)
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


@router.get("/courses/{course_id}", response_model=CourseRead)
def get_course(course_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> Course:
    return owned_course(db, current_user.id, course_id)


@router.get(
    "/courses/{course_id}/effort-calibration",
    response_model=list[EffortCalibrationRead],
)
def effort_calibration(
    course_id: uuid.UUID, db: DbSession, current_user: CurrentUser
) -> list[EffortCalibrationRead]:
    """Explain the larger estimates DoNext can currently suggest for this course."""

    course = owned_course(db, current_user.id, course_id)
    observations = effort_observations(db, current_user.id)
    calibrations: list[EffortCalibrationRead] = []
    for item_type in AcademicItemType:
        base_minutes, _origin = academic_effort_default(item_type)
        if base_minutes is None:
            continue
        suggestion = suggest_effort(observations, course.id, item_type, base_minutes)
        if suggestion is None:
            continue
        calibrations.append(
            EffortCalibrationRead(
                item_type=item_type,
                base_minutes=base_minutes,
                suggested_minutes=suggestion.minutes,
                suggestion_basis=suggestion.basis,
                suggestion_sample_size=suggestion.sample_size,
                suggestion_explanation=suggestion.explanation,
            )
        )
    return calibrations


@router.patch("/courses/{course_id}", response_model=CourseRead)
def update_course(
    course_id: uuid.UUID,
    payload: CourseUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> Course:
    course = owned_course(db, current_user.id, course_id)
    values = payload.model_dump(exclude_unset=True)
    if "code" in values and values["code"] is not None:
        values["code"] = str(values["code"]).strip().upper()
    delivery_mode = values.get("delivery_mode", course.delivery_mode)
    content_at = values.get("first_content_available_at", course.first_content_available_at)
    if delivery_mode == CourseDeliveryMode.asynchronous and content_at is None:
        raise ApiError(
            "VALIDATION_ERROR",
            "Asynchronous courses require a first content-available time.",
            422,
        )
    for field, value in values.items():
        setattr(course, field, value)
    db.commit()
    db.refresh(course)
    return course


@router.delete("/courses/{course_id}", status_code=204)
def delete_course(course_id: uuid.UUID, db: DbSession, current_user: CurrentUser) -> None:
    course = owned_course(db, current_user.id, course_id)
    db.delete(course)
    db.commit()
