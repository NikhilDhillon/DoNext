"""Evidence-based effort suggestions built from completed student estimates."""

import statistics
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from donext import clock
from donext.models import (
    AcademicItem,
    AcademicItemType,
    EffortObservation,
    EstimateOrigin,
    Task,
    TaskStatus,
)

SuggestionBasis = Literal["course_and_type", "item_type"]


@dataclass(frozen=True)
class EffortSuggestion:
    minutes: int
    basis: SuggestionBasis
    sample_size: int
    explanation: str


def observed_ratio(
    observations: Iterable[tuple[int, int]],
) -> tuple[float, int] | None:
    """Return the robust median actual/estimate ratio and its evidence count."""

    ratios = sorted(
        actual / estimated
        for estimated, actual in observations
        if estimated > 0 and 0.25 <= actual / estimated <= 4.0
    )
    if len(ratios) < 3:
        return None
    evidence_count = len(ratios)
    if evidence_count >= 6:
        ratios = ratios[1:-1]
    return statistics.median(ratios), evidence_count


def effort_observations(db: Session, user_id: uuid.UUID) -> list[EffortObservation]:
    """Load completed, non-excluded observations for one user's suggestion pass."""

    return list(
        db.scalars(
            select(EffortObservation).where(
                EffortObservation.user_id == user_id,
                EffortObservation.actual_minutes.is_not(None),
                EffortObservation.excluded_reason.is_(None),
            )
        )
    )


def suggest_effort(
    observations: Sequence[EffortObservation],
    course_id: uuid.UUID,
    item_type: AcademicItemType,
    base_minutes: int,
) -> EffortSuggestion | None:
    """Suggest an increase using course/type evidence, then same-type evidence globally."""

    groupings: tuple[tuple[SuggestionBasis, list[EffortObservation]], ...] = (
        (
            "course_and_type",
            [
                row
                for row in observations
                if row.course_id == course_id and row.item_type == item_type
            ],
        ),
        ("item_type", [row for row in observations if row.item_type == item_type]),
    )
    for basis, rows in groupings:
        ratio_result = observed_ratio(
            (row.estimated_minutes, row.actual_minutes or 0) for row in rows
        )
        if ratio_result is None:
            continue
        ratio, sample_size = ratio_result
        if ratio <= 1.0:
            return None
        suggested = min(max(int(base_minutes * ratio / 5 + 0.5) * 5, 15), 10080)
        if suggested <= base_minutes:
            return None
        scope = (
            "items of this type in this course"
            if basis == "course_and_type"
            else "items of this type across your courses"
        )
        return EffortSuggestion(
            minutes=suggested,
            basis=basis,
            sample_size=sample_size,
            explanation=(
                f"Based on {sample_size} completed {scope}; you usually needed "
                f"about {ratio:.1f}× your estimate."
            ),
        )
    return None


def learned_effort_suggestion(
    db: Session,
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    item_type: AcademicItemType,
    base_minutes: int,
) -> EffortSuggestion | None:
    return suggest_effort(effort_observations(db, user_id), course_id, item_type, base_minutes)


def record_effort_activation(db: Session, task: Task, item: AcademicItem) -> None:
    """Create or replace the commitment snapshot for an academic task activation."""

    observation = db.scalar(select(EffortObservation).where(EffortObservation.task_id == task.id))
    if observation is None:
        observation = EffortObservation(user_id=task.user_id, task_id=task.id)
        db.add(observation)
    observation.course_id = item.course_id
    observation.item_type = item.item_type
    observation.estimated_minutes = task.estimated_minutes
    observation.estimate_origin = task.estimate_origin
    observation.actual_minutes = None
    observation.completed_on = None
    observation.excluded_reason = None


def update_effort_completion(
    db: Session,
    task: Task,
    *,
    actual_minutes: int,
    checked_in: bool,
    completed_on: date | None = None,
) -> None:
    """Finish or clear an observation as the task's derived completion state changes."""

    observation = db.scalar(select(EffortObservation).where(EffortObservation.task_id == task.id))
    if observation is None:
        return
    if task.status != TaskStatus.completed:
        observation.actual_minutes = None
        observation.completed_on = None
        observation.excluded_reason = None
        return
    observation.actual_minutes = actual_minutes
    observation.completed_on = completed_on or clock.now().date()
    if observation.estimate_origin != EstimateOrigin.student_provided:
        observation.excluded_reason = "fallback_estimate"
    elif actual_minutes == 0:
        observation.excluded_reason = "no_time_logged"
    elif not checked_in:
        observation.excluded_reason = "not_checked_in"
    else:
        observation.excluded_reason = None
