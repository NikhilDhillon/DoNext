from datetime import UTC, datetime

from fastapi.testclient import TestClient
from test_api import create_semester, register

from donext import clock


def task(client: TestClient, name: str = "Report", minutes: int = 90) -> dict[str, object]:
    response = client.post(
        "/api/v1/tasks",
        json={
            "name": name,
            "estimated_minutes": minutes,
            "deadline_at": "2026-09-20T23:59:00Z",
            "minimum_session_minutes": 15,
            "preferred_session_minutes": 30,
            "maximum_session_minutes": 90,
        },
    )
    assert response.status_code == 201
    return response.json()


def block(
    client: TestClient,
    semester_id: str,
    task_id: str,
    start_at: str,
    end_at: str,
) -> dict[str, object]:
    response = client.post(
        f"/api/v1/semesters/{semester_id}/schedule/blocks",
        json={
            "title": "Report session",
            "task_id": task_id,
            "start_at": start_at,
            "end_at": end_at,
            "block_type": "focus",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def availability(client: TestClient, start: str = "08:00:00", end: str = "18:00:00") -> None:
    response = client.put(
        "/api/v1/availability",
        json={
            "windows": [
                {
                    "day_of_week": day,
                    "start_time": start,
                    "end_time": end,
                    "type": "available",
                    "energy_level": "medium",
                }
                for day in range(5)
            ]
        },
    )
    assert response.status_code == 200


def log_block(
    client: TestClient,
    task_id: str,
    block_id: str,
    *,
    minutes: int,
    outcome: str = "still_going",
) -> dict[str, object]:
    response = client.post(
        "/api/v1/work-sessions",
        json={
            "task_id": task_id,
            "scheduled_block_id": block_id,
            "local_date": "2026-09-13",
            "minutes": minutes,
            "outcome": outcome,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def schedule_signatures(client: TestClient, semester_id: str) -> set[tuple[str, str, str]]:
    schedule = client.get(f"/api/v1/semesters/{semester_id}/schedule").json()
    return {(entry["id"], entry["start_at"], entry["end_at"]) for entry in schedule["blocks"]}


def test_rollover_places_all_uncovered_work_together_without_moving_accepted_blocks(
    client: TestClient, monkeypatch
) -> None:
    register(client, timezone="UTC")
    semester = create_semester(client)
    availability(client)
    first = task(client, "Report", 120)
    second = task(client, "Problem set", 60)
    first_block = block(
        client, semester["id"], first["id"], "2026-09-13T09:00:00Z", "2026-09-13T10:00:00Z"
    )
    block(client, semester["id"], second["id"], "2026-09-13T10:00:00Z", "2026-09-13T11:00:00Z")
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 14, 7, tzinfo=UTC))
    log_block(client, first["id"], first_block["id"], minutes=30)
    accepted_before = schedule_signatures(client, semester["id"])

    preview = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/rollover",
        json={"local_date": "2026-09-13", "dry_run": True},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["outcome"] == "placed"
    assert preview.json()["rolled_minutes"] == 150
    assert preview.json()["blocks"] == []
    assert preview.json()["unanswered_blocks"] == 1
    assert schedule_signatures(client, semester["id"]) == accepted_before

    response = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/rollover",
        json={"local_date": "2026-09-13"},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["outcome"] == "placed"
    assert result["rolled_minutes"] == 150
    assert result["released_minutes"] == 0
    assert (
        sum(
            round(
                (
                    datetime.fromisoformat(entry["end_at"])
                    - datetime.fromisoformat(entry["start_at"])
                ).total_seconds()
                / 60
            )
            for entry in result["blocks"]
        )
        == 150
    )
    assert {entry["task_id"] for entry in result["blocks"]} == {first["id"], second["id"]}
    assert all(entry["source"] == "generated" for entry in result["blocks"])
    assert all(entry["reason_code"] == "ROLLOVER" for entry in result["blocks"])
    assert all(
        datetime.fromisoformat(entry["start_at"]) >= datetime(2026, 9, 14, 7)
        for entry in result["blocks"]
    )
    after = schedule_signatures(client, semester["id"])
    assert accepted_before <= after

    # The newly added future blocks now cover the remainder, so retrying cannot duplicate it.
    repeated = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/rollover",
        json={"local_date": "2026-09-13"},
    ).json()
    assert repeated["outcome"] == "nothing_to_roll"
    assert schedule_signatures(client, semester["id"]) == after

    # Every added block can be undone through the existing single-block endpoint.
    for entry in result["blocks"]:
        assert client.delete(f"/api/v1/schedule-blocks/{entry['id']}").status_code == 204
    assert schedule_signatures(client, semester["id"]) == accepted_before


def test_rollover_counts_only_work_not_covered_by_future_accepted_time(
    client: TestClient, monkeypatch
) -> None:
    register(client, timezone="UTC")
    semester = create_semester(client)
    availability(client)
    work = task(client, minutes=120)
    block(client, semester["id"], work["id"], "2026-09-13T09:00:00Z", "2026-09-13T10:00:00Z")
    block(client, semester["id"], work["id"], "2026-09-14T09:00:00Z", "2026-09-14T11:00:00Z")
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 14, 7, tzinfo=UTC))
    before = schedule_signatures(client, semester["id"])

    response = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/rollover",
        json={"local_date": "2026-09-13"},
    )
    assert response.status_code == 200
    assert response.json()["outcome"] == "nothing_to_roll"
    assert response.json()["rolled_minutes"] == 0
    assert response.json()["unanswered_blocks"] == 1
    assert schedule_signatures(client, semester["id"]) == before


def test_rollover_requires_a_draft_without_changing_the_accepted_schedule(
    client: TestClient, monkeypatch
) -> None:
    register(client, timezone="UTC")
    semester = create_semester(client)
    # The only future hour is the protected rollover buffer, which add-only placement cannot use.
    availability(client, end="09:00:00")
    work = task(client, minutes=60)
    block(client, semester["id"], work["id"], "2026-09-13T09:00:00Z", "2026-09-13T10:00:00Z")
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 14, 7, tzinfo=UTC))
    before = schedule_signatures(client, semester["id"])

    preview = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/rollover",
        json={"local_date": "2026-09-13", "dry_run": True},
    )
    assert preview.status_code == 200, preview.text
    assert preview.json()["outcome"] == "draft_required"
    assert preview.json()["proposal"] is None
    assert client.get(f"/api/v1/semesters/{semester['id']}/schedule/proposal").json() is None
    assert schedule_signatures(client, semester["id"]) == before

    created = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/rollover",
        json={"local_date": "2026-09-13"},
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["outcome"] == "draft_created"
    assert body["proposal"]["status"] == "proposed"
    assert body["proposal"]["base_schedule_version_id"] is not None
    assert schedule_signatures(client, semester["id"]) == before


def test_rollover_treats_not_started_as_answered_and_rejects_future_dates(
    client: TestClient, monkeypatch
) -> None:
    register(client, timezone="UTC")
    semester = create_semester(client)
    availability(client)
    work = task(client, minutes=60)
    past = block(client, semester["id"], work["id"], "2026-09-13T09:00:00Z", "2026-09-13T10:00:00Z")
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 14, 7, tzinfo=UTC))
    log_block(client, work["id"], past["id"], minutes=0, outcome="not_started")

    response = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/rollover",
        json={"local_date": "2026-09-13", "dry_run": True},
    )
    assert response.status_code == 200
    assert response.json()["unanswered_blocks"] == 0
    future = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/rollover",
        json={"local_date": "2026-09-15"},
    )
    assert future.status_code == 422
    assert future.json()["error"]["code"] == "VALIDATION_ERROR"


def test_add_only_rollover_makes_an_open_draft_stale(client: TestClient, monkeypatch) -> None:
    from donext.routers import proposals

    register(client, timezone="UTC")
    semester = create_semester(client)
    availability(client)
    work = task(client, minutes=60)
    block(
        client,
        semester["id"],
        work["id"],
        "2026-09-13T09:00:00Z",
        "2026-09-13T10:00:00Z",
    )
    now = datetime(2026, 9, 14, 7, tzinfo=UTC)
    monkeypatch.setattr(clock, "now", lambda: now)
    monkeypatch.setattr(proposals, "_planning_now", lambda: now)
    draft = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals")
    assert draft.status_code == 201, draft.text

    rolled = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/rollover",
        json={"local_date": "2026-09-13"},
    )
    assert rolled.status_code == 200
    assert rolled.json()["outcome"] == "placed"
    stale = client.post(f"/api/v1/schedule-proposals/{draft.json()['id']}/accept")
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "PROPOSAL_STALE"


def test_rollover_defaults_to_the_users_current_local_date(client: TestClient, monkeypatch) -> None:
    register(client, timezone="America/Vancouver")
    semester = create_semester(client)
    # September 14 UTC is still September 13 in Vancouver.
    monkeypatch.setattr(clock, "now", lambda: datetime(2026, 9, 14, 2, tzinfo=UTC))
    response = client.post(f"/api/v1/semesters/{semester['id']}/schedule/rollover")
    assert response.status_code == 200, response.text
    assert response.json()["outcome"] == "nothing_to_roll"
