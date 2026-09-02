from datetime import UTC, datetime
from typing import cast

from fastapi.testclient import TestClient
from test_api import create_semester, register
from test_planning import replace_weekday_availability

from donext.routers import proposals


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

    response = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals")
    assert response.status_code == 201, response.text
    proposal = response.json()
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


def test_exam_preparation_unlocks_proportionally_after_recurring_lectures(
    client: TestClient,
) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    course = create_course(client, semester["id"], "CSC 361")
    lecture = client.post(
        "/api/v1/events",
        json={
            "title": "CSC 361 lecture",
            "semester_id": semester["id"],
            "course_id": course["id"],
            "meeting_kind": "lecture",
            "category": "class",
            "start_at": "2026-09-02T09:00:00-07:00",
            "end_at": "2026-09-02T10:00:00-07:00",
            "recurrence_rule": "FREQ=WEEKLY;BYDAY=WE;UNTIL=20260910T235959Z",
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
    second_lecture_end = datetime.fromisoformat("2026-09-09T10:00:00-07:00")
    before_second = sum(
        round(
            (
                datetime.fromisoformat(block["end_at"]) - datetime.fromisoformat(block["start_at"])
            ).total_seconds()
            / 60
        )
        for block in blocks
        if datetime.fromisoformat(block["start_at"]).replace(
            tzinfo=datetime.fromisoformat(block["start_at"]).tzinfo or second_lecture_end.tzinfo
        )
        < second_lecture_end
    )
    exam_summary = proposal["generation_summary"]["exam_preparation"][0]

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
        == 120
    )
    assert before_second <= 60
    assert exam_summary["material_release"]["method"] == "lecture_proportion"
    assert exam_summary["material_release"]["total_checkpoints"] == 2


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


def test_proven_future_pressure_promotes_only_required_distant_minutes(
    client: TestClient,
) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    client.patch("/api/v1/preferences", json={"freeze_window_minutes": 0})
    client.put(
        "/api/v1/availability",
        json={
            "windows": [
                {
                    "day_of_week": day,
                    "start_time": "10:00:00",
                    "end_time": "11:00:00",
                    "type": "available",
                    "energy_level": "medium",
                }
                for day in range(5)
            ]
        },
    )
    course = create_course(client, semester["id"], "CSC 421", asynchronous=True)
    distant = create_item(
        client,
        course["id"],
        "assignment",
        "Capacity project",
        "2026-09-16T23:59:00Z",
    )

    proposal = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()
    pressure = proposal["generation_summary"]["semester_pressure"]

    assert any(entry["required_lead_minutes"] == 150 for entry in pressure)
    assert any(
        promoted["task_id"] == distant["task_id"]
        for entry in pressure
        for promoted in entry.get("promoted_items", [])
    )
    unresolved = proposal["generation_summary"]["unscheduled"]
    assert any(item["id"].endswith(":lead") for item in unresolved)


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
    assert error["details"]["required_minutes_gained"] > 0
    assert error["details"]["approved_capacity_by_day"]
    assert error["details"]["protected_items"] == error["details"]["protected_work"]
    assert (
        sum(day["minutes"] for day in error["details"]["extra_minutes_by_day"])
        == error["details"]["total_extra_minutes"]
    )
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
    assert approved.status_code == 201, approved.text
    approved_days = approved.json()["generation_summary"]["extra_focus_by_day"]
    assert approved_days
    assert all(day["used_minutes"] <= day["approved_minutes"] for day in approved_days)


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


def _flexible_goal(client: TestClient, semester: dict[str, object]) -> None:
    response = client.post(
        "/api/v1/goals",
        json={
            "name": "Portfolio",
            "semester_id": semester["id"],
            "category": "personal",
            "start_date": semester["start_date"],
            "planning_kind": "goal",
            "minimum_weekly_minutes": 60,
            "preferred_weekly_minutes": 600,
            "maximum_weekly_minutes": 700,
            "minimum_session_minutes": 30,
            "preferred_session_minutes": 30,
            "maximum_session_minutes": 30,
        },
    )
    assert response.status_code == 201


def _pressured_plan(client: TestClient) -> dict[str, object]:
    """A 48-hour deadline that only fits once the rollover buffer is released."""

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
                    "day_of_week": day,
                    "start_time": "10:00:00",
                    "end_time": "13:00:00",
                    "type": "available",
                    "energy_level": "medium",
                }
                for day in range(7)
            ]
        },
    )
    _flexible_goal(client, semester)
    client.post(
        "/api/v1/tasks",
        json={
            "name": "Required work",
            "estimated_minutes": 90,
            "deadline_at": "2026-09-02T23:59:00-07:00",
            "required": True,
        },
    )
    return cast(
        dict[str, object],
        client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json(),
    )


def test_capacity_passes_still_name_the_work_a_block_displaced(client: TestClient) -> None:
    register(client)
    proposal = _pressured_plan(client)
    blocks = cast(list[dict[str, object]], proposal["blocks"])

    # The buffer pass solves with untouched work pinned to what it already had, which hides
    # every shortfall from the solver's own displacement pass. The block still has to name the
    # goal time it cost.
    required = [
        cast(dict[str, object], block["reason_details"])
        for block in blocks
        if block["title"] == "Required work"
    ]
    assert required
    assert all(detail["capacity_source"] == "rollover" for detail in required)
    assert all(detail["displaced_title"] == "Portfolio" for detail in required)
    assert all(detail["displaced_kind"] == "goal" for detail in required)


def test_sleep_fallback_uses_the_higher_energy_edge_and_reports_exact_blocks(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        proposals,
        "_planning_now",
        lambda: datetime(2026, 9, 2, 14, 0, tzinfo=UTC),
    )
    register(client)
    semester = create_semester(client)
    client.patch(
        "/api/v1/preferences",
        json={
            "default_sleep_time": "23:00:00",
            "default_wake_time": "08:00:00",
            "minimum_sleep_minutes": 480,
            "maximum_daily_focus_minutes": 600,
            "minimum_break_minutes": 10,
            "freeze_window_minutes": 0,
        },
    )
    client.put(
        "/api/v1/availability",
        json={
            "windows": [
                {
                    "day_of_week": 2,
                    "start_time": "07:00:00",
                    "end_time": "09:00:00",
                    "type": "available",
                    "energy_level": "high",
                },
                {
                    "day_of_week": 2,
                    "start_time": "22:00:00",
                    "end_time": "00:00:00",
                    "type": "available",
                    "energy_level": "low",
                },
            ]
        },
    )
    task = client.post(
        "/api/v1/tasks",
        json={
            "name": "Urgent report",
            "estimated_minutes": 150,
            "minimum_session_minutes": 50,
            "preferred_session_minutes": 50,
            "maximum_session_minutes": 50,
            "deadline_at": "2026-09-03T23:59:00-07:00",
            "required": True,
        },
    ).json()

    response = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals")
    assert response.status_code == 201
    proposal = response.json()
    blocks = [block for block in proposal["blocks"] if block["task_id"] == task["id"]]
    local_starts = [datetime.fromisoformat(block["start_at"]) for block in blocks]
    local_ends = [datetime.fromisoformat(block["end_at"]) for block in blocks]

    assert len(blocks) == 3
    assert any(start.hour < 8 for start in local_starts)
    assert all(end.hour < 23 or (end.hour == 23 and end.minute == 0) for end in local_ends)
    assert proposal["generation_summary"]["sleep_by_day"] == [
        {
            "date": "2026-09-02",
            "preferred_minutes": 540,
            "planned_minutes": 480,
            "reduction_minutes": 60,
            "minimum_minutes": 480,
        }
    ]
    reduced_sleep_blocks = [
        block for block in blocks if block["reason_details"]["reduced_sleep_capacity_used"]
    ]
    assert len(reduced_sleep_blocks) == 1
    assert reduced_sleep_blocks[0]["reason_details"]["sleep_reduction_minutes"] == 60


def test_deadline_earlier_today_is_overdue_at_the_captured_generation_instant(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        proposals,
        "_planning_now",
        lambda: datetime(2026, 9, 2, 18, 0, tzinfo=UTC),
    )
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    client.patch("/api/v1/preferences", json={"freeze_window_minutes": 0})
    overdue = client.post(
        "/api/v1/tasks",
        json={
            "name": "Earlier today",
            "estimated_minutes": 50,
            "deadline_at": "2026-09-02T17:00:00Z",
            "required": True,
        },
    ).json()

    response = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals")
    assert response.status_code == 201, response.text
    proposal = response.json()
    block = next(block for block in proposal["blocks"] if block["task_id"] == overdue["id"])

    assert block["reason_details"]["primary_priority_reason"] == "overdue"
    assert block["reason_details"]["risk_tier"] == 5
    assert any("was due" in warning for warning in proposal["generation_summary"]["warnings"])


def test_subminimum_remainder_is_visible_with_the_smallest_session_setting_change(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        proposals,
        "_planning_now",
        lambda: datetime(2026, 9, 2, 14, 0, tzinfo=UTC),
    )
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    client.patch("/api/v1/preferences", json={"freeze_window_minutes": 0})
    created = client.post(
        "/api/v1/tasks",
        json={
            "name": "Odd remainder",
            "estimated_minutes": 15,
            "minimum_session_minutes": 10,
            "preferred_session_minutes": 10,
            "maximum_session_minutes": 10,
            "deadline_at": "2026-09-08T23:59:00Z",
            "required": True,
        },
    ).json()

    proposal = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()
    unresolved = next(
        item
        for item in proposal["generation_summary"]["unscheduled"]
        if item["id"] == f"task:{created['id']}"
    )

    assert unresolved["remaining_minutes"] == 5
    assert unresolved["capacity_needed_minutes"] == 0
    assert unresolved["reason_code"] == "BELOW_MINIMUM_SESSION"
    assert unresolved["session_setting_change"] == {
        "minimum_session_minutes": 5,
        "decrease_minutes": 5,
    }


def test_impossible_plan_sacrifices_lower_same_day_weight_and_reports_exact_shortfall(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        proposals,
        "_planning_now",
        lambda: datetime(2026, 9, 2, 14, 0, tzinfo=UTC),
    )
    register(client)
    semester = create_semester(client)
    client.patch("/api/v1/preferences", json={"freeze_window_minutes": 0})
    client.put(
        "/api/v1/availability",
        json={
            "windows": [
                {
                    "day_of_week": 2,
                    "start_time": "10:00:00",
                    "end_time": "10:50:00",
                    "type": "available",
                    "energy_level": "medium",
                }
            ]
        },
    )
    course = create_course(client, semester["id"], "CSC 499", asynchronous=True)
    low = create_item(
        client,
        course["id"],
        "assignment",
        "Low-weight report",
        "2026-09-02T23:59:00-07:00",
        weight=5,
    )
    high = create_item(
        client,
        course["id"],
        "assignment",
        "High-weight report",
        "2026-09-02T23:59:00-07:00",
        weight=30,
    )
    for item in (low, high):
        response = client.patch(
            f"/api/v1/tasks/{item['task_id']}",
            json={
                "estimated_minutes": 50,
                "remaining_minutes": 50,
                "minimum_session_minutes": 50,
                "preferred_session_minutes": 50,
                "maximum_session_minutes": 50,
            },
        )
        assert response.status_code == 200

    response = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals")
    assert response.status_code == 201, response.text
    proposal = response.json()
    unresolved = next(
        item
        for item in proposal["generation_summary"]["unscheduled"]
        if item["id"] == f"task:{low['task_id']}"
    )

    assert any(block["task_id"] == high["task_id"] for block in proposal["blocks"])
    assert not any(block["task_id"] == low["task_id"] for block in proposal["blocks"])
    assert unresolved["remaining_minutes"] == 50
    assert unresolved["capacity_needed_minutes"] == 50
