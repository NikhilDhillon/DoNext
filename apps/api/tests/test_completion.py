from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from test_api import create_semester, register
from test_planning import replace_weekday_availability

from donext import clock
from donext.models import ScheduledBlock, ScheduleStatus, ScheduleVersion


def create_task(
    client: TestClient,
    *,
    name: str = "Write the report",
    estimated_minutes: int = 120,
    deadline_at: str | None = "2026-09-30T23:59:00-07:00",
    preferred_session_minutes: int = 50,
) -> dict[str, object]:
    response = client.post(
        "/api/v1/tasks",
        json={
            "name": name,
            "estimated_minutes": estimated_minutes,
            "deadline_at": deadline_at,
            "preferred_session_minutes": preferred_session_minutes,
        },
    )
    assert response.status_code == 201
    return response.json()


def test_confirming_a_block_reduces_remaining_and_marks_in_progress(
    client: TestClient, monkeypatch
) -> None:
    """Scenario 23: confirming a planned duration reduces remaining work and leaves the estimate."""
    register(client)
    task = create_task(client, estimated_minutes=120)
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 13, 20, tzinfo=UTC))

    logged = client.post(
        "/api/v1/work-sessions",
        json={
            "task_id": task["id"],
            "local_date": "2026-09-13",
            "minutes": 50,
            "outcome": "still_going",
            "source": "quick_confirm",
        },
    )
    assert logged.status_code == 201
    assert logged.json()["minutes"] == 50

    after = client.get(f"/api/v1/tasks/{task['id']}").json()
    assert after["status"] == "in_progress"
    assert after["remaining_minutes"] == 70
    assert after["estimated_minutes"] == 120


def test_timer_start_and_stop_logs_measured_minutes_with_correction(
    client: TestClient, monkeypatch
) -> None:
    """Scenario 24: the timer logs measured minutes, and the figure can be corrected."""
    register(client)
    task = create_task(client, estimated_minutes=120)

    start = datetime(2026, 9, 13, 12, tzinfo=UTC)
    monkeypatch.setattr(clock, "now", lambda: start)
    started = client.post("/api/v1/work-timer", json={"task_id": task["id"]})
    assert started.status_code == 201

    monkeypatch.setattr(clock, "now", lambda: start + timedelta(minutes=25))
    stopped = client.post("/api/v1/work-timer/stop", json={"outcome": "still_going"})
    assert stopped.status_code == 200
    assert stopped.json()["minutes"] == 25
    assert client.get("/api/v1/work-timer").json() is None

    monkeypatch.setattr(clock, "now", lambda: start + timedelta(minutes=30))
    client.post("/api/v1/work-timer", json={"task_id": task["id"]})
    monkeypatch.setattr(clock, "now", lambda: start + timedelta(minutes=60))
    corrected = client.post(
        "/api/v1/work-timer/stop", json={"outcome": "still_going", "minutes": 20}
    )
    assert corrected.status_code == 200
    # 30 minutes measured, corrected down to 20 before saving.
    assert corrected.json()["minutes"] == 20


def test_ticking_the_same_block_twice_corrects_instead_of_doubling(
    client: TestClient, monkeypatch
) -> None:
    """Scenario 25: a second tick on the same block corrects the first rather than doubling it."""
    register(client)
    semester = create_semester(client)
    task = create_task(client, estimated_minutes=120)
    block = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/blocks",
        json={
            "title": task["name"],
            "task_id": task["id"],
            "start_at": "2026-09-13T09:00:00-07:00",
            "end_at": "2026-09-13T09:50:00-07:00",
        },
    ).json()

    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 13, 20, tzinfo=UTC))
    first = client.post(
        "/api/v1/work-sessions",
        json={
            "task_id": task["id"],
            "scheduled_block_id": block["id"],
            "local_date": "2026-09-13",
            "minutes": 50,
            "outcome": "finished",
            "source": "quick_confirm",
        },
    )
    assert first.status_code == 201

    second = client.post(
        "/api/v1/work-sessions",
        json={
            "task_id": task["id"],
            "scheduled_block_id": block["id"],
            "local_date": "2026-09-13",
            "minutes": 30,
            "outcome": "still_going",
            "source": "quick_confirm",
        },
    )
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]

    sessions = client.get("/api/v1/work-sessions").json()
    assert len(sessions) == 1
    assert sessions[0]["minutes"] == 30

    after = client.get(f"/api/v1/tasks/{task['id']}").json()
    assert after["remaining_minutes"] == 90
    assert after["status"] == "in_progress"


def test_reporting_a_block_untouched_leaves_estimate_and_remaining_unchanged(
    client: TestClient, monkeypatch
) -> None:
    """Scenario 26: an unanswered-as-untouched block changes nothing and stays outstanding."""
    register(client)
    task = create_task(client, estimated_minutes=120)
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 13, 20, tzinfo=UTC))

    response = client.post(
        "/api/v1/work-sessions",
        json={
            "task_id": task["id"],
            "local_date": "2026-09-13",
            "minutes": 0,
            "outcome": "not_started",
            "source": "quick_confirm",
        },
    )
    assert response.status_code == 201

    after = client.get(f"/api/v1/tasks/{task['id']}").json()
    assert after["remaining_minutes"] == 120
    assert after["estimated_minutes"] == 120
    assert after["status"] == "pending"


def test_logging_past_the_estimate_keeps_work_visible_without_going_negative(
    client: TestClient, monkeypatch
) -> None:
    """Scenario 27: overrunning the estimate holds remaining at one preferred session."""
    register(client)
    task = create_task(client, estimated_minutes=60, preferred_session_minutes=25)
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 13, 20, tzinfo=UTC))

    response = client.post(
        "/api/v1/work-sessions",
        json={
            "task_id": task["id"],
            "local_date": "2026-09-13",
            "minutes": 80,
            "outcome": "still_going",
            "source": "manual",
        },
    )
    assert response.status_code == 201

    after = client.get(f"/api/v1/tasks/{task['id']}").json()
    assert after["estimated_minutes"] == 60
    assert after["remaining_minutes"] == 25
    assert after["status"] == "in_progress"


def test_finishing_early_completes_and_releases_future_accepted_blocks(
    client: TestClient, monkeypatch
) -> None:
    """Scenario 28: finishing early completes the task and hands back blocks not yet started."""
    register(client)
    semester = create_semester(client)
    task = create_task(client, estimated_minutes=120)
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 13, 12, tzinfo=UTC))

    future_block = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/blocks",
        json={
            "title": task["name"],
            "task_id": task["id"],
            "start_at": "2026-09-14T09:00:00-07:00",
            "end_at": "2026-09-14T09:50:00-07:00",
        },
    )
    assert future_block.status_code == 201

    response = client.post(
        "/api/v1/work-sessions",
        json={
            "task_id": task["id"],
            "local_date": "2026-09-13",
            "minutes": 120,
            "outcome": "finished",
            "source": "manual",
        },
    )
    assert response.status_code == 201

    after = client.get(f"/api/v1/tasks/{task['id']}").json()
    assert after["status"] == "completed"
    assert after["remaining_minutes"] == 0

    schedule = client.get(f"/api/v1/semesters/{semester['id']}/schedule").json()
    assert not [b for b in schedule["blocks"] if b["task_id"] == task["id"]]


def test_editing_and_deleting_a_session_restores_exact_state(
    client: TestClient, monkeypatch
) -> None:
    """Scenario 29: editing or deleting a session restores exactly what the rest implies."""
    register(client)
    task = create_task(client, estimated_minutes=120)
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 13, 20, tzinfo=UTC))

    session = client.post(
        "/api/v1/work-sessions",
        json={
            "task_id": task["id"],
            "local_date": "2026-09-13",
            "minutes": 50,
            "outcome": "still_going",
            "source": "manual",
        },
    ).json()
    assert client.get(f"/api/v1/tasks/{task['id']}").json()["remaining_minutes"] == 70

    updated = client.patch(f"/api/v1/work-sessions/{session['id']}", json={"minutes": 30})
    assert updated.status_code == 200
    assert client.get(f"/api/v1/tasks/{task['id']}").json()["remaining_minutes"] == 90

    deleted = client.delete(f"/api/v1/work-sessions/{session['id']}")
    assert deleted.status_code == 204
    after = client.get(f"/api/v1/tasks/{task['id']}").json()
    assert after["remaining_minutes"] == 120
    assert after["status"] == "pending"


def test_goal_session_advances_progress_and_skips_remaining_minutes_accounting(
    client: TestClient, monkeypatch
) -> None:
    register(client)
    goal = client.post(
        "/api/v1/goals", json={"name": "Go to the gym", "start_date": "2026-09-01"}
    ).json()
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 13, 20, tzinfo=UTC))

    response = client.post(
        "/api/v1/work-sessions",
        json={
            "goal_id": goal["id"],
            "local_date": "2026-09-13",
            "minutes": 45,
            "outcome": "finished",
            "source": "quick_confirm",
        },
    )
    assert response.status_code == 201

    updated_goal = client.get(f"/api/v1/goals/{goal['id']}").json()
    assert updated_goal["current_progress"] == 45


def test_starting_a_second_timer_conflicts(client: TestClient, monkeypatch) -> None:
    register(client)
    task_a = create_task(client, name="Task A", estimated_minutes=60)
    task_b = create_task(client, name="Task B", estimated_minutes=60)
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 13, 12, tzinfo=UTC))

    first = client.post("/api/v1/work-timer", json={"task_id": task_a["id"]})
    assert first.status_code == 201

    second = client.post("/api/v1/work-timer", json={"task_id": task_b["id"]})
    assert second.status_code == 409
    error = second.json()["error"]
    assert error["code"] == "TIMER_ALREADY_RUNNING"
    assert error["details"]["timer"]["task_id"] == task_a["id"]


def test_a_work_session_requires_exactly_one_of_task_or_goal(client: TestClient) -> None:
    register(client)
    response = client.post(
        "/api/v1/work-sessions",
        json={"local_date": "2026-09-01", "minutes": 10, "outcome": "still_going"},
    )
    assert response.status_code == 422


def test_a_future_local_date_is_rejected(client: TestClient) -> None:
    register(client)
    task = create_task(client, estimated_minutes=60)
    far_future = (date.today() + timedelta(days=3650)).isoformat()
    response = client.post(
        "/api/v1/work-sessions",
        json={
            "task_id": task["id"],
            "local_date": far_future,
            "minutes": 10,
            "outcome": "still_going",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_complete_logs_a_finished_session_for_the_remaining_time(
    client: TestClient, monkeypatch
) -> None:
    register(client)
    task = create_task(client, estimated_minutes=90)
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 13, 20, tzinfo=UTC))

    completed = client.post(f"/api/v1/tasks/{task['id']}/complete")
    assert completed.status_code == 200
    body = completed.json()
    assert body["status"] == "completed"
    assert body["remaining_minutes"] == 0

    sessions = client.get("/api/v1/work-sessions").json()
    assert len(sessions) == 1
    assert sessions[0]["minutes"] == 90
    assert sessions[0]["outcome"] == "finished"
    assert sessions[0]["source"] == "quick_confirm"


def test_double_subtraction_fix_credits_only_unlogged_past_time(
    client: TestClient, db_session: Session, monkeypatch
) -> None:
    """A logged session must not also be subtracted again via an already-passed block.

    Before the fix, `preserved_minutes` credited a past accepted block's full duration
    regardless of what was actually logged against it, so real logged minutes were subtracted
    twice - once from `remaining_minutes`, once again here - and the shortfall silently
    disappeared from every future plan.
    """

    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    task = create_task(client, estimated_minutes=300, deadline_at="2026-09-27T23:59:00-07:00")
    user_id = UUID(client.get("/api/v1/auth/me").json()["id"])
    task_id = UUID(task["id"])

    version = ScheduleVersion(
        user_id=user_id,
        semester_id=UUID(semester["id"]),
        version_number=1,
        reason="Accepted for test",
        status=ScheduleStatus.accepted,
        accepted_at=datetime(2026, 9, 9, tzinfo=UTC),
    )
    db_session.add(version)
    db_session.flush()
    db_session.add(
        ScheduledBlock(
            schedule_version_id=version.id,
            user_id=user_id,
            task_id=task_id,
            title=task["name"],
            # 100 minutes, entirely in the past once planning_now is pinned below.
            start_at=datetime(2026, 9, 10, 9, tzinfo=UTC),
            end_at=datetime(2026, 9, 10, 10, 40, tzinfo=UTC),
            block_type="focus",
            locked=False,
            source="generated",
            stability_weight=1.0,
        )
    )
    db_session.commit()

    planning_now = datetime(2026, 9, 15, 12, tzinfo=UTC)
    monkeypatch.setattr(clock, "now", lambda: planning_now)

    logged = client.post(
        "/api/v1/work-sessions",
        json={
            "task_id": task["id"],
            "local_date": "2026-09-10",
            "minutes": 40,
            "outcome": "still_going",
            "source": "manual",
        },
    )
    assert logged.status_code == 201
    assert client.get(f"/api/v1/tasks/{task['id']}").json()["remaining_minutes"] == 260

    proposal = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals")
    assert proposal.status_code == 201, proposal.text
    blocks = [block for block in proposal.json()["blocks"] if block["task_id"] == task["id"]]
    target_start = datetime(2026, 9, 10, 9, tzinfo=UTC)
    preserved_ids = {
        block["id"]
        for block in blocks
        if datetime.fromisoformat(block["start_at"]).replace(tzinfo=UTC) == target_start
    }
    assert len(preserved_ids) == 1
    new_minutes = sum(
        round(
            (
                datetime.fromisoformat(block["end_at"]) - datetime.fromisoformat(block["start_at"])
            ).total_seconds()
            / 60
        )
        for block in blocks
        if block["id"] not in preserved_ids
    )
    # 260 minutes remain (300 - 40 logged). The past block credits only the 60 minutes of it
    # that logging has not already covered (100 - 40), so the solver must still place 200 new
    # minutes - not the pre-fix 160, which silently dropped the 40 logged minutes twice.
    assert new_minutes == 200
