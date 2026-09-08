from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_proposals import proposal_fixture

from donext.schedule_revision import RevisionInterpretation, ScheduleRevisionPolicy

# Feedback whose effect is unmistakable: it covers the working hours the fixture makes available,
# so the plan it produces is nowhere near the one it replaced, and a restored draft can be told
# from a re-planned one by where the work sits.
CLEARS_THE_WORKING_HOURS = ScheduleRevisionPolicy.model_validate(
    {
        "avoid_time_ranges": [{"start": "08:00", "end": "17:00"}],
        "summary": "Kept the working day clear.",
    }
)


@pytest.fixture(autouse=True)
def _fixed_planning_now(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "donext.routers.proposals._planning_now",
        lambda: datetime(2026, 9, 7, 8, tzinfo=UTC),
    )


def placements(draft: dict[str, Any]) -> list[str]:
    return sorted(block["start_at"] for block in draft["blocks"])


def revise(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    proposal_id: str,
    *,
    policy: ScheduleRevisionPolicy = CLEARS_THE_WORKING_HOURS,
    remember: bool = False,
) -> dict[str, Any]:
    with monkeypatch.context() as interpreter:
        interpreter.setattr(
            "donext.routers.proposals.interpret_revision_feedback",
            lambda *_: RevisionInterpretation(policy, "openai", True),
        )
        response = client.post(
            f"/api/v1/schedule-proposals/{proposal_id}/revise",
            json={
                "reasons": ["wrong_times"],
                "note": "Keep the working day clear.",
                "remember": remember,
            },
        )
    assert response.status_code == 201
    return dict(response.json())


def test_undo_puts_back_the_draft_the_feedback_replaced(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    semester, _task = proposal_fixture(client)
    original = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()
    assert original["can_undo_revision"] is False
    revised = revise(client, monkeypatch, original["id"])
    assert placements(revised) != placements(original)
    assert revised["can_undo_revision"] is True

    response = client.post(f"/api/v1/schedule-proposals/{revised['id']}/undo-revision")

    assert response.status_code == 200
    restored = response.json()
    # The same draft, not a fresh solve of the same inputs: identical blocks, down to their ids.
    assert restored["id"] == original["id"]
    assert restored["blocks"] == original["blocks"]
    assert restored["status"] == "proposed"
    assert restored["revision_feedback"] is None
    assert restored["can_undo_revision"] is False
    current = client.get(f"/api/v1/semesters/{semester['id']}/schedule/proposal").json()
    assert current["id"] == original["id"]


def test_undo_also_forgets_the_preference_that_revision_saved(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The draft coming back is not enough on its own.

    A remembered preference shapes every later draft, so leaving it in place would let the undone
    feedback quietly reappear the next time one is generated.
    """
    semester, _task = proposal_fixture(client)
    endpoint = f"/api/v1/semesters/{semester['id']}/schedule/proposals"
    original = client.post(endpoint).json()
    revised = revise(client, monkeypatch, original["id"], remember=True)
    assert client.get("/api/v1/preferences").json()["remembered_schedule_preferences"] != []

    undone = client.post(f"/api/v1/schedule-proposals/{revised['id']}/undo-revision")
    assert undone.status_code == 200

    assert client.get("/api/v1/preferences").json()["remembered_schedule_preferences"] == []
    fresh = client.post(endpoint).json()
    assert placements(fresh) == placements(original)
    assert fresh["revision_feedback"] is None


def test_undo_leaves_a_preference_the_student_has_already_changed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Restoring what remembering overwrote must not reverse a later decision of their own."""
    earlier = ScheduleRevisionPolicy.model_validate(
        {"max_blocks_per_day": 2, "summary": "At most two blocks a day."}
    )
    semester, _task = proposal_fixture(client)
    original = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()
    first = revise(client, monkeypatch, original["id"], policy=earlier, remember=True)
    second = revise(client, monkeypatch, str(first["id"]), remember=True)
    assert client.delete("/api/v1/preferences/remembered-schedule-preferences").status_code == 204

    undone = client.post(f"/api/v1/schedule-proposals/{second['id']}/undo-revision")
    assert undone.status_code == 200

    assert client.get("/api/v1/preferences").json()["remembered_schedule_preferences"] == []


def test_undo_walks_back_one_revision_at_a_time(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calmer = ScheduleRevisionPolicy.model_validate(
        {"max_blocks_per_day": 1, "summary": "One block a day."}
    )
    semester, _task = proposal_fixture(client)
    original = client.post(f"/api/v1/semesters/{semester['id']}/schedule/proposals").json()
    first = revise(client, monkeypatch, original["id"], policy=calmer)
    second = revise(client, monkeypatch, str(first["id"]))

    back_to_first = client.post(f"/api/v1/schedule-proposals/{second['id']}/undo-revision").json()
    assert back_to_first["id"] == first["id"]
    assert back_to_first["can_undo_revision"] is True

    back_to_original = client.post(f"/api/v1/schedule-proposals/{first['id']}/undo-revision").json()
    assert back_to_original["id"] == original["id"]
    assert back_to_original["can_undo_revision"] is False
    assert back_to_original["blocks"] == original["blocks"]


def test_a_draft_that_is_not_a_revision_has_nothing_to_undo(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Building a fresh draft supersedes the revision, and with it the way back."""
    semester, _task = proposal_fixture(client)
    endpoint = f"/api/v1/semesters/{semester['id']}/schedule/proposals"
    original = client.post(endpoint).json()
    revised = revise(client, monkeypatch, original["id"])
    assert revised["can_undo_revision"] is True

    fresh = client.post(endpoint).json()

    assert fresh["can_undo_revision"] is False
    response = client.post(f"/api/v1/schedule-proposals/{fresh['id']}/undo-revision")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "REVISION_NOT_UNDOABLE"
