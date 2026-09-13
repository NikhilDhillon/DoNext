from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from test_api import create_semester, register

from donext.models import Task
from donext.planning import weekly_task_demand


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
        "usable_focus_minutes": 420,
        "planned_focus_minutes": 60,
        "protected_free_minutes": 60,
        "remaining_focus_minutes": 360,
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


UTC_ZONE = ZoneInfo("UTC")


def minutes_by_week(shares: dict[date, list[tuple[Task, int]]], weeks: list[date]) -> list[int]:
    return [sum(minutes for _task, minutes in shares[week]) for week in weeks]


def week_starts(count: int) -> list[date]:
    return [date(2026, 9, 2) + timedelta(days=7 * offset) for offset in range(count)]


def spread_task(minutes: int, deadline: date, earliest: date | None = None) -> Task:
    return Task(
        remaining_minutes=minutes,
        deadline_at=datetime.combine(deadline, time(23, 0), tzinfo=UTC),
        earliest_start_at=(
            datetime.combine(earliest, time(9, 0), tzinfo=UTC) if earliest else None
        ),
    )


def test_week_demand_paces_long_work_backwards_from_its_deadline() -> None:
    weeks = week_starts(8)
    # Twenty hours needs four weeks at a sustainable pace, so it reaches back to week three.
    demand = weekly_task_demand(
        [spread_task(1200, date(2026, 10, 7))], weeks, UTC_ZONE, date(2026, 9, 2)
    )

    assert minutes_by_week(demand, weeks) == [0, 0, 300, 300, 300, 300, 0, 0]


def test_week_demand_leaves_short_work_in_its_deadline_week() -> None:
    weeks = week_starts(8)
    demand = weekly_task_demand(
        [spread_task(120, date(2026, 10, 7))], weeks, UTC_ZONE, date(2026, 9, 2)
    )

    assert minutes_by_week(demand, weeks) == [0, 0, 0, 0, 0, 120, 0, 0]


def test_week_demand_never_reaches_into_weeks_that_have_passed() -> None:
    weeks = week_starts(8)
    demand = weekly_task_demand(
        [spread_task(1200, date(2026, 10, 7))], weeks, UTC_ZONE, date(2026, 9, 30)
    )

    # Only two weeks are left to absorb the same twenty hours, so each carries twice as much.
    assert minutes_by_week(demand, weeks) == [0, 0, 0, 0, 600, 600, 0, 0]


def test_week_demand_holds_work_until_its_earliest_start() -> None:
    weeks = week_starts(8)
    demand = weekly_task_demand(
        [spread_task(1200, date(2026, 10, 7), earliest=date(2026, 10, 1))],
        weeks,
        UTC_ZONE,
        date(2026, 9, 2),
    )

    assert minutes_by_week(demand, weeks) == [0, 0, 0, 0, 600, 600, 0, 0]


def test_week_demand_lands_overdue_work_on_the_week_in_hand() -> None:
    weeks = week_starts(8)
    demand = weekly_task_demand(
        [spread_task(1200, date(2026, 9, 4))], weeks, UTC_ZONE, date(2026, 9, 30)
    )

    assert minutes_by_week(demand, weeks) == [0, 0, 0, 0, 1200, 0, 0, 0]


def test_week_demand_keeps_every_minute_and_weights_the_deadline_end() -> None:
    weeks = week_starts(8)
    demand = weekly_task_demand(
        [spread_task(1010, date(2026, 10, 7))], weeks, UTC_ZONE, date(2026, 9, 2)
    )

    assert minutes_by_week(demand, weeks) == [0, 0, 252, 252, 253, 253, 0, 0]
    assert sum(minutes_by_week(demand, weeks)) == 1010


def test_semester_weeks_show_a_long_project_before_it_comes_due(client: TestClient) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    course = client.post(
        f"/api/v1/semesters/{semester['id']}/courses",
        json={"name": "Algorithms", "code": "CSC 320"},
    ).json()
    client.post(
        "/api/v1/tasks",
        json={
            "name": "Term project",
            "course_id": course["id"],
            "estimated_minutes": 1200,
            "deadline_at": "2026-11-20T23:00:00Z",
        },
    )

    summary = client.get(f"/api/v1/planning/semesters/{semester['id']}").json()
    loaded = [week for week in summary["weeks"] if week["demand_minutes"]]

    assert len(loaded) > 1
    assert sum(week["demand_minutes"] for week in loaded) == 1200
    # The work stops at the deadline week and never spills past it.
    assert loaded[-1]["start_date"] <= "2026-11-20" <= loaded[-1]["end_date"]


def block_out_week(client: TestClient, semester: dict[str, str]) -> None:
    """Fill 2026-10-14 through 2026-10-20 with a commitment, leaving that week no capacity."""
    response = client.post(
        "/api/v1/events",
        json={
            "title": "Field school",
            "semester_id": semester["id"],
            "category": "personal",
            "start_at": "2026-10-14T07:00:00Z",
            "end_at": "2026-10-21T07:00:00Z",
        },
    )
    assert response.status_code == 201


def test_week_without_capacity_is_only_at_risk_when_work_is_due_in_it(
    client: TestClient,
) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    block_out_week(client, semester)

    summary = client.get(f"/api/v1/planning/semesters/{semester['id']}").json()
    blocked = next(week for week in summary["weeks"] if week["start_date"] == "2026-10-14")

    assert blocked["capacity_minutes"] == 0
    assert blocked["demand_minutes"] == 0
    assert blocked["load_percent"] is None
    # A reading break has no usable time and nothing to spend it on. That is not a risk.
    assert blocked["risk"] == "low"
    assert all(week["risk"] != "high" for week in summary["weeks"])


def test_work_due_in_a_week_without_capacity_stays_at_risk(client: TestClient) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    block_out_week(client, semester)
    course = client.post(
        f"/api/v1/semesters/{semester['id']}/courses",
        json={"name": "Algorithms", "code": "CSC 320"},
    ).json()
    client.post(
        "/api/v1/tasks",
        json={
            "name": "Lab writeup",
            "course_id": course["id"],
            "estimated_minutes": 120,
            "deadline_at": "2026-10-16T23:00:00Z",
        },
    )

    summary = client.get(f"/api/v1/planning/semesters/{semester['id']}").json()
    blocked = next(week for week in summary["weeks"] if week["start_date"] == "2026-10-14")

    assert blocked["capacity_minutes"] == 0
    assert blocked["demand_minutes"] == 120
    assert blocked["risk"] == "high"


def test_planning_capacity_stops_at_the_daily_focus_maximum(client: TestClient) -> None:
    register(client)
    replace_weekday_availability(client)

    capacity = client.get("/api/v1/planning/day?date=2026-09-08").json()["days"][0]["capacity"]

    assert capacity["available_minutes"] == 600
    # Ten open hours is more focus than the 480 minute daily maximum the scheduler will
    # book, so the forecast stops at the same ceiling before holding the buffer back.
    assert capacity["usable_focus_minutes"] == 420
    assert capacity["protected_free_minutes"] == 60


def test_planning_capacity_follows_the_students_focus_maximum(client: TestClient) -> None:
    register(client)
    replace_weekday_availability(client)
    assert (
        client.patch("/api/v1/preferences", json={"maximum_daily_focus_minutes": 240}).status_code
        == 200
    )

    capacity = client.get("/api/v1/planning/day?date=2026-09-08").json()["days"][0]["capacity"]

    assert capacity["usable_focus_minutes"] == 180


def test_planning_capacity_excludes_time_past_bedtime(client: TestClient) -> None:
    register(client)
    response = client.put(
        "/api/v1/availability",
        json={
            "windows": [
                {
                    "day_of_week": 1,
                    "start_time": "18:00:00",
                    "end_time": "00:00:00",
                    "type": "available",
                    "energy_level": "medium",
                }
            ]
        },
    )
    assert response.status_code == 200

    capacity = client.get("/api/v1/planning/day?date=2026-09-08").json()["days"][0]["capacity"]

    # Six hours are declared available, but the five past the 23:00 bedtime are not capacity.
    assert capacity["available_minutes"] == 360
    assert capacity["usable_focus_minutes"] == 240


def test_week_demand_sources_name_the_work_that_loads_a_week(client: TestClient) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    course = client.post(
        f"/api/v1/semesters/{semester['id']}/courses",
        json={"name": "Algorithms", "code": "CSC 320"},
    ).json()
    client.post(
        "/api/v1/tasks",
        json={
            "name": "Term project",
            "course_id": course["id"],
            "estimated_minutes": 1200,
            "deadline_at": "2026-11-20T23:00:00Z",
        },
    )

    summary = client.get(f"/api/v1/planning/semesters/{semester['id']}").json()
    loaded = [week for week in summary["weeks"] if week["demand_minutes"]]

    # The earlier weeks carry paced work that is not due in them, which is the whole reason
    # the panel lists sources instead of the week's own deadlines.
    early = loaded[0]
    assert [source["name"] for source in early["demand_sources"]] == ["Term project"]
    assert early["demand_sources"][0]["course_code"] == "CSC 320"
    assert early["demand_sources"][0]["due_this_week"] is False
    assert early["demand_sources"][0]["remaining_minutes"] == 1200

    # Each week's sources add up to exactly that week's bar.
    for week in loaded:
        assert sum(source["minutes"] for source in week["demand_sources"]) == week["demand_minutes"]
    assert loaded[-1]["demand_sources"][0]["due_this_week"] is True
