from datetime import datetime

from fastapi.testclient import TestClient
from test_api import create_semester, register
from test_planning import replace_weekday_availability


def create_course(
    client: TestClient,
    semester_id: str,
    code: str,
    *,
    asynchronous: bool = False,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "name": f"{code} course",
        "code": code,
        "delivery_mode": "asynchronous" if asynchronous else "scheduled",
    }
    if asynchronous:
        payload["first_content_available_at"] = "2026-09-02T08:00:00-07:00"
    response = client.post(f"/api/v1/semesters/{semester_id}/courses", json=payload)
    assert response.status_code == 201
    return response.json()


def create_item(
    client: TestClient,
    course_id: object,
    item_type: str,
    name: str,
    due_at: str,
    *,
    required: bool = True,
    weight: float | None = None,
) -> dict[str, object]:
    response = client.post(
        f"/api/v1/courses/{course_id}/academic-items",
        json={
            "item_type": item_type,
            "name": name,
            "due_at": due_at,
            "required": required,
            "direct_weight_percent": weight,
        },
    )
    assert response.status_code == 201
    return response.json()


def resolve_exam(client: TestClient, item: dict[str, object], minutes: int | None = None) -> None:
    payload = (
        {"decision": "student", "minutes": minutes}
        if minutes is not None
        else {"decision": "use_default"}
    )
    response = client.put(f"/api/v1/academic-items/{item['id']}/effort-estimate", json=payload)
    assert response.status_code == 200


def test_assignment_waits_until_linked_lecture_ends_then_front_loads(
    client: TestClient,
) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    course = create_course(client, semester["id"], "CSC 349A")
    lecture = client.post(
        "/api/v1/events",
        json={
            "title": "CSC 349A lecture",
            "semester_id": semester["id"],
            "course_id": course["id"],
            "meeting_kind": "lecture",
            "category": "class",
            "start_at": "2026-09-03T09:00:00-07:00",
            "end_at": "2026-09-03T10:00:00-07:00",
        },
    )
    assert lecture.status_code == 201
    item = create_item(
        client,
        course["id"],
        "assignment",
        "Problem set 1",
        "2026-09-10T23:59:00-07:00",
    )

    proposal = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()
    blocks = [block for block in proposal["blocks"] if block["task_id"] == item["task_id"]]

    lecture_end = datetime.fromisoformat("2026-09-03T10:00:00-07:00")
    assert (
        sum(
            round(
                (
                    datetime.fromisoformat(block["end_at"])
                    - datetime.fromisoformat(block["start_at"])
                ).total_seconds()
                / 60
            )
            for block in blocks
        )
        == 150
    )
    first_start = min(datetime.fromisoformat(block["start_at"]) for block in blocks)
    if first_start.tzinfo is None:
        first_start = first_start.replace(tzinfo=lecture_end.tzinfo)
    assert first_start >= lecture_end
    assert all(block["reason_details"]["readiness_at"] for block in blocks)


def test_exam_preparation_waits_until_course_material_is_available(
    client: TestClient,
) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    course = create_course(client, semester["id"], "CSC 360")
    lecture_end = datetime.fromisoformat("2026-09-04T10:00:00-07:00")
    lecture = client.post(
        "/api/v1/events",
        json={
            "title": "CSC 360 lecture",
            "semester_id": semester["id"],
            "course_id": course["id"],
            "meeting_kind": "lecture",
            "category": "class",
            "start_at": "2026-09-04T09:00:00-07:00",
            "end_at": lecture_end.isoformat(),
        },
    )
    assert lecture.status_code == 201
    exam = create_item(
        client,
        course["id"],
        "midterm",
        "Midterm",
        "2026-09-10T23:59:00-07:00",
    )
    resolve_exam(client, exam, 120)

    proposal = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()
    blocks = [block for block in proposal["blocks"] if block["task_id"] == exam["task_id"]]

    assert blocks
    starts = [datetime.fromisoformat(block["start_at"]) for block in blocks]
    starts = [
        start.replace(tzinfo=lecture_end.tzinfo) if start.tzinfo is None else start
        for start in starts
    ]
    assert all(start >= lecture_end for start in starts)
    assert all(block["reason_details"]["readiness_at"] for block in blocks)


def test_academic_defaults_and_exam_requirement_are_typed(client: TestClient) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    course = create_course(client, semester["id"], "CSC 370", asynchronous=True)
    assignment = create_item(
        client, course["id"], "assignment", "Assignment 1", "2026-09-10T23:59:00Z"
    )
    quiz = create_item(client, course["id"], "quiz", "Quiz 1", "2026-09-09T23:59:00Z")
    midterm = create_item(client, course["id"], "midterm", "Midterm", "2026-09-10T23:59:00Z")
    tasks = {task["id"]: task for task in client.get("/api/v1/tasks").json()}

    assert tasks[assignment["task_id"]]["estimated_minutes"] == 150
    assert tasks[assignment["task_id"]]["estimate_origin"] == "system_default"
    assert tasks[quiz["task_id"]]["estimated_minutes"] == 120
    assert tasks[midterm["task_id"]]["estimate_origin"] == "pending_exam"

    requirements = client.get(
        f"/api/v1/semesters/{semester['id']}/schedule/generation-requirements"
    ).json()
    assert [exam["academic_item_id"] for exam in requirements["exams"]] == [midterm["id"]]
    paused = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals")
    assert paused.status_code == 409
    assert paused.json()["error"]["code"] == "SCHEDULER_ESTIMATE_REQUIRED"

    resolve_exam(client, midterm)
    task = next(
        task for task in client.get("/api/v1/tasks").json() if task["id"] == midterm["task_id"]
    )
    assert task["estimated_minutes"] == 480
    assert task["estimate_origin"] == "system_default"


def test_exam_requirement_does_not_supersede_the_current_proposal(
    client: TestClient,
) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    first = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()
    course = create_course(client, semester["id"], "SENG 310", asynchronous=True)
    create_item(client, course["id"], "midterm", "Midterm", "2026-09-10T23:59:00Z")

    paused = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals")
    current = client.get(f"/api/v1/semesters/{semester['id']}/schedule/proposal").json()

    assert paused.status_code == 409
    assert current["id"] == first["id"]
    assert current["status"] == "proposed"


def test_distant_assignment_uses_spare_capacity_after_flexible_goal(
    client: TestClient,
) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    course = create_course(client, semester["id"], "CSC 320", asynchronous=True)
    distant = create_item(
        client, course["id"], "assignment", "Assignment 4", "2026-10-15T23:59:00Z"
    )
    goal = client.post(
        "/api/v1/goals",
        json={
            "name": "Gym",
            "semester_id": semester["id"],
            "start_date": semester["start_date"],
            "preferred_weekly_minutes": 180,
        },
    ).json()

    proposal = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()

    assert (
        sum(
            round(
                (
                    datetime.fromisoformat(block["end_at"])
                    - datetime.fromisoformat(block["start_at"])
                ).total_seconds()
                / 60
            )
            for block in proposal["blocks"]
            if block["goal_id"] == goal["id"]
        )
        == 360
    )
    assert proposal["generation_summary"]["opportunistic_scheduled_minutes"] == 150
    assert any(block["task_id"] == distant["task_id"] for block in proposal["blocks"])


def test_overlapping_exams_both_receive_generic_preparation(client: TestClient) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    first_course = create_course(client, semester["id"], "CSC 370", asynchronous=True)
    second_course = create_course(client, semester["id"], "SENG 310", asynchronous=True)
    first = create_item(client, first_course["id"], "midterm", "Midterm", "2026-09-10T23:59:00Z")
    second = create_item(client, second_course["id"], "final_exam", "Final", "2026-09-11T23:59:00Z")
    resolve_exam(client, first, 120)
    resolve_exam(client, second, 120)

    proposal = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()

    titles = {block["title"] for block in proposal["blocks"]}
    assert "CSC 370 · Midterm prep" in titles
    assert "SENG 310 · Final exam prep" in titles
    assert {
        entry["estimate_source"] for entry in proposal["generation_summary"]["exam_preparation"]
    } == {"student_provided"}


def test_post_exam_assignment_waits_for_explicit_exam_completion(
    client: TestClient,
) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    course = create_course(client, semester["id"], "CSC 370", asynchronous=True)
    exam = create_item(client, course["id"], "midterm", "Midterm", "2026-09-08T23:59:00Z")
    later = create_item(client, course["id"], "assignment", "Assignment 2", "2026-09-10T23:59:00Z")
    resolve_exam(client, exam, 60)

    before = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()
    assert not any(block["task_id"] == later["task_id"] for block in before["blocks"])

    completed = client.post(f"/api/v1/tasks/{exam['task_id']}/complete")
    assert completed.status_code == 200
    after = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()
    assert any(block["task_id"] == later["task_id"] for block in after["blocks"])


def test_extra_focus_requires_exact_one_draft_decision(client: TestClient) -> None:
    register(client)
    semester = create_semester(client)
    client.patch(
        "/api/v1/preferences",
        json={"maximum_daily_focus_minutes": 120, "freeze_window_minutes": 0},
    )
    replace_weekday_availability(client)
    client.post(
        "/api/v1/tasks",
        json={
            "name": "Required report",
            "estimated_minutes": 3000,
            "deadline_at": "2026-09-15T23:59:00Z",
            "required": True,
        },
    )

    paused = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals")
    assert paused.status_code == 409
    error = paused.json()["error"]
    assert error["code"] == "SCHEDULER_EXTRA_FOCUS_PERMISSION_REQUIRED"
    assert error["details"]["total_extra_minutes"] > 0
    assert client.get(f"/api/v1/semesters/{semester['id']}/schedule/proposal").json() is None

    stale = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/proposals",
        json={
            "extra_focus_decision": {
                "approved": True,
                "request_fingerprint": "0" * 64,
            }
        },
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["details"]["request_fingerprint"] != "0" * 64

    approved = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/proposals",
        json={
            "extra_focus_decision": {
                "approved": True,
                "request_fingerprint": error["details"]["request_fingerprint"],
            }
        },
    )
    assert approved.status_code == 201
    assert approved.json()["generation_summary"]["extra_focus_by_day"]


def test_urgent_buffer_is_used_for_required_work_before_optional_work(
    client: TestClient,
) -> None:
    register(client)
    semester = create_semester(client)
    client.patch(
        "/api/v1/preferences",
        json={"maximum_daily_focus_minutes": 120, "freeze_window_minutes": 0},
    )
    client.put(
        "/api/v1/availability",
        json={
            "windows": [
                {
                    "day_of_week": 2,
                    "start_time": "10:00:00",
                    "end_time": "11:00:00",
                    "type": "available",
                    "energy_level": "medium",
                }
            ]
        },
    )
    required = client.post(
        "/api/v1/tasks",
        json={
            "name": "Required work",
            "estimated_minutes": 50,
            "deadline_at": "2026-09-03T23:59:00Z",
            "required": True,
        },
    ).json()
    optional = client.post(
        "/api/v1/tasks",
        json={
            "name": "Optional work",
            "estimated_minutes": 50,
            "deadline_at": "2026-09-03T23:59:00Z",
            "required": False,
        },
    ).json()

    proposal = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()

    assert any(block["task_id"] == required["id"] for block in proposal["blocks"])
    assert not any(block["task_id"] == optional["id"] for block in proposal["blocks"])
    assert any(
        item["id"] == f"task:{optional['id']}"
        for item in proposal["generation_summary"]["unscheduled"]
    )
    assert any(
        day["consumed_minutes"] == 50 for day in proposal["generation_summary"]["rollover_by_day"]
    )
