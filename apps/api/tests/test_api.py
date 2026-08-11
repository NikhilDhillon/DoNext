from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient


def register(client: TestClient, email: str = "nikhil@example.com") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "a-secure-local-password",
            "name": "Nikhil Dhillon",
            "timezone": "America/Vancouver",
        },
    )
    assert response.status_code == 201
    return response.json()


def create_semester(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/v1/semesters",
        json={
            "name": "Fall 2026",
            "start_date": "2026-09-02",
            "end_date": "2026-12-18",
            "status": "planned",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_authentication_lifecycle(client: TestClient) -> None:
    user = register(client)
    assert user["name"] == "Nikhil Dhillon"
    assert user["onboarding_completed_at"] is None
    assert client.get("/api/v1/auth/me").json()["email"] == "nikhil@example.com"

    completed = client.post("/api/v1/auth/onboarding/complete")
    assert completed.status_code == 200
    assert completed.json()["onboarding_completed_at"] is not None

    duplicate = client.post(
        "/api/v1/auth/register",
        json={
            "email": "NIKHIL@example.com",
            "password": "a-secure-local-password",
            "name": "Nikhil Dhillon",
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "CONFLICT"

    assert client.post("/api/v1/auth/logout").status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "nikhil@example.com", "password": "a-secure-local-password"},
    )
    assert login.status_code == 200


def test_core_planning_crud(client: TestClient) -> None:
    register(client)
    semester = create_semester(client)

    course_response = client.post(
        f"/api/v1/semesters/{semester['id']}/courses",
        json={
            "name": "Algorithms",
            "code": "csc 320",
            "difficulty": 4,
            "weekly_study_target_minutes": 240,
        },
    )
    assert course_response.status_code == 201
    course = course_response.json()
    assert course["code"] == "CSC 320"
    duplicate_course = client.post(
        f"/api/v1/semesters/{semester['id']}/courses",
        json={"name": "Duplicate", "code": "CSC 320"},
    )
    assert duplicate_course.status_code == 409
    assert duplicate_course.json()["error"]["code"] == "CONFLICT"

    goal_response = client.post(
        "/api/v1/goals",
        json={
            "name": "Learn French",
            "semester_id": semester["id"],
            "start_date": "2026-09-02",
            "minimum_weekly_minutes": 30,
            "preferred_weekly_minutes": 120,
            "maximum_weekly_minutes": 240,
        },
    )
    assert goal_response.status_code == 201
    goal = goal_response.json()

    deadline = datetime.now(UTC) + timedelta(days=7)
    task_response = client.post(
        "/api/v1/tasks",
        json={
            "name": "Solve problem set",
            "course_id": course["id"],
            "estimated_minutes": 150,
            "deadline_at": deadline.isoformat(),
            "priority": "high",
        },
    )
    assert task_response.status_code == 201
    task = task_response.json()
    assert task["remaining_minutes"] == 150

    completed = client.post(f"/api/v1/tasks/{task['id']}/complete")
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"

    event_response = client.post(
        "/api/v1/events",
        json={
            "title": "Algorithms lecture",
            "semester_id": semester["id"],
            "category": "class",
            "start_at": "2026-09-08T09:00:00-07:00",
            "end_at": "2026-09-08T10:20:00-07:00",
        },
    )
    assert event_response.status_code == 201

    availability = client.put(
        "/api/v1/availability",
        json={
            "windows": [
                {
                    "day_of_week": 1,
                    "start_time": "08:00:00",
                    "end_time": "17:00:00",
                    "type": "available",
                    "energy_level": "high",
                }
            ]
        },
    )
    assert availability.status_code == 200
    assert len(availability.json()) == 1

    assert (
        client.patch(f"/api/v1/goals/{goal['id']}", json={"status": "paused"}).json()["status"]
        == "paused"
    )
    assert len(client.get("/api/v1/semesters").json()) == 1
    assert len(client.get("/api/v1/events").json()) == 1


def test_resources_are_scoped_to_the_authenticated_user(client: TestClient) -> None:
    register(client, "first@example.com")
    semester = create_semester(client)
    client.post("/api/v1/auth/logout")

    register(client, "second@example.com")
    response = client.get(f"/api/v1/semesters/{semester['id']}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_validation_errors_are_structured(client: TestClient) -> None:
    register(client)
    response = client.post(
        "/api/v1/semesters",
        json={
            "name": "Impossible semester",
            "start_date": "2026-12-01",
            "end_date": "2026-09-01",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_planning_preferences_can_be_read_and_updated(client: TestClient) -> None:
    register(client)

    defaults = client.get("/api/v1/preferences")
    assert defaults.status_code == 200
    assert defaults.json()["preferred_sleep_minutes"] == 480
    assert defaults.json()["preserve_free_time_percent"] == 15

    updated = client.patch(
        "/api/v1/preferences",
        json={
            "minimum_sleep_minutes": 450,
            "preferred_sleep_minutes": 510,
            "preferred_session_minutes": 45,
            "freeze_window_minutes": 180,
            "preserve_free_time_percent": 20,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["preferred_sleep_minutes"] == 510
    assert updated.json()["freeze_window_minutes"] == 180

    invalid = client.patch(
        "/api/v1/preferences",
        json={"minimum_sleep_minutes": 540, "preferred_sleep_minutes": 480},
    )
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"


def test_manual_schedule_blocks_are_persisted_and_validated(client: TestClient) -> None:
    register(client)
    semester = create_semester(client)
    task_response = client.post(
        "/api/v1/tasks",
        json={
            "name": "Draft literature review",
            "estimated_minutes": 120,
        },
    )
    assert task_response.status_code == 201
    task = task_response.json()

    assert client.get(f"/api/v1/semesters/{semester['id']}/schedule").json() is None

    response = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/blocks",
        json={
            "title": "Literature review",
            "task_id": task["id"],
            "start_at": "2026-09-08T17:00:00-07:00",
            "end_at": "2026-09-08T18:00:00-07:00",
            "block_type": "focus",
            "locked": True,
        },
    )
    assert response.status_code == 201
    block = response.json()
    assert block["source"] == "manual"

    schedule = client.get(f"/api/v1/semesters/{semester['id']}/schedule").json()
    assert schedule["status"] == "accepted"
    assert schedule["reason"] == "Manual planning"
    assert [item["id"] for item in schedule["blocks"]] == [block["id"]]

    conflict = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/blocks",
        json={
            "title": "Conflicting work",
            "start_at": "2026-09-08T17:30:00-07:00",
            "end_at": "2026-09-08T18:30:00-07:00",
        },
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "SCHEDULE_CONFLICT"

    moved = client.patch(
        f"/api/v1/schedule-blocks/{block['id']}",
        json={
            "start_at": "2026-09-08T18:00:00-07:00",
            "end_at": "2026-09-08T19:00:00-07:00",
            "locked": False,
        },
    )
    assert moved.status_code == 200
    assert moved.json()["locked"] is False
    assert client.delete(f"/api/v1/schedule-blocks/{block['id']}").status_code == 204


def test_schedule_blocks_are_user_scoped(client: TestClient) -> None:
    register(client, "first@example.com")
    semester = create_semester(client)
    block_response = client.post(
        f"/api/v1/semesters/{semester['id']}/schedule/blocks",
        json={
            "title": "Private plan",
            "start_at": "2026-09-09T09:00:00-07:00",
            "end_at": "2026-09-09T10:00:00-07:00",
        },
    )
    assert block_response.status_code == 201
    block = block_response.json()
    client.post("/api/v1/auth/logout")
    register(client, "second@example.com")

    response = client.patch(f"/api/v1/schedule-blocks/{block['id']}", json={"title": "Not mine"})
    assert response.status_code == 404


def test_course_outline_upload_returns_reviewable_proposals(client: TestClient) -> None:
    register(client)
    outline = b"""CSC 320 Algorithms
Instructor: Dr. Chen
Lectures MWF 9:00 AM - 9:50 AM Room ECS 125
Assignment 1 due September 25, 2026 10%
Midterm exam October 20, 2026 25%
"""

    response = client.post(
        "/api/v1/documents/parse-outline",
        data={"semester_start": "2026-09-02"},
        files={"file": ("csc-320-outline.txt", outline, "text/plain")},
    )

    assert response.status_code == 200
    proposal = response.json()
    assert proposal["course"]["code"] == "CSC 320"
    assert proposal["course"]["name"] == "Algorithms"
    assert proposal["course"]["instructor"] == "Dr. Chen"
    assert [item["kind"] for item in proposal["items"]] == ["assignment", "exam"]
    assert len(proposal["meetings"]) == 3
    assert {meeting["day_of_week"] for meeting in proposal["meetings"]} == {0, 2, 4}


def test_course_outline_upload_rejects_unsupported_files(client: TestClient) -> None:
    register(client)

    response = client.post(
        "/api/v1/documents/parse-outline",
        data={"semester_start": "2026-09-02"},
        files={"file": ("outline.html", b"<p>Course outline</p>", "text/html")},
    )

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "UNSUPPORTED_DOCUMENT"


def test_related_course_documents_are_classified_and_merged(client: TestClient) -> None:
    register(client)

    response = client.post(
        "/api/v1/documents/parse-outlines",
        data={"semester_start": "2026-01-05"},
        files=[
            (
                "files",
                (
                    "course-schedule.txt",
                    b"CSC 349A Numerical Analysis\nAssignment 1 due January 18, 2026\n",
                    "text/plain",
                ),
            ),
            (
                "files",
                (
                    "lecture-01.txt",
                    b"CSC349A Numerical Analysis\n"
                    b"Instructor: Bruce Kapron\n"
                    b"Midterm 1 Fri, 13 February 2026\n",
                    "text/plain",
                ),
            ),
        ],
    )

    assert response.status_code == 200
    proposals = response.json()
    assert len(proposals) == 1
    assert proposals[0]["source_files"] == ["course-schedule.txt", "lecture-01.txt"]
    assert proposals[0]["course"]["code"] == "CSC 349A"
    assert proposals[0]["course"]["name"] == "Numerical Analysis"
    assert proposals[0]["course"]["instructor"] == "Bruce Kapron"
    assert [item["name"] for item in proposals[0]["items"]] == ["Assignment 1", "Midterm 1"]
