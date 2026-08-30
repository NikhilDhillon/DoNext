from datetime import date
from types import SimpleNamespace

import donext.academic_planning as planning
from donext.academic_planning import (
    AcademicPlanDecision,
    AcademicPlanningInput,
    plan_academic_sessions,
)


def midterm_input() -> AcademicPlanningInput:
    return AcademicPlanningInput(
        source_id="task:midterm",
        course_code="CSC 370",
        assessment_name="Midterm Exam",
        assessment_type="midterm",
        due_date=date(2026, 10, 15),
        session_durations=(50, 50, 50),
        available_dates=(
            date(2026, 9, 21),
            date(2026, 9, 23),
            date(2026, 9, 25),
            date(2026, 9, 28),
            date(2026, 9, 30),
        ),
    )


def test_fallback_spreads_midterm_prep_and_labels_what_each_block_means(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        planning,
        "get_settings",
        lambda: SimpleNamespace(openai_api_key=None),
    )

    result = plan_academic_sessions([midterm_input()])

    sessions = result.sessions_by_source["task:midterm"]
    assert result.source == "fallback"
    assert len({session.preferred_date for session in sessions}) == 3
    assert all(session.title != "Midterm Exam" for session in sessions)
    assert sessions[0].title == "CSC 370 · Start preparing for Midterm Exam"
    assert sessions[-1].title == "CSC 370 · Review for Midterm Exam"


def test_openai_can_choose_phases_and_dates_but_not_session_sizes(monkeypatch) -> None:
    parsed = AcademicPlanDecision.model_validate(
        {
            "sessions": [
                {
                    "source_id": "task:midterm",
                    "session_index": 0,
                    "phase": "orient",
                    "preferred_date": "2026-09-21",
                },
                {
                    "source_id": "task:midterm",
                    "session_index": 1,
                    "phase": "review",
                    "preferred_date": "2026-09-25",
                },
                {
                    "source_id": "task:midterm",
                    "session_index": 2,
                    "phase": "practice",
                    "preferred_date": "2026-09-30",
                },
            ]
        }
    )

    class FakeResponses:
        def parse(self, **_kwargs: object) -> SimpleNamespace:
            return SimpleNamespace(output_parsed=parsed)

    class FakeOpenAI:
        def __init__(self, **_kwargs: object) -> None:
            self.responses = FakeResponses()

    monkeypatch.setattr(planning, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(
        planning,
        "get_settings",
        lambda: SimpleNamespace(
            openai_api_key="test-key",
            openai_academic_planning_timeout_seconds=5.0,
            openai_scheduling_model="gpt-5.6-luna",
        ),
    )

    result = plan_academic_sessions([midterm_input()])

    sessions = result.sessions_by_source["task:midterm"]
    assert result.source == "openai"
    assert [session.duration_minutes for session in sessions] == [50, 50, 50]
    assert [session.preferred_date for session in sessions] == [
        date(2026, 9, 21),
        date(2026, 9, 25),
        date(2026, 9, 30),
    ]
    assert sessions[-1].title == "CSC 370 · Practice for Midterm Exam"


def test_invalid_ai_date_falls_back_to_confirmed_available_dates(monkeypatch) -> None:
    parsed = AcademicPlanDecision.model_validate(
        {
            "sessions": [
                {
                    "source_id": "task:midterm",
                    "session_index": index,
                    "phase": "practice",
                    "preferred_date": "2026-10-16",
                }
                for index in range(3)
            ]
        }
    )

    class FakeResponses:
        def parse(self, **_kwargs: object) -> SimpleNamespace:
            return SimpleNamespace(output_parsed=parsed)

    class FakeOpenAI:
        def __init__(self, **_kwargs: object) -> None:
            self.responses = FakeResponses()

    monkeypatch.setattr(planning, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(
        planning,
        "get_settings",
        lambda: SimpleNamespace(
            openai_api_key="test-key",
            openai_academic_planning_timeout_seconds=5.0,
            openai_scheduling_model="gpt-5.6-luna",
        ),
    )

    result = plan_academic_sessions([midterm_input()])

    assert result.source == "fallback"
    assert all(
        session.preferred_date in midterm_input().available_dates
        for session in result.sessions_by_source["task:midterm"]
    )


def test_ai_cannot_put_later_preparation_phases_before_earlier_ones(monkeypatch) -> None:
    parsed = AcademicPlanDecision.model_validate(
        {
            "sessions": [
                {
                    "source_id": "task:midterm",
                    "session_index": 0,
                    "phase": "practice",
                    "preferred_date": "2026-09-21",
                },
                {
                    "source_id": "task:midterm",
                    "session_index": 1,
                    "phase": "review",
                    "preferred_date": "2026-09-25",
                },
                {
                    "source_id": "task:midterm",
                    "session_index": 2,
                    "phase": "final_review",
                    "preferred_date": "2026-09-30",
                },
            ]
        }
    )

    class FakeResponses:
        def parse(self, **_kwargs: object) -> SimpleNamespace:
            return SimpleNamespace(output_parsed=parsed)

    class FakeOpenAI:
        def __init__(self, **_kwargs: object) -> None:
            self.responses = FakeResponses()

    monkeypatch.setattr(planning, "OpenAI", FakeOpenAI)
    monkeypatch.setattr(
        planning,
        "get_settings",
        lambda: SimpleNamespace(
            openai_api_key="test-key",
            openai_academic_planning_timeout_seconds=5.0,
            openai_scheduling_model="gpt-5.6-luna",
        ),
    )

    result = plan_academic_sessions([midterm_input()])

    assert result.source == "fallback"
    assert result.sessions_by_source["task:midterm"][0].phase == "orient"


def test_class_meeting_dates_reach_the_model_payload() -> None:
    item = AcademicPlanningInput(
        source_id="task:assignment",
        course_code="CSC 349A",
        assessment_name="Assignment 1",
        assessment_type="assignment",
        due_date=date(2026, 9, 18),
        session_durations=(50,),
        available_dates=(date(2026, 9, 14), date(2026, 9, 16)),
        class_meeting_dates=(date(2026, 9, 8), date(2026, 9, 15)),
    )

    payload = planning._model_payload([item])

    assert payload[0]["class_meeting_dates"] == ["2026-09-08", "2026-09-15"]


def test_class_meeting_dates_default_to_empty_for_courses_without_meetings() -> None:
    payload = planning._model_payload([midterm_input()])

    assert payload[0]["class_meeting_dates"] == []
