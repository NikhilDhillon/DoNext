import uuid
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Query

from donext.dependencies import CurrentUser, DbSession
from donext.planning import build_planning_view, build_semester_view
from donext.routers.semesters import owned_semester
from donext.schemas import PlanningViewRead, SemesterPlanningRead

router = APIRouter(prefix="/planning", tags=["planning"])


@router.get("/day", response_model=PlanningViewRead)
def get_day_plan(
    db: DbSession,
    current_user: CurrentUser,
    target_date: Annotated[date, Query(alias="date")],
) -> PlanningViewRead:
    return build_planning_view(db, current_user, target_date, target_date + timedelta(days=1))


@router.get("/week", response_model=PlanningViewRead)
def get_week_plan(
    db: DbSession,
    current_user: CurrentUser,
    start: Annotated[date, Query()],
) -> PlanningViewRead:
    return build_planning_view(db, current_user, start, start + timedelta(days=7))


@router.get("/semesters/{semester_id}", response_model=SemesterPlanningRead)
def get_semester_plan(
    semester_id: uuid.UUID, db: DbSession, current_user: CurrentUser
) -> SemesterPlanningRead:
    semester = owned_semester(db, current_user.id, semester_id)
    return build_semester_view(db, current_user, semester)
