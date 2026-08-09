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


def test_outline_import_is_atomic_and_requires_explicit_existing_course_update(
    client: TestClient,
) -> None:
    register(client)
    semester = create_semester(client)
    deadline = datetime.now(UTC) + timedelta(days=10)
    payload = {
        "course": {
            "code": "CSC 349A",
            "name": "Numerical Analysis",
            "instructor": "Bruce Kapron",
        },
        "grading": grading_payload(deadline),
        "meetings": [
            {
                "title": "CSC 349A lecture",
                "semester_id": semester["id"],
                "category": "class",
                "start_at": "2026-09-07T10:00:00-07:00",
                "end_at": "2026-09-07T11:20:00-07:00",
                "recurrence_rule": "FREQ=WEEKLY;BYDAY=MO",
            }
        ],
    }

    created = client.post(
        f"/api/v1/semesters/{semester['id']}/courses/import-outline", json=payload
    )
    assert created.status_code == 200
    assert created.json()["updated_existing"] is False
    assert created.json()["meetings_created"] == 1
    assert len(client.get("/api/v1/tasks").json()) == 3
    assert len(client.get("/api/v1/events").json()) == 1

    conflict = client.post(
        f"/api/v1/semesters/{semester['id']}/courses/import-outline", json=payload
    )
    assert conflict.status_code == 409

    payload["replace_existing"] = True
    payload["course"]["name"] = "Numerical Methods"  # type: ignore[index]
    updated = client.post(
        f"/api/v1/semesters/{semester['id']}/courses/import-outline", json=payload
    )
    assert updated.status_code == 200
    assert updated.json()["updated_existing"] is True
    assert updated.json()["course"]["name"] == "Numerical Methods"
    assert updated.json()["meetings_created"] == 0

    invalid_payload = {
        **payload,
        "replace_existing": False,
        "course": {"code": "CSC 350", "name": "Broken import"},
        "grading": grading_payload(deadline),
        "meetings": [],
    }
    invalid_payload["grading"]["schemes"][0]["is_complete"] = True  # type: ignore[index]
    failed = client.post(
        f"/api/v1/semesters/{semester['id']}/courses/import-outline", json=invalid_payload
    )
    assert failed.status_code == 422
    courses = client.get(f"/api/v1/semesters/{semester['id']}/courses").json()
    assert {course["code"] for course in courses} == {"CSC 349A"}


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


def test_points_nested_extra_credit_and_unknown_weights(client: TestClient) -> None:
    register(client)
    course = create_course(client, "CSC 370")
    payload = {
        "groups": [
            {
                "key": "project",
                "name": "Project",
                "allocation_method": "explicit_percent",
                "weight_origin": "explicit",
            },
            {
                "key": "sprints",
                "parent_key": "project",
                "name": "Project sprints",
                "allocation_method": "explicit_percent",
                "relative_weight_percent": 50,
                "weight_origin": "explicit",
            },
            {
                "key": "labs",
                "name": "Labs",
                "allocation_method": "points",
                "weight_origin": "explicit",
            },
        ],
        "items": [
            {
                "key": "sprint-1",
                "group_key": "sprints",
                "name": "Sprint 1",
                "item_type": "project",
                "relative_weight_percent": 25,
                "weight_origin": "explicit",
            },
            {
                "key": "lab-1",
                "group_key": "labs",
                "name": "Lab 1",
                "item_type": "lab",
                "points_possible": 100,
                "weight_origin": "calculated_from_points",
            },
            {
                "key": "lab-2",
                "group_key": "labs",
                "name": "Lab 2",
                "item_type": "lab",
                "points_possible": 200,
                "weight_origin": "calculated_from_points",
            },
            {
                "key": "bonus",
                "name": "Bonus reflection",
                "item_type": "assignment",
                "extra_credit": True,
                "weight_origin": "explicit",
            },
            {
                "key": "unknown",
                "name": "Unconfirmed assessment",
                "item_type": "other",
                "weight_origin": "unknown",
            },
        ],
        "schemes": [
            {
                "key": "standard",
                "name": "Standard",
                "is_primary": True,
                "components": [
                    {"target_group_key": "project", "weight_percent": 40},
                    {"target_group_key": "labs", "weight_percent": 30},
                    {
                        "target_item_key": "bonus",
                        "weight_percent": 10,
                        "is_extra_credit": True,
                    },
                ],
            }
        ],
    }
    response = client.put(f"/api/v1/courses/{course['id']}/grading", json=payload)
    assert response.status_code == 200
    names = {item["id"]: item["name"] for item in response.json()["items"]}

    impacts = client.get(f"/api/v1/courses/{course['id']}/academic-impact").json()
    by_name = {names[impact["academic_item_id"]]: impact for impact in impacts}
    assert by_name["Sprint 1"]["effective_weight_percent"] == 5
    assert by_name["Lab 1"]["effective_weight_percent"] == 10
    assert by_name["Lab 2"]["effective_weight_percent"] == 20
    assert by_name["Lab 1"]["weight_origin"] == "calculated_from_points"
    assert by_name["Bonus reflection"]["tier"] == "low"
    assert any(
        reason["code"] == "extra_credit" for reason in by_name["Bonus reflection"]["reasons"]
    )
    assert by_name["Unconfirmed assessment"]["effective_weight_percent"] == 0
    assert by_name["Unconfirmed assessment"]["weight_origin"] == "unknown"
