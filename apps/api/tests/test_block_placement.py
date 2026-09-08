from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from test_api import create_semester, register
from test_planning import replace_weekday_availability

from donext.planning import aware


@pytest.fixture
def placement_plan(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> tuple[str, str]:
    def now() -> datetime:
        return datetime(2026, 9, 7, 14, tzinfo=UTC)  # 7 AM in Vancouver

    monkeypatch.setattr("donext.routers.block_placement._planning_now", now)
    monkeypatch.setattr("donext.routers.proposals._planning_now", now)
    register(client)
    semester = create_semester(client)
    replace_weekday_availability(client)
    response = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals")
    assert response.status_code == 201
    return semester["id"], response.json()["id"]


def test_duration_preview_is_read_only_and_save_adds_exactly_that_block(
    client: TestClient, placement_plan: tuple[str, str]
) -> None:
    semester_id, proposal_id = placement_plan
    base = f"/api/v1/semesters/{semester_id}/schedule"
    request = {"day": "2026-09-07", "duration_minutes": 90, "proposal_id": proposal_id}
    response = client.post(f"{base}/block-placement", json=request)
    assert response.status_code == 200
    slot = response.json()
    assert datetime.fromisoformat(slot["start_at"]).hour == 15  # 8 AM in Vancouver
    assert (
        datetime.fromisoformat(slot["end_at"]) - datetime.fromisoformat(slot["start_at"])
    ) == timedelta(minutes=90)
    assert client.get(f"{base}/proposal").json()["blocks"] == []
    assert client.get(base).json() is None

    response = client.post(
        f"{base}/duration-blocks",
        json={
            **request,
            "title": "Reading",
            "start_at": slot["start_at"],
            "end_at": slot["end_at"],
        },
    )
    assert response.status_code == 201
    block = response.json()
    assert block["title"] == "Reading"
    assert aware(datetime.fromisoformat(block["start_at"])) == datetime.fromisoformat(
        slot["start_at"]
    )
    assert client.get(f"{base}/proposal").json()["blocks"][0]["id"] == block["id"]
    assert client.get(base).json() is None


def test_duration_avoids_unlocked_blocks_events_commute_and_breaks(
    client: TestClient, placement_plan: tuple[str, str]
) -> None:
    semester_id, proposal_id = placement_plan
    event = client.post(
        "/api/v1/events",
        json={
            "title": "Appointment",
            "category": "personal",
            "start_at": "2026-09-07T15:00:00Z",
            "end_at": "2026-09-07T16:00:00Z",
            "commute_after_minutes": 15,
        },
    )
    assert event.status_code == 201
    existing = client.post(
        f"/api/v1/schedule-proposals/{proposal_id}/blocks",
        json={
            "title": "Existing",
            "start_at": "2026-09-07T16:15:00Z",
            "end_at": "2026-09-07T17:15:00Z",
            "locked": False,
        },
    )
    assert existing.status_code == 201
    response = client.post(
        f"/api/v1/semesters/{semester_id}/schedule/block-placement",
        json={"day": "2026-09-07", "duration_minutes": 60, "proposal_id": proposal_id},
    )
    assert response.status_code == 200
    assert datetime.fromisoformat(response.json()["start_at"]) == datetime.fromisoformat(
        "2026-09-07T10:25:00-07:00"
    )


def test_duration_does_not_save_a_suggestion_that_became_occupied(
    client: TestClient, placement_plan: tuple[str, str]
) -> None:
    semester_id, proposal_id = placement_plan
    base = f"/api/v1/semesters/{semester_id}/schedule"
    request = {"day": "2026-09-07", "duration_minutes": 60, "proposal_id": proposal_id}
    slot = client.post(f"{base}/block-placement", json=request).json()
    occupied = client.post(
        f"/api/v1/schedule-proposals/{proposal_id}/blocks",
        json={"title": "Taken", "start_at": slot["start_at"], "end_at": slot["end_at"]},
    )
    assert occupied.status_code == 201
    response = client.post(
        f"{base}/duration-blocks",
        json={**request, "title": "New", "start_at": slot["start_at"], "end_at": slot["end_at"]},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "BLOCK_PLACEMENT_CHANGED"
    assert len(client.get(f"{base}/proposal").json()["blocks"]) == 1


@pytest.mark.parametrize(
    "day, minutes, status",
    [
        ("2026-09-12", 30, 409),  # No weekend availability.
        ("2026-09-07", 600, 409),  # Exceeds usable daily capacity.
        ("2026-09-07", 0, 422),
        ("2026-09-07", -30, 422),
        ("2026-09-07", 1441, 422),
        ("2026-09-30", 30, 422),  # Outside this draft.
    ],
)
def test_duration_rejects_unplaceable_requests_without_mutation(
    client: TestClient, placement_plan: tuple[str, str], day: str, minutes: int, status: int
) -> None:
    semester_id, proposal_id = placement_plan
    base = f"/api/v1/semesters/{semester_id}/schedule"
    response = client.post(
        f"{base}/block-placement",
        json={"day": day, "duration_minutes": minutes, "proposal_id": proposal_id},
    )
    assert response.status_code == status
    assert client.get(f"{base}/proposal").json()["blocks"] == []


def test_duration_can_add_to_manual_schedule_without_a_draft(
    client: TestClient, placement_plan: tuple[str, str]
) -> None:
    semester_id, _ = placement_plan
    base = f"/api/v1/semesters/{semester_id}/schedule"
    request = {"day": "2026-09-07", "duration_minutes": 45}
    slot = client.post(f"{base}/block-placement", json=request).json()
    response = client.post(
        f"{base}/duration-blocks",
        json={
            **request,
            "title": "Walk",
            "block_type": "personal",
            "locked": True,
            "start_at": slot["start_at"],
            "end_at": slot["end_at"],
        },
    )
    assert response.status_code == 201
    assert client.get(base).json()["blocks"][0]["locked"] is True


def test_duration_cannot_access_another_users_draft(
    client: TestClient, placement_plan: tuple[str, str]
) -> None:
    semester_id, proposal_id = placement_plan
    client.post("/api/v1/auth/logout")
    register(client, "someone-else@example.com")
    response = client.post(
        f"/api/v1/semesters/{semester_id}/schedule/block-placement",
        json={"day": "2026-09-07", "duration_minutes": 60, "proposal_id": proposal_id},
    )
    assert response.status_code == 404
