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
