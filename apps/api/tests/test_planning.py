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
    client: TestClient, monkeypatch
) -> None:
    from donext import clock

    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 8, 15, tzinfo=UTC))
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


def planning_task(client: TestClient, name: str = "Report", minutes: int = 120) -> dict:
    response = client.post(
        "/api/v1/tasks",
        json={
            "name": name,
            "estimated_minutes": minutes,
            "preferred_session_minutes": 25,
            "deadline_at": "2026-09-30T23:59:00-07:00",
        },
    )
    assert response.status_code == 201
    return response.json()


def planning_block(client: TestClient, semester_id: str, task_id: str, hour: int = 9) -> dict:
    response = client.post(
        f"/api/v1/semesters/{semester_id}/schedule/blocks",
        json={
            "title": "Report session",
            "task_id": task_id,
            "start_at": f"2026-09-13T{hour + 7:02}:00:00Z",
            "end_at": f"2026-09-13T{hour + 7:02}:50:00Z",
            "block_type": "focus",
        },
    )
    assert response.status_code == 201
    return response.json()


def planning_session(client: TestClient, task_id: str, **fields: object) -> dict:
    response = client.post(
        "/api/v1/work-sessions",
        json={
            "task_id": task_id,
            "local_date": "2026-09-13",
            "minutes": 30,
            "outcome": "still_going",
            **fields,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_completed_work_stays_visible_only_on_its_completion_day(
    client: TestClient, monkeypatch
) -> None:
    from donext import clock

    register(client)
    semester = create_semester(client)
    task = planning_task(client)
    block = planning_block(client, semester["id"], task["id"])
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 13, 20, tzinfo=UTC))
    session = planning_session(
        client, task["id"], scheduled_block_id=block["id"], outcome="finished", minutes=20
    )
    planning_session(client, task["id"], outcome="not_started", minutes=0)
    plan = client.get("/api/v1/planning/day?date=2026-09-13").json()
    assert [task["id"] for task in plan["completed_tasks"]] == [task["id"]]
    completed = plan["completed_tasks"][0]
    assert completed["status"] == "completed"
    assert completed["estimated_minutes"] == 120
    assert completed["remaining_minutes"] == 0
    assert completed["logged_minutes"] == 20
    assert completed["estimate_exceeded"] is False
    assert plan["deadlines"] == plan["unscheduled_tasks"] == []
    entry = plan["entries"][0]
    assert entry["task_status"] == "completed"
    assert entry["check_in_outcome"] == "finished"
    assert entry["work_session_id"] == session["id"]
    assert entry["planned_minutes"] == 50
    assert entry["logged_minutes"] == plan["logged_minutes"] == 20
    assert plan["unanswered_blocks"] == plan["rollover_minutes"] == 0
    assert client.get("/api/v1/planning/day?date=2026-09-14").json()["completed_tasks"] == []
    assert len(client.get("/api/v1/planning/week?start=2026-09-07").json()["completed_tasks"]) == 1
    assert client.delete(f"/api/v1/work-sessions/{session['id']}").status_code == 204
    undone = client.get("/api/v1/planning/day?date=2026-09-13").json()
    assert undone["completed_tasks"] == []
    assert undone["entries"][0]["task_status"] == "pending"
    assert undone["unanswered_blocks"] == 1


def test_day_check_ins_distinguish_unanswered_untouched_and_partial_work(
    client: TestClient, monkeypatch
) -> None:
    from donext import clock

    register(client)
    semester = create_semester(client)
    task = planning_task(client)
    blocks = [planning_block(client, semester["id"], task["id"], hour) for hour in (9, 10, 11, 15)]
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 13, 20, tzinfo=UTC))
    planning_session(client, task["id"], scheduled_block_id=blocks[0]["id"])
    planning_session(
        client, task["id"], scheduled_block_id=blocks[1]["id"], outcome="not_started", minutes=0
    )
    plan = client.get("/api/v1/planning/day?date=2026-09-13").json()
    assert [entry["check_in_outcome"] for entry in plan["entries"]] == [
        "still_going",
        "not_started",
        None,
        None,
    ]
    assert plan["unanswered_blocks"] == 1  # The future block needs no close-out answer yet.
    assert plan["rollover_minutes"] == 90  # Count the task once, not once per past block.
    assert plan["logged_minutes"] == 30
    assert plan["deadlines"][0]["logged_minutes"] == 30
    assert plan["deadlines"][0]["remaining_minutes"] == 90
    assert plan["active_timer"] is None


def test_overrun_progress_uses_all_actual_minutes_and_stays_schedulable(
    client: TestClient, monkeypatch
) -> None:
    from donext import clock

    register(client)
    task = planning_task(client, minutes=60)
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 13, 20, tzinfo=UTC))
    planning_session(client, task["id"], local_date="2026-09-12", minutes=40)
    planning_session(client, task["id"], minutes=35)
    plan = client.get("/api/v1/planning/day?date=2026-09-13").json()
    progress = plan["unscheduled_tasks"][0]
    assert progress["status"] == "in_progress"
    assert progress["estimate_exceeded"] is True
    assert progress["estimated_minutes"] == 60
    assert progress["logged_minutes"] == 75
    assert progress["remaining_minutes"] == 25
    assert plan["logged_minutes"] == 35
    assert client.get("/api/v1/planning/week?start=2026-09-07").json()["logged_minutes"] == 75


def test_session_and_timer_match_copied_blocks_by_fingerprint(
    client: TestClient, db_session, monkeypatch
) -> None:
    from uuid import UUID

    from sqlalchemy import select

    from donext import clock
    from donext.models import ScheduledBlock, ScheduleStatus, ScheduleVersion

    register(client)
    semester = create_semester(client)
    task = planning_task(client)
    first = planning_block(client, semester["id"], task["id"])
    second = planning_block(client, semester["id"], task["id"], 11)
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 13, 20, tzinfo=UTC))
    session = planning_session(client, task["id"], scheduled_block_id=first["id"])
    started = client.post(
        "/api/v1/work-timer", json={"task_id": task["id"], "scheduled_block_id": second["id"]}
    )
    assert started.status_code == 201
    original = db_session.get(ScheduledBlock, UUID(first["id"]))
    version = db_session.get(ScheduleVersion, original.schedule_version_id)
    version.status = ScheduleStatus.superseded
    replacement = ScheduleVersion(
        user_id=version.user_id,
        semester_id=version.semester_id,
        version_number=version.version_number + 1,
        reason="Regenerated plan",
        status=ScheduleStatus.accepted,
    )
    db_session.add(replacement)
    db_session.flush()
    for old in db_session.scalars(
        select(ScheduledBlock).where(ScheduledBlock.schedule_version_id == version.id)
    ):
        copied = ScheduledBlock(
            user_id=old.user_id,
            schedule_version_id=replacement.id,
            task_id=old.task_id,
            title=old.title,
            start_at=old.start_at,
            end_at=old.end_at,
            block_type=old.block_type,
        )
        db_session.add(copied)
    db_session.commit()
    plan = client.get("/api/v1/planning/day?date=2026-09-13").json()
    assert plan["entries"][0]["source_id"] != first["id"]
    assert plan["entries"][0]["block_fingerprint"] == session["block_fingerprint"]
    assert plan["entries"][0]["work_session_id"] == session["id"]
    assert plan["entries"][0]["logged_minutes"] == 30
    assert plan["entries"][0]["timer_running"] is False
    assert plan["entries"][1]["timer_running"] is True
    assert plan["active_timer"]["id"] == started.json()["id"]
    assert plan["logged_minutes"] == 30  # A running timer is intent, not logged work.
    assert client.delete("/api/v1/work-timer").status_code == 204
    after = client.get("/api/v1/planning/day?date=2026-09-13").json()
    assert after["active_timer"] is None
    assert not any(entry["timer_running"] for entry in after["entries"])


def test_default_planning_dates_and_totals_use_the_students_local_day(
    client: TestClient, db_session, monkeypatch
) -> None:
    from donext import clock

    register(client)
    task = planning_task(client)
    # Still September 13 in Vancouver, although the server's UTC date is September 14.
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 14, 2, tzinfo=UTC))
    planning_session(client, task["id"], minutes=20, local_date="2026-09-12")
    planning_session(client, task["id"], minutes=30)
    # Historical dates remain stored facts even after the student changes their timezone.
    from sqlalchemy import select

    from donext.models import User

    user = db_session.scalar(select(User))
    user.timezone = "Asia/Kolkata"
    db_session.commit()
    assert client.get("/api/v1/planning/day?date=2026-09-13").json()["logged_minutes"] == 30
    user.timezone = "America/Vancouver"
    db_session.commit()
    plan = client.get("/api/v1/planning/day").json()
    assert plan["start_date"] == plan["end_date"] == "2026-09-13"
    assert plan["logged_minutes"] == 30
    assert client.get("/api/v1/planning/week").json()["start_date"] == "2026-09-07"


def test_goal_check_ins_and_fixed_events_keep_distinct_completion_behavior(
    client: TestClient, monkeypatch
) -> None:
    from donext import clock

    register(client)
    semester = create_semester(client)
    goal = client.post(
        "/api/v1/goals",
        json={
            "name": "Gym",
            "semester_id": semester["id"],
            "category": "personal",
            "start_date": semester["start_date"],
        },
    ).json()
    block_response = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/blocks",
        json={
            "title": "Gym",
            "goal_id": goal["id"],
            "block_type": "goal",
            "start_at": "2026-09-13T16:00:00Z",
            "end_at": "2026-09-13T17:00:00Z",
        },
    )
    assert block_response.status_code == 201
    event_response = client.post(
        "/api/v1/events",
        json={
            "title": "Shift",
            "semester_id": semester["id"],
            "category": "work",
            "start_at": "2026-09-13T18:00:00Z",
            "end_at": "2026-09-13T19:00:00Z",
        },
    )
    assert event_response.status_code == 201
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 13, 20, tzinfo=UTC))
    before = client.get("/api/v1/planning/day?date=2026-09-13").json()
    assert before["unanswered_blocks"] == 1  # Only the goal needs an answer.
    logged = client.post(
        "/api/v1/work-sessions",
        json={
            "goal_id": goal["id"],
            "scheduled_block_id": block_response.json()["id"],
            "local_date": "2026-09-13",
            "minutes": 45,
            "outcome": "finished",
        },
    )
    assert logged.status_code == 201
    after = client.get("/api/v1/planning/day?date=2026-09-13").json()
    assert after["entries"][0]["check_in_outcome"] == "finished"
    assert after["entries"][0]["work_session_id"] == logged.json()["id"]
    assert after["entries"][1]["block_fingerprint"] is None
    assert after["entries"][1]["check_in_outcome"] is None
    assert after["entries"][1]["work_session_id"] is None
    # Completing a commitment is binary; its scheduled duration advances the goal but does not
    # claim that the student measured 45 minutes of academic work.
    assert after["logged_minutes"] == 0
    assert after["unanswered_blocks"] == after["rollover_minutes"] == 0
    assert after["completed_tasks"] == []


def test_planning_completion_state_is_scoped_to_the_signed_in_user(
    client: TestClient, monkeypatch
) -> None:
    from donext import clock

    register(client)
    task = planning_task(client)
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 13, 20, tzinfo=UTC))
    planning_session(client, task["id"], outcome="finished")
    assert client.post("/api/v1/work-timer", json={"task_id": task["id"]}).status_code == 201
    assert client.post("/api/v1/auth/logout").status_code == 200
    registered = client.post(
        "/api/v1/auth/register",
        json={
            "email": "other-student@example.com",
            "password": "a-secure-local-password",
            "name": "Other student",
            "timezone": "America/Vancouver",
        },
    )
    assert registered.status_code == 201
    plan = client.get("/api/v1/planning/day?date=2026-09-13").json()
    assert plan["entries"] == plan["completed_tasks"] == plan["deadlines"] == []
    assert plan["logged_minutes"] == plan["unanswered_blocks"] == plan["rollover_minutes"] == 0
    assert plan["active_timer"] is None
