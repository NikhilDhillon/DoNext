from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from test_proposals import local_start_hours, proposal_fixture

from donext.schedule_revision import RevisionInterpretation, ScheduleRevisionPolicy


@pytest.mark.parametrize("regenerate_before_forgetting", [False, True])
def test_forgotten_feedback_does_not_shape_new_drafts_for_the_same_dates(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    regenerate_before_forgetting: bool,
) -> None:
    monkeypatch.setattr(
        "donext.routers.proposals._planning_now",
        lambda: datetime(2026, 9, 7, 8, tzinfo=UTC),
    )
    semester, _task = proposal_fixture(client)
    endpoint = f"/api/v1/semesters/{semester['id']}/schedule/proposals"
    original = client.post(endpoint).json()
    assert original["generation_summary"]["scheduled_minutes"] == 100

    # Make the feedback's effect unambiguous: it covers the working hours the fixture makes
    # available, so nothing it shapes can sit where this draft's blocks sit now. It has to leave
    # the day some room - feedback that plans nothing at all is refused rather than applied.
    policy = ScheduleRevisionPolicy.model_validate(
        {"avoid_time_ranges": [{"start": "08:00", "end": "17:00"}]}
    )
    with monkeypatch.context() as interpreter:
        interpreter.setattr(
            "donext.routers.proposals.interpret_revision_feedback",
            lambda *_: RevisionInterpretation(policy, "openai", True),
        )
        response = client.post(
            f"/api/v1/schedule-proposals/{original['id']}/revise",
            json={"reasons": ["wrong_times"], "remember": True},
        )
    assert response.status_code == 201
    affected = response.json()
    if regenerate_before_forgetting:
        affected = client.post(endpoint).json()
    assert min(local_start_hours(affected["blocks"])) >= 17

    assert client.delete("/api/v1/preferences/remembered-schedule-preferences").status_code == 204
    assert client.get("/api/v1/preferences").json()["remembered_schedule_preferences"] == []
    current = client.get(f"/api/v1/semesters/{semester['id']}/schedule/proposal").json()
    assert current["id"] == affected["id"]
    assert current["blocks"] == affected["blocks"]
    assert current["stale"] is True

    response = client.post(endpoint)
    assert response.status_code == 201
    fresh = response.json()
    assert fresh["id"] != affected["id"]
    assert fresh["horizon_start"] == affected["horizon_start"]
    assert fresh["horizon_end"] == affected["horizon_end"]
    assert fresh["generation_summary"]["scheduled_minutes"] == 100
    assert min(local_start_hours(fresh["blocks"])) < 17
    assert fresh["revision_feedback"] is None
    assert fresh["revision_of_proposal_id"] is None
    assert fresh["stale"] is False

    # A later adjustment must not merge the forgotten restriction back in either.
    response = client.post(
        f"/api/v1/schedule-proposals/{fresh['id']}/revise",
        json={"reasons": ["sessions_too_long"], "remember": False},
    )
    assert response.status_code == 201
    adjusted = response.json()
    assert adjusted["revision_feedback"]["policy"]["avoid_time_ranges"] == []
    assert adjusted["generation_summary"]["scheduled_minutes"] == 100
    assert client.get(f"/api/v1/semesters/{semester['id']}/schedule").json() is None
