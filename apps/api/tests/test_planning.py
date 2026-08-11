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
        "usable_focus_minutes": 434,
        "planned_focus_minutes": 60,
        "protected_free_minutes": 76,
        "remaining_focus_minutes": 374,
        "preferred_sleep_minutes": 480,
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
