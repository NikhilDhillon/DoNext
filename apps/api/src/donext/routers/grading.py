import json
import uuid
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from sqlalchemy import delete, select, update

from donext.academic_impact import calculate_academic_impacts
from donext.dependencies import CurrentUser, DbSession
from donext.errors import ApiError
from donext.models import (
    AcademicItem,
    AcademicItemType,
    AssessmentGroup,
    Course,
    FixedEvent,
    GradingScheme,
    GradingSchemeComponent,
    Priority,
    Task,
)
from donext.planning import aware, resolve_timezone
from donext.routers.courses import owned_course
from donext.routers.semesters import owned_semester
from donext.schemas import (
    AcademicImpactRead,
    AcademicItemRead,
    AcademicItemUpdate,
    AssessmentGroupRead,
    CourseGradingRead,
    CourseGradingReplace,
    CourseMeetingImport,
    CourseOutlineImport,
    CourseOutlineImportRead,
    CourseRead,
    FixedEventCreate,
    GradingSchemeComponentRead,
    GradingSchemeRead,
)

router = APIRouter(tags=["grading"])


def owned_academic_item(db: DbSession, user_id: uuid.UUID, item_id: uuid.UUID) -> AcademicItem:
    item = db.scalar(
        select(AcademicItem).where(AcademicItem.id == item_id, AcademicItem.user_id == user_id)
    )
    if item is None:
        raise ApiError("NOT_FOUND", "Academic item not found.", 404)
    return item


def _source_references(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return [value]
    return [str(reference) for reference in parsed] if isinstance(parsed, list) else []


def _grading_warnings(schemes: list[GradingScheme]) -> list[str]:
    warnings: list[str] = []
    for scheme in schemes:
        ordinary_total = sum(
            component.weight_percent
            for component in scheme.components
            if not component.is_extra_credit
        )
        if abs(ordinary_total - 100) > 0.01:
            warnings.append(
                f"{scheme.name} totals {ordinary_total:g}% before extra credit; it is incomplete."
            )
    if not schemes:
        warnings.append("No grading scheme has been confirmed yet.")
    return warnings


def _grading_read(db: DbSession, course_id: uuid.UUID) -> CourseGradingRead:
    course = owned_course_for_bundle(db, course_id)
    groups = list(
        db.scalars(
            select(AssessmentGroup)
            .where(AssessmentGroup.course_id == course_id)
            .order_by(AssessmentGroup.created_at, AssessmentGroup.name)
        )
    )
    items = list(
        db.scalars(
            select(AcademicItem)
            .where(AcademicItem.course_id == course_id)
            .order_by(AcademicItem.due_at.asc().nullslast(), AcademicItem.name)
        )
    )
    schemes = list(
        db.scalars(
            select(GradingScheme)
            .where(GradingScheme.course_id == course_id)
            .order_by(GradingScheme.is_primary.desc(), GradingScheme.created_at)
        )
    )
    task_ids = {
        task.academic_item_id: task.id
        for task in db.scalars(
            select(Task).where(Task.course_id == course_id, Task.academic_item_id.is_not(None))
        )
    }
    return CourseGradingRead(
        course=CourseRead.model_validate(course),
        groups=[AssessmentGroupRead.model_validate(group) for group in groups],
        items=[
            AcademicItemRead(
                id=item.id,
                course_id=item.course_id,
                assessment_group_id=item.assessment_group_id,
                task_id=task_ids.get(item.id),
                item_type=item.item_type,
                name=item.name,
                description=item.description,
                due_at=item.due_at,
                direct_weight_percent=item.direct_weight_percent,
                relative_weight_percent=item.relative_weight_percent,
                points_possible=item.points_possible,
                points_earned=item.points_earned,
                grade_status=item.grade_status,
                weight_origin=item.weight_origin,
                extraction_confidence=item.extraction_confidence,
                minimum_required_percent=item.minimum_required_percent,
                extra_credit=item.extra_credit,
                source_text=item.source_text,
                source_references=_source_references(item.source_references),
            )
            for item in items
        ],
        schemes=[
            GradingSchemeRead(
                id=scheme.id,
                name=scheme.name,
                selection_mode=scheme.selection_mode,
                is_primary=scheme.is_primary,
                is_complete=scheme.is_complete,
                components=[
                    GradingSchemeComponentRead.model_validate(component)
                    for component in scheme.components
                ],
            )
            for scheme in schemes
        ],
        warnings=_grading_warnings(schemes),
    )


def owned_course_for_bundle(db: DbSession, course_id: uuid.UUID) -> Course:
    # Ownership has already been checked by each public route. This helper avoids a
    # second join while building the response after a transactional write.
    course = db.get(Course, course_id)
    if course is None:
        raise ApiError("NOT_FOUND", "Course not found.", 404)
    return course


def _validate_group_cycles(payload: CourseGradingReplace) -> None:
    parents = {group.key: group.parent_key for group in payload.groups}
    for key in parents:
        seen: set[str] = set()
        current: str | None = key
        while current is not None:
            if current in seen:
                raise ApiError("VALIDATION_ERROR", "Assessment groups cannot form a cycle.", 422)
            seen.add(current)
            current = parents.get(current)


@router.get("/courses/{course_id}/grading", response_model=CourseGradingRead)
def get_course_grading(
    course_id: uuid.UUID, db: DbSession, current_user: CurrentUser
) -> CourseGradingRead:
    owned_course(db, current_user.id, course_id)
    return _grading_read(db, course_id)


def _replace_course_grading_data(
    course_id: uuid.UUID,
    payload: CourseGradingReplace,
    db: DbSession,
    current_user: CurrentUser,
) -> Course:
    course = owned_course(db, current_user.id, course_id)
    _validate_group_cycles(payload)
    if sum(scheme.is_primary for scheme in payload.schemes) > 1:
        raise ApiError("VALIDATION_ERROR", "Only one grading scheme can be primary.", 422)
    for scheme in payload.schemes:
        ordinary_total = sum(
            component.weight_percent
            for component in scheme.components
            if not component.is_extra_credit
        )
        if scheme.is_complete and abs(ordinary_total - 100) > 0.01:
            raise ApiError(
                "VALIDATION_ERROR",
                f"{scheme.name} is marked complete but totals {ordinary_total:g}%, not 100%.",
                422,
            )

    if "current_grade" in payload.model_fields_set:
        course.current_grade = payload.current_grade
    if "target_grade" in payload.model_fields_set:
        course.target_grade = payload.target_grade

    existing_tasks = list(db.scalars(select(Task).where(Task.course_id == course_id)))
    tasks_by_name: dict[str, list[Task]] = {}
    for task in existing_tasks:
        tasks_by_name.setdefault(task.name.strip().casefold(), []).append(task)
    db.execute(update(Task).where(Task.course_id == course_id).values(academic_item_id=None))
    scheme_ids = select(GradingScheme.id).where(GradingScheme.course_id == course_id)
    db.execute(
        delete(GradingSchemeComponent).where(
            GradingSchemeComponent.grading_scheme_id.in_(scheme_ids)
        )
    )
    db.execute(delete(GradingScheme).where(GradingScheme.course_id == course_id))
    db.execute(delete(AcademicItem).where(AcademicItem.course_id == course_id))
    db.execute(delete(AssessmentGroup).where(AssessmentGroup.course_id == course_id))
    db.flush()

    group_by_key: dict[str, AssessmentGroup] = {}
    pending = list(payload.groups)
    while pending:
        progress = False
        for group_input in list(pending):
            if group_input.parent_key and group_input.parent_key not in group_by_key:
                continue
            group = AssessmentGroup(
                course_id=course_id,
                parent_group_id=(
                    group_by_key[group_input.parent_key].id if group_input.parent_key else None
                ),
                name=group_input.name,
                allocation_method=group_input.allocation_method,
                relative_weight_percent=group_input.relative_weight_percent,
                weight_origin=group_input.weight_origin,
                extraction_confidence=group_input.extraction_confidence,
                source_text=group_input.source_text,
            )
            db.add(group)
            db.flush()
            group_by_key[group_input.key] = group
            pending.remove(group_input)
            progress = True
        if not progress:
            raise ApiError("VALIDATION_ERROR", "Assessment group hierarchy is invalid.", 422)

    item_by_key: dict[str, AcademicItem] = {}
    for item_input in payload.items:
        item = AcademicItem(
            user_id=current_user.id,
            course_id=course_id,
            assessment_group_id=(
                group_by_key[item_input.group_key].id if item_input.group_key else None
            ),
            item_type=item_input.item_type,
            name=item_input.name.strip(),
            description=item_input.description,
            due_at=item_input.due_at,
            direct_weight_percent=item_input.direct_weight_percent,
            relative_weight_percent=item_input.relative_weight_percent,
            points_possible=item_input.points_possible,
            points_earned=item_input.points_earned,
            grade_status=item_input.grade_status,
            weight_origin=item_input.weight_origin,
            extraction_confidence=item_input.extraction_confidence,
            minimum_required_percent=item_input.minimum_required_percent,
            extra_credit=item_input.extra_credit,
            source_text=item_input.source_text,
            source_references=json.dumps(item_input.source_references),
        )
        db.add(item)
        db.flush()
        item_by_key[item_input.key] = item

        candidates = tasks_by_name.get(item.name.casefold(), [])
        matching_task = next(
            (candidate for candidate in candidates if candidate.academic_item_id is None), None
        )
        if matching_task is None:
            matching_task = Task(
                user_id=current_user.id,
                course_id=course_id,
                academic_item_id=item.id,
                name=item.name,
                description=item.description,
                priority=(
                    Priority.high
                    if item.item_type in {AcademicItemType.midterm, AcademicItemType.final_exam}
                    else Priority.medium
                ),
                estimated_minutes=item_input.estimated_minutes,
                remaining_minutes=item_input.estimated_minutes,
                deadline_at=item.due_at,
                required=not item.extra_credit,
            )
            db.add(matching_task)
        else:
            matching_task.academic_item_id = item.id
            matching_task.deadline_at = item.due_at

    for scheme_input in payload.schemes:
        grading_scheme = GradingScheme(
            course_id=course_id,
            name=scheme_input.name,
            selection_mode=scheme_input.selection_mode,
            is_primary=scheme_input.is_primary,
            is_complete=scheme_input.is_complete,
        )
        db.add(grading_scheme)
        db.flush()
        for component_input in scheme_input.components:
            db.add(
                GradingSchemeComponent(
                    grading_scheme_id=grading_scheme.id,
                    assessment_group_id=(
                        group_by_key[component_input.target_group_key].id
                        if component_input.target_group_key
                        else None
                    ),
                    academic_item_id=(
                        item_by_key[component_input.target_item_key].id
                        if component_input.target_item_key
                        else None
                    ),
                    weight_percent=component_input.weight_percent,
                    selection_rule=component_input.selection_rule,
                    selection_count=component_input.selection_count,
                    is_extra_credit=component_input.is_extra_credit,
                    minimum_required_percent=component_input.minimum_required_percent,
                )
            )

    return course


@router.put("/courses/{course_id}/grading", response_model=CourseGradingRead)
def replace_course_grading(
    course_id: uuid.UUID,
    payload: CourseGradingReplace,
    db: DbSession,
    current_user: CurrentUser,
) -> CourseGradingRead:
    _replace_course_grading_data(course_id, payload, db, current_user)
    db.commit()
    return _grading_read(db, course_id)


def _event_key(
    event: FixedEvent | FixedEventCreate, timezone: ZoneInfo
) -> tuple[str, int, int, int, int, int]:
    title = event.title.strip().casefold()
    start_at = aware(event.start_at).astimezone(timezone)
    end_at = aware(event.end_at).astimezone(timezone)
    return (
        title,
        start_at.weekday(),
        start_at.hour,
        start_at.minute,
        end_at.hour,
        end_at.minute,
    )


def _meeting_event(
    meeting: CourseMeetingImport,
    semester_id: uuid.UUID,
    semester_start: date,
    semester_end: date,
    timezone: ZoneInfo,
) -> FixedEventCreate:
    first_date = semester_start + timedelta(
        days=(meeting.day_of_week - semester_start.weekday()) % 7
    )
    start_at = datetime.combine(first_date, meeting.start_time, tzinfo=timezone)
    end_at = datetime.combine(first_date, meeting.end_time, tzinfo=timezone)
    until = datetime.combine(semester_end, time.max, tzinfo=timezone).astimezone(UTC)
    return FixedEventCreate(
        title=meeting.title,
        semester_id=semester_id,
        category="class",
        start_at=start_at,
        end_at=end_at,
        recurrence_rule=(
            f"FREQ=WEEKLY;BYDAY={('MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU')[meeting.day_of_week]};"
            f"UNTIL={until.strftime('%Y%m%dT%H%M%SZ')}"
        ),
        location=meeting.location,
        commute_before_minutes=0,
        commute_after_minutes=0,
        locked=True,
    )


@router.post(
    "/semesters/{semester_id}/courses/import-outline",
    response_model=CourseOutlineImportRead,
)
def import_course_outline(
    semester_id: uuid.UUID,
    payload: CourseOutlineImport,
    db: DbSession,
    current_user: CurrentUser,
) -> CourseOutlineImportRead:
    semester = owned_semester(db, current_user.id, semester_id)
    timezone = resolve_timezone(current_user.timezone)
    normalized_code = payload.course.code.replace(" ", "").upper()
    existing_course = next(
        (
            course
            for course in db.scalars(select(Course).where(Course.semester_id == semester_id))
            if course.code.replace(" ", "").upper() == normalized_code
        ),
        None,
    )
    if existing_course is not None and not payload.replace_existing:
        raise ApiError(
            "CONFLICT",
            f"{existing_course.code} is already in this semester. "
            "Confirm that you want to update it.",
            409,
        )

    updated_existing = existing_course is not None
    if existing_course is None:
        values = payload.course.model_dump()
        values["code"] = payload.course.code.strip().upper()
        course = Course(semester_id=semester_id, **values)
        db.add(course)
        db.flush()
    else:
        course = existing_course
        course.name = payload.course.name
        course.instructor = payload.course.instructor or course.instructor

    _replace_course_grading_data(course.id, payload.grading, db, current_user)

    existing_events = list(
        db.scalars(
            select(FixedEvent).where(
                FixedEvent.user_id == current_user.id,
                FixedEvent.semester_id == semester_id,
                FixedEvent.category == "class",
            )
        )
    )
    existing_keys = {_event_key(event, timezone) for event in existing_events}
    meetings_created = 0
    meetings = [
        *payload.meetings,
        *(
            _meeting_event(
                meeting,
                semester_id,
                semester.start_date,
                semester.end_date,
                timezone,
            )
            for meeting in payload.meeting_proposals
        ),
    ]
    for meeting in meetings:
        if meeting.semester_id != semester_id or meeting.category != "class":
            raise ApiError(
                "VALIDATION_ERROR",
                "Imported meetings must be classes in the selected semester.",
                422,
            )
        if _event_key(meeting, timezone) in existing_keys:
            continue
        db.add(FixedEvent(user_id=current_user.id, **meeting.model_dump()))
        existing_keys.add(_event_key(meeting, timezone))
        meetings_created += 1

    db.commit()
    db.refresh(course)
    return CourseOutlineImportRead(
        course=CourseRead.model_validate(course),
        updated_existing=updated_existing,
        meetings_created=meetings_created,
    )


@router.patch("/academic-items/{item_id}", response_model=AcademicItemRead)
def update_academic_item(
    item_id: uuid.UUID,
    payload: AcademicItemUpdate,
    db: DbSession,
    current_user: CurrentUser,
) -> AcademicItemRead:
    item = owned_academic_item(db, current_user.id, item_id)
    values = payload.model_dump(exclude_unset=True)
    possible = values.get("points_possible", item.points_possible)
    earned = values.get("points_earned", item.points_earned)
    if earned is not None and possible is None:
        raise ApiError("VALIDATION_ERROR", "Possible points are required for a grade.", 422)
    if earned is not None and possible is not None and earned > possible:
        raise ApiError("VALIDATION_ERROR", "Earned points cannot exceed possible points.", 422)
    for field, value in values.items():
        setattr(item, field, value)
    task = db.scalar(select(Task).where(Task.academic_item_id == item.id))
    if task:
        task.name = item.name
        task.deadline_at = item.due_at
        task.required = not item.extra_credit
    db.commit()
    db.refresh(item)
    return AcademicItemRead(
        id=item.id,
        course_id=item.course_id,
        assessment_group_id=item.assessment_group_id,
        task_id=task.id if task else None,
        item_type=item.item_type,
        name=item.name,
        description=item.description,
        due_at=item.due_at,
        direct_weight_percent=item.direct_weight_percent,
        relative_weight_percent=item.relative_weight_percent,
        points_possible=item.points_possible,
        points_earned=item.points_earned,
        grade_status=item.grade_status,
        weight_origin=item.weight_origin,
        extraction_confidence=item.extraction_confidence,
        minimum_required_percent=item.minimum_required_percent,
        extra_credit=item.extra_credit,
        source_text=item.source_text,
        source_references=_source_references(item.source_references),
    )


@router.get("/courses/{course_id}/academic-impact", response_model=list[AcademicImpactRead])
def get_academic_impact(
    course_id: uuid.UUID, db: DbSession, current_user: CurrentUser
) -> list[AcademicImpactRead]:
    course = owned_course(db, current_user.id, course_id)
    items = list(db.scalars(select(AcademicItem).where(AcademicItem.course_id == course_id)))
    groups = list(db.scalars(select(AssessmentGroup).where(AssessmentGroup.course_id == course_id)))
    schemes = list(db.scalars(select(GradingScheme).where(GradingScheme.course_id == course_id)))
    scheme_ids = [scheme.id for scheme in schemes]
    components = (
        list(
            db.scalars(
                select(GradingSchemeComponent).where(
                    GradingSchemeComponent.grading_scheme_id.in_(scheme_ids)
                )
            )
        )
        if scheme_ids
        else []
    )
    tasks = list(db.scalars(select(Task).where(Task.course_id == course_id)))
    return [
        calculated.result
        for calculated in calculate_academic_impacts(
            course, items, groups, schemes, components, tasks
        )
    ]
