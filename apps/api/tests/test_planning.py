from datetime import datetime

from fastapi.testclient import TestClient
from test_api import create_semester, register


def replace_weekday_availability(client: TestClient) -> None:
    response = client.put(
        "/api/v1/availability",
        json={
            "windows": [
                {
                    "day_of_week": day,
                    "start_time": "08:00:00",
                    "end_time": "18:00:00",
                    "type": "available",
                    "energy_level": "medium",
                }
                for day in range(5)
            ]
        },
    )
    assert response.status_code == 200


def test_midnight_end_time_means_end_of_selected_day(client: TestClient) -> None:
    register(client)
    response = client.put(
        "/api/v1/availability",
        json={
            "windows": [
                {
                    "day_of_week": 0,
                    "start_time": "10:00:00",
                    "end_time": "00:00:00",
                    "type": "available",
                    "energy_level": "medium",
                }
            ]
        },
    )

    assert response.status_code == 200
    assert response.json()[0]["end_time"] == "00:00:00"
    monday = client.get("/api/v1/planning/day?date=2026-09-07")
    assert monday.status_code == 200
    assert monday.json()["days"][0]["capacity"]["available_minutes"] == 14 * 60


def test_day_plan_combines_real_blocks_events_capacity_and_unscheduled_work(
    client: TestClient,
) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    scheduled_task = client.post(
        "/api/v1/tasks",
        json={"name": "Draft review", "estimated_minutes": 120},
    ).json()
    unscheduled_task = client.post(
        "/api/v1/tasks",
        json={
            "name": "Prepare sources",
            "estimated_minutes": 45,
            "deadline_at": "2026-09-10T23:00:00Z",
            "priority": "high",
        },
    ).json()
    event = client.post(
        "/api/v1/events",
        json={
            "title": "Research methods",
            "semester_id": semester["id"],
            "course_id": client.post(
                f"/api/v1/semesters/{semester['id']}/courses",
                json={"name": "Research Methods", "code": "RSCH 100"},
            ).json()["id"],
            "meeting_kind": "lecture",
            "category": "class",
            "start_at": "2026-09-08T16:00:00Z",
            "end_at": "2026-09-08T17:00:00Z",
            "recurrence_rule": "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261218T235959Z",
            "location": "ECS 125",
            "commute_before_minutes": 15,
            "commute_after_minutes": 15,
        },
    )
    assert event.status_code == 201
    block = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/blocks",
        json={
            "title": "Draft review",
            "task_id": scheduled_task["id"],
            "start_at": "2026-09-08T18:00:00Z",
            "end_at": "2026-09-08T19:00:00Z",
            "block_type": "focus",
        },
    )
    assert block.status_code == 201

    response = client.get("/api/v1/planning/day?date=2026-09-08")
    assert response.status_code == 200
    plan = response.json()
    assert plan["timezone"] == "America/Vancouver"
    assert [entry["title"] for entry in plan["entries"]] == [
        "Research methods",
        "Draft review",
    ]
    assert plan["entries"][0]["start_at"].endswith("-07:00")
    assert plan["entries"][0]["recurring"] is True
    assert plan["entries"][1]["task_status"] == "pending"
    assert plan["next_entry_id"] == plan["entries"][0]["id"]
    assert [task["id"] for task in plan["unscheduled_tasks"]] == [unscheduled_task["id"]]
    assert plan["days"][0]["capacity"] == {
        "available_minutes": 600,
        "commitment_minutes": 90,
        "usable_focus_minutes": 450,
        "planned_focus_minutes": 60,
        "protected_free_minutes": 60,
        "remaining_focus_minutes": 390,
        "derived_preferred_sleep_minutes": 480,
    }


def test_weekly_recurrence_preserves_local_time_across_daylight_saving(
    client: TestClient,
) -> None:
    registered = client.post(
        "/api/v1/auth/register",
        json={
            "email": "new-york@example.com",
            "password": "a-secure-local-password",
            "name": "Nikhil Dhillon",
            "timezone": "America/New_York",
        },
    )
    assert registered.status_code == 201
    semester = create_semester(client)
    response = client.post(
        "/api/v1/events",
        json={
            "title": "Sunday practice",
            "semester_id": semester["id"],
            "category": "personal",
            "start_at": "2026-10-25T13:00:00Z",
            "end_at": "2026-10-25T14:00:00Z",
            "recurrence_rule": "FREQ=WEEKLY;BYDAY=SU;UNTIL=20261218T235959Z",
        },
    )
    assert response.status_code == 201

    plan = client.get("/api/v1/planning/week?start=2026-10-26").json()
    occurrence = next(entry for entry in plan["entries"] if entry["title"] == "Sunday practice")
    starts = datetime.fromisoformat(occurrence["start_at"])
    assert starts.date().isoformat() == "2026-11-01"
    assert starts.hour == 9
    assert starts.utcoffset().total_seconds() == -5 * 60 * 60


def test_semester_plan_uses_stored_demand_capacity_and_deadlines(client: TestClient) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    course = client.post(
        f"/api/v1/semesters/{semester['id']}/courses",
        json={"name": "Algorithms", "code": "CSC 320"},
    ).json()
    task = client.post(
        "/api/v1/tasks",
        json={
            "name": "Problem set 3",
            "course_id": course["id"],
            "estimated_minutes": 120,
            "deadline_at": "2026-10-10T23:00:00Z",
        },
    )
    assert task.status_code == 201

    response = client.get(f"/api/v1/planning/semesters/{semester['id']}")
    assert response.status_code == 200
    summary = response.json()
    assert summary["semester"]["id"] == semester["id"]
    assert summary["total_demand_minutes"] == 120
    assert summary["total_capacity_minutes"] > summary["total_demand_minutes"]
    assert summary["open_capacity_minutes"] > 0
    assert summary["incomplete_data"] is False
    assert len(summary["weeks"]) == 16
    assert summary["deadlines"][0]["name"] == "Problem set 3"
    assert summary["deadlines"][0]["course_code"] == "CSC 320"
    assert summary["deadlines"][0]["remaining_minutes"] == 120
    # Course work always gets a backing academic item, which is the route that edits it.
    assert summary["deadlines"][0]["kind"] == "academic_item"
    assert summary["deadlines"][0]["course_id"] == course["id"]
    assert summary["deadlines"][0]["item_type"] == "other"


def test_semester_deadline_for_goal_work_stays_a_task(client: TestClient) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    goal = client.post(
        "/api/v1/goals",
        json={
            "name": "Portfolio",
            "semester_id": semester["id"],
            "category": "personal",
            "start_date": semester["start_date"],
            "planning_kind": "goal",
        },
    ).json()
    task = client.post(
        "/api/v1/tasks",
        json={
            "name": "Publish case study",
            "goal_id": goal["id"],
            "estimated_minutes": 120,
            "deadline_at": "2026-10-10T23:00:00Z",
        },
    ).json()

    summary = client.get(f"/api/v1/planning/semesters/{semester['id']}").json()
    deadline = next(
        value for value in summary["deadlines"] if value["name"] == "Publish case study"
    )
    assert deadline["kind"] == "task"
    assert deadline["id"] == task["id"]
    assert deadline["course_id"] is None
    assert deadline["item_type"] is None


def test_semester_deadlines_identify_editable_course_work(client: TestClient) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    course = client.post(
        f"/api/v1/semesters/{semester['id']}/courses",
        json={"name": "Algorithms", "code": "CSC 320"},
    ).json()
    item = client.post(
        f"/api/v1/courses/{course['id']}/academic-items",
        json={
            "item_type": "midterm",
            "name": "Midterm 1",
            "due_at": "2026-10-20T18:00:00Z",
            "direct_weight_percent": 15,
            "estimated_minutes": 240,
        },
    ).json()

    summary = client.get(f"/api/v1/planning/semesters/{semester['id']}").json()
    deadline = next(value for value in summary["deadlines"] if value["name"] == "Midterm 1")
    assert deadline["kind"] == "academic_item"
    assert deadline["id"] == item["id"]
    assert deadline["course_id"] == course["id"]
    assert deadline["item_type"] == "midterm"
    assert deadline["weight_percent"] == 15
    assert deadline["remaining_minutes"] == 240

    assert client.delete(f"/api/v1/academic-items/{item['id']}").status_code == 204
    after = client.get(f"/api/v1/planning/semesters/{semester['id']}").json()
    assert all(value["name"] != "Midterm 1" for value in after["deadlines"])


def test_week_plan_keeps_scheduled_deadlines_with_their_item_type_and_status(
    client: TestClient,
) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    course = client.post(
        f"/api/v1/semesters/{semester['id']}/courses",
        json={"name": "Algorithms", "code": "CSC 320"},
    ).json()
    midterm = client.post(
        f"/api/v1/courses/{course['id']}/academic-items",
        json={"item_type": "midterm", "name": "Midterm 1", "due_at": "2026-09-10T23:59:00Z"},
    )
    assert midterm.status_code == 201
    assignment = client.post(
        f"/api/v1/courses/{course['id']}/academic-items",
        json={"item_type": "assignment", "name": "Assignment 1", "due_at": "2026-09-11T23:59:00Z"},
    )
    assert assignment.status_code == 201
    plain_task = client.post(
        "/api/v1/tasks",
        json={"name": "Read ahead", "estimated_minutes": 30, "deadline_at": "2026-09-12T23:59:00Z"},
    )
    assert plain_task.status_code == 201
    before = client.get("/api/v1/planning/week?start=2026-09-07").json()
    remaining_before = {task["name"]: task["remaining_minutes"] for task in before["deadlines"]}

    # An item's due date still belongs on the calendar once its work has a place, so scheduling
    # the assignment must not remove it from the deadline picture the way finishing it would.
    scheduled = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/blocks",
        json={
            "title": "Work on Assignment 1",
            "task_id": assignment.json()["task_id"],
            "start_at": "2026-09-09T18:00:00Z",
            "end_at": "2026-09-09T19:00:00Z",
            "block_type": "focus",
        },
    )
    assert scheduled.status_code == 201

    plan = client.get("/api/v1/planning/week?start=2026-09-07").json()
    tasks_by_name = {task["name"]: task for task in plan["unscheduled_tasks"]}
    deadlines_by_name = {task["name"]: task for task in plan["deadlines"]}
    assert tasks_by_name["Midterm 1"]["item_type"] == "midterm"
    assert tasks_by_name["Midterm 1"]["status"] == "pending"
    assert tasks_by_name["Read ahead"]["item_type"] is None
    # Once it has a block, it leaves the unscheduled-work list, but its due date has not moved.
    assert "Assignment 1" not in tasks_by_name
    assert deadlines_by_name["Assignment 1"]["item_type"] == "assignment"
    assert deadlines_by_name["Assignment 1"]["status"] == "pending"
    assert (
        deadlines_by_name["Assignment 1"]["remaining_minutes"] == remaining_before["Assignment 1"]
    )
