from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from test_api import create_semester, register


def create_course(client: TestClient, code: str = "CSC 349A") -> dict[str, object]:
    semester = create_semester(client)
    response = client.post(
        f"/api/v1/semesters/{semester['id']}/courses",
        json={"code": code, "name": "Numerical Analysis"},
    )
    assert response.status_code == 201
    return response.json()


def grading_payload(deadline: datetime) -> dict[str, object]:
    return {
        "current_grade": 62,
        "target_grade": 80,
        "groups": [
            {
                "key": "assignments",
                "name": "Assignments",
                "allocation_method": "equal",
                "weight_origin": "explicit",
            }
        ],
        "items": [
            {
                "key": "assignment-1",
                "group_key": "assignments",
                "item_type": "assignment",
                "name": "Assignment 1",
                "due_at": deadline.isoformat(),
                "weight_origin": "inferred_equal",
                "source_text": "Assignments are worth 30%; lowest grade dropped.",
            },
            {
                "key": "assignment-2",
                "group_key": "assignments",
                "item_type": "assignment",
                "name": "Assignment 2",
                "due_at": (deadline + timedelta(days=7)).isoformat(),
                "weight_origin": "inferred_equal",
            },
            {
                "key": "final",
                "item_type": "final_exam",
                "name": "Final exam",
                "due_at": (deadline + timedelta(days=20)).isoformat(),
                "weight_origin": "explicit",
                "minimum_required_percent": 50,
            },
        ],
        "schemes": [
            {
                "key": "standard",
                "name": "Standard",
                "selection_mode": "best_outcome",
                "is_primary": True,
                "is_complete": False,
                "components": [
                    {
                        "target_group_key": "assignments",
                        "weight_percent": 30,
                        "selection_rule": "drop_lowest_n",
                        "selection_count": 1,
                    },
                    {
                        "target_item_key": "final",
                        "weight_percent": 40,
                        "minimum_required_percent": 50,
                    },
                ],
            },
            {
                "key": "alternative",
                "name": "Alternative final-heavy",
                "selection_mode": "best_outcome",
                "is_complete": False,
                "components": [
                    {"target_group_key": "assignments", "weight_percent": 20},
                    {
                        "target_item_key": "final",
                        "weight_percent": 50,
                        "minimum_required_percent": 50,
                    },
                ],
            },
        ],
    }


def test_grading_replacement_is_atomic_idempotent_and_explainable(client: TestClient) -> None:
    register(client)
    course = create_course(client)
    deadline = datetime.now(UTC) + timedelta(days=2)
    payload = grading_payload(deadline)

    first = client.put(f"/api/v1/courses/{course['id']}/grading", json=payload)
    assert first.status_code == 200
    body = first.json()
    assert len(body["groups"]) == 1
    assert len(body["items"]) == 3
    assert len(body["schemes"]) == 2
    assert body["warnings"]
    assert len(client.get("/api/v1/tasks").json()) == 3

    second = client.put(f"/api/v1/courses/{course['id']}/grading", json=payload)
    assert second.status_code == 200
    assert len(client.get("/api/v1/tasks").json()) == 3

    impact = client.get(f"/api/v1/courses/{course['id']}/academic-impact")
    assert impact.status_code == 200
    impacts = impact.json()
    final = next(value for value in impacts if value["maximum_weight_percent"] == 50)
    assert final["minimum_weight_percent"] == 40
    assert final["tier"] == "critical"
    assert final["blocking_rule"] == "Requires at least 50% to pass"
    assert "internal_score" not in final
    assignment = next(value for value in impacts if value["weight_origin"] == "inferred_equal")
    assert assignment["effective_weight_percent"] == 30


def test_grade_updates_resolve_hurdle_risk_and_sync_task(client: TestClient) -> None:
    register(client)
    course = create_course(client)
    payload = grading_payload(datetime.now(UTC) + timedelta(days=10))
    grading = client.put(f"/api/v1/courses/{course['id']}/grading", json=payload).json()
    final_item = next(item for item in grading["items"] if item["name"] == "Final exam")

    updated = client.patch(
        f"/api/v1/academic-items/{final_item['id']}",
        json={
            "name": "Final examination",
            "points_possible": 100,
            "points_earned": 72,
            "grade_status": "graded",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["points_earned"] == 72
    linked_task = next(
        task
        for task in client.get("/api/v1/tasks").json()
        if task["academic_item_id"] == final_item["id"]
    )
    assert linked_task["name"] == "Final examination"
    impact = client.get(f"/api/v1/courses/{course['id']}/academic-impact").json()
    final_impact = next(value for value in impact if value["academic_item_id"] == final_item["id"])
    assert final_impact["blocking_rule"] is None


def test_complete_scheme_requires_one_hundred_percent(client: TestClient) -> None:
    register(client)
    course = create_course(client)
    payload = grading_payload(datetime.now(UTC) + timedelta(days=10))
    payload["schemes"][0]["is_complete"] = True  # type: ignore[index]

    response = client.put(f"/api/v1/courses/{course['id']}/grading", json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert client.get(f"/api/v1/courses/{course['id']}/grading").json()["items"] == []


def test_academic_items_are_user_scoped(client: TestClient) -> None:
    register(client, "first-grading@example.com")
    course = create_course(client)
    payload = grading_payload(datetime.now(UTC) + timedelta(days=10))
    item = client.put(f"/api/v1/courses/{course['id']}/grading", json=payload).json()["items"][0]
    client.post("/api/v1/auth/logout")
    register(client, "second-grading@example.com")

    assert (
        client.patch(f"/api/v1/academic-items/{item['id']}", json={"points_earned": 1}).status_code
        == 404
    )
    assert client.get(f"/api/v1/courses/{course['id']}/academic-impact").status_code == 404
