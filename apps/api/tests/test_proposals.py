from fastapi.testclient import TestClient
from test_api import create_semester, register
from test_planning import replace_weekday_availability


def proposal_fixture(client: TestClient) -> tuple[dict[str, str], dict[str, str]]:
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
            "name": "Graph problem set",
            "course_id": course["id"],
            "estimated_minutes": 100,
            "deadline_at": "2026-09-10T23:00:00Z",
            "priority": "high",
        },
    ).json()
    return semester, task


def test_proposal_is_editable_and_acceptance_is_atomic(client: TestClient) -> None:
    semester, _ = proposal_fixture(client)
    response = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals")
    assert response.status_code == 201
    proposal = response.json()
    assert proposal["status"] == "proposed"
    assert proposal["generation_summary"]["scheduled_minutes"] == 100
    assert proposal["generation_summary"]["generated_blocks"] > 0
    assert client.get(f"/api/v1/semesters/{semester['id']}/schedule").json() is None

    block = proposal["blocks"][0]
    updated = client.patch(
        f"/api/v1/schedule-proposals/{proposal['id']}/blocks/{block['id']}",
        json={"title": "Reviewed graph session", "locked": True},
    )
    assert updated.status_code == 200
    assert updated.json()["source"] == "proposal_edit"

    accepted = client.post(f"/api/v1/schedule-proposals/{proposal['id']}/accept")
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"
    schedule = client.get(f"/api/v1/semesters/{semester['id']}/schedule").json()
    assert schedule["id"] == proposal["id"]
    assert any(item["title"] == "Reviewed graph session" for item in schedule["blocks"])


def test_stale_and_rejected_proposals_never_replace_the_accepted_plan(
    client: TestClient,
) -> None:
    semester, task = proposal_fixture(client)
    first = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()
    changed = client.patch(f"/api/v1/tasks/{task['id']}", json={"remaining_minutes": 80})
    assert changed.status_code == 200

    stale = client.post(f"/api/v1/schedule-proposals/{first['id']}/accept")
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "PROPOSAL_STALE"
    assert client.get(f"/api/v1/semesters/{semester['id']}/schedule").json() is None

    second = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()
    rejected = client.post(f"/api/v1/schedule-proposals/{second['id']}/reject")
    assert rejected.status_code == 204
    assert client.get(f"/api/v1/semesters/{semester['id']}/schedule/proposal").json() is None


def test_undated_work_is_reported_without_an_invented_deadline(client: TestClient) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    course = client.post(
        f"/api/v1/semesters/{semester['id']}/courses",
        json={"name": "Algorithms", "code": "CSC 320"},
    ).json()
    client.post(
        "/api/v1/tasks",
        json={"name": "Optional reading", "course_id": course["id"], "estimated_minutes": 60},
    )

    proposal = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()
    assert proposal["blocks"] == []
    assert "no confirmed deadline" in proposal["generation_summary"]["warnings"][0]


def test_weekly_flexible_commitment_is_proposed_as_commitment_time(
    client: TestClient,
) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    response = client.post(
        "/api/v1/goals",
        json={
            "name": "Gym",
            "semester_id": semester["id"],
            "category": "gym",
            "start_date": semester["start_date"],
            "planning_kind": "flexible_commitment",
            "schedule_rule": {"cadence": "weekly", "target_minutes": 180},
        },
    )
    assert response.status_code == 201
    flexible = response.json()
    assert flexible["preferred_weekly_minutes"] == 180

    proposal = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()

    assert proposal["generation_summary"]["requested_minutes"] == 360
    assert proposal["generation_summary"]["scheduled_minutes"] == 360
    assert {block["block_type"] for block in proposal["blocks"]} == {"commitment"}
    assert {block["goal_id"] for block in proposal["blocks"]} == {flexible["id"]}
    assert client.get(f"/api/v1/semesters/{semester['id']}/schedule").json() is None


def test_selected_day_flexible_commitment_reports_one_aggregate_shortfall(
    client: TestClient,
) -> None:
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    response = client.post(
        "/api/v1/goals",
        json={
            "name": "Weekend practice",
            "semester_id": semester["id"],
            "category": "personal",
            "start_date": semester["start_date"],
            "planning_kind": "flexible_commitment",
            "schedule_rule": {
                "cadence": "selected_days",
                "target_minutes": 60,
                "days_of_week": [5],
            },
        },
    )
    assert response.status_code == 201
    assert response.json()["preferred_weekly_minutes"] == 60

    proposal = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()

    assert proposal["generation_summary"]["requested_minutes"] == 120
    assert proposal["generation_summary"]["scheduled_minutes"] == 0
    assert len(proposal["generation_summary"]["unscheduled"]) == 1
    unresolved = proposal["generation_summary"]["unscheduled"][0]
    assert unresolved["name"] == "Weekend practice"
    assert unresolved["requested_minutes"] == 120
    assert unresolved["remaining_minutes"] == 120
    assert "2026-09-05" in unresolved["reason"]
