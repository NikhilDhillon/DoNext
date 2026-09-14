from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_api import create_semester, register
from test_student_scheduling import create_course, create_item

from donext import clock
from donext.effort_learning import observed_ratio, suggest_effort
from donext.models import AcademicItemType, EffortObservation


def observation(course_id, item_type, estimated: int, actual: int):
    return SimpleNamespace(
        course_id=course_id,
        item_type=item_type,
        estimated_minutes=estimated,
        actual_minutes=actual,
    )


def test_ratio_requires_three_valid_observations_and_trims_only_at_six() -> None:
    assert observed_ratio([(100, 10), (100, 200), (100, 500), (100, 200)]) is None
    ratio = observed_ratio([(100, 50), (100, 100), (100, 200), (100, 200), (100, 200), (100, 400)])
    assert ratio == (2.0, 6)


def test_suggestion_prefers_course_and_type_then_degrades_to_type() -> None:
    course_id = uuid4()
    other_course = uuid4()
    rows = [
        observation(course_id, AcademicItemType.assignment, 60, 120),
        observation(course_id, AcademicItemType.assignment, 60, 120),
        observation(other_course, AcademicItemType.assignment, 60, 120),
    ]

    degraded = suggest_effort(rows, course_id, AcademicItemType.assignment, 150)  # type: ignore[arg-type]
    assert degraded is not None
    assert (degraded.minutes, degraded.basis, degraded.sample_size) == (300, "item_type", 3)

    rows.append(observation(course_id, AcademicItemType.assignment, 60, 120))
    specific = suggest_effort(rows, course_id, AcademicItemType.assignment, 150)  # type: ignore[arg-type]
    assert specific is not None
    assert (specific.minutes, specific.basis, specific.sample_size) == (
        300,
        "course_and_type",
        3,
    )


def test_ratio_at_or_below_one_never_suggests_a_smaller_estimate() -> None:
    course_id = uuid4()
    rows = [observation(course_id, AcademicItemType.quiz, 120, actual) for actual in (60, 90, 120)]
    assert suggest_effort(rows, course_id, AcademicItemType.quiz, 120) is None  # type: ignore[arg-type]


def test_suggestion_rounds_to_five_and_stays_inside_task_limits() -> None:
    course_id = uuid4()
    rows = [
        observation(course_id, AcademicItemType.assignment, 1000, actual)
        for actual in (1017, 1017, 1017)
    ]
    suggestion = suggest_effort(rows, course_id, AcademicItemType.assignment, 150)  # type: ignore[arg-type]
    assert suggestion is not None
    assert suggestion.minutes == 155


def test_three_completed_overruns_offer_a_suggestion_but_typed_minutes_win(
    client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 8, 20, tzinfo=UTC))
    register(client)
    semester = create_semester(client)
    course = create_course(client, semester["id"], "CSC 349A")

    for number in range(1, 4):
        item = create_item(
            client,
            course["id"],
            "assignment",
            f"Completed assignment {number}",
            f"2026-09-{9 + number:02d}T23:59:00-07:00",
            activate=False,
        )
        activated = client.put(
            f"/api/v1/academic-items/{item['id']}/activation",
            json={"decision": "student", "minutes": 60},
        )
        assert activated.status_code == 200, activated.text
        completed = client.post(
            "/api/v1/work-sessions",
            json={
                "task_id": item["task_id"],
                "local_date": "2026-09-08",
                "minutes": 120,
                "outcome": "finished",
                "source": "manual",
            },
        )
        assert completed.status_code == 201, completed.text

    waiting = create_item(
        client,
        course["id"],
        "assignment",
        "Fourth assignment",
        "2026-09-14T23:59:00-07:00",
        activate=False,
    )
    queue = client.get(f"/api/v1/semesters/{semester['id']}/activation-queue")
    assert queue.status_code == 200, queue.text
    prompt = next(row for row in queue.json() if row["academic_item_id"] == waiting["id"])
    assert prompt["fallback_minutes"] == 150
    assert prompt["suggested_minutes"] == 300
    assert prompt["suggestion_basis"] == "course_and_type"
    assert prompt["suggestion_sample_size"] == 3
    assert "3 completed" in prompt["suggestion_explanation"]

    calibration = client.get(f"/api/v1/courses/{course['id']}/effort-calibration")
    assert calibration.status_code == 200
    assert calibration.json()[0]["suggested_minutes"] == 300

    typed = client.put(
        f"/api/v1/academic-items/{waiting['id']}/activation",
        json={"decision": "student", "minutes": 45},
    )
    assert typed.status_code == 200, typed.text
    assert typed.json()["estimated_minutes"] == 45
    assert typed.json()["estimate_origin"] == "student_provided"
    saved = db_session.scalar(
        select(EffortObservation).where(EffortObservation.task_id == UUID(str(waiting["task_id"])))
    )
    assert saved is not None
    assert saved.estimated_minutes == 45
    assert saved.estimate_origin.value == "student_provided"


def test_using_the_offered_default_applies_the_learned_minutes(
    client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 8, 20, tzinfo=UTC))
    register(client)
    semester = create_semester(client)
    course = create_course(client, semester["id"], "CSC 225")
    for number in range(3):
        item = create_item(
            client,
            course["id"],
            "quiz",
            f"Quiz {number}",
            "2026-09-12T23:59:00-07:00",
            activate=False,
        )
        client.put(
            f"/api/v1/academic-items/{item['id']}/activation",
            json={"decision": "student", "minutes": 60},
        )
        client.post(
            "/api/v1/work-sessions",
            json={
                "task_id": item["task_id"],
                "local_date": "2026-09-08",
                "minutes": 90,
                "outcome": "finished",
            },
        )
    waiting = create_item(
        client,
        course["id"],
        "quiz",
        "Quiz 4",
        "2026-09-14T23:59:00-07:00",
        activate=False,
    )
    activated = client.put(
        f"/api/v1/academic-items/{waiting['id']}/activation",
        json={"decision": "use_default"},
    )
    assert activated.status_code == 200
    assert activated.json()["estimated_minutes"] == 180
    assert activated.json()["estimate_origin"] == "system_default"
    client.post(
        "/api/v1/work-sessions",
        json={
            "task_id": waiting["task_id"],
            "local_date": "2026-09-08",
            "minutes": 180,
            "outcome": "finished",
        },
    )
    saved = db_session.scalar(
        select(EffortObservation).where(EffortObservation.task_id == UUID(str(waiting["task_id"])))
    )
    assert saved is not None
    assert saved.excluded_reason == "fallback_estimate"


def test_completion_excludes_missing_time_and_completion_without_a_finished_check_in(
    client: TestClient,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 8, 20, tzinfo=UTC))
    register(client)
    semester = create_semester(client)
    course = create_course(client, semester["id"], "CSC 230")

    no_time = create_item(
        client,
        course["id"],
        "assignment",
        "No time record",
        "2026-09-12T23:59:00-07:00",
        activate=False,
    )
    client.put(
        f"/api/v1/academic-items/{no_time['id']}/activation",
        json={"decision": "student", "minutes": 60},
    )
    client.patch(f"/api/v1/tasks/{no_time['task_id']}", json={"status": "completed"})

    abandoned = create_item(
        client,
        course["id"],
        "assignment",
        "Unchecked completion",
        "2026-09-13T23:59:00-07:00",
        activate=False,
    )
    client.put(
        f"/api/v1/academic-items/{abandoned['id']}/activation",
        json={"decision": "student", "minutes": 60},
    )
    client.post(
        "/api/v1/work-sessions",
        json={
            "task_id": abandoned["task_id"],
            "local_date": "2026-09-08",
            "minutes": 30,
            "outcome": "still_going",
        },
    )
    client.patch(f"/api/v1/tasks/{abandoned['task_id']}", json={"status": "completed"})

    observations = list(
        db_session.scalars(
            select(EffortObservation).where(
                EffortObservation.task_id.in_(
                    [UUID(str(no_time["task_id"])), UUID(str(abandoned["task_id"]))]
                )
            )
        )
    )
    reasons = {str(row.task_id): row.excluded_reason for row in observations}
    assert reasons[str(no_time["task_id"])] == "no_time_logged"
    assert reasons[str(abandoned["task_id"])] == "not_checked_in"
