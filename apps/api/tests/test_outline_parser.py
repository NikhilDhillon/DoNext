from datetime import date

from donext.outline_parser import (
    ExtractedDocument,
    _build_grading_proposal,
    _extract_calendar_items,
    _extract_items_from_tables,
    _extract_meetings_from_tables,
    _merge_items,
    _proposal_warnings,
    _source_date_warnings,
)
from donext.schemas import OutlineCourseProposal, OutlineItemProposal


def test_calendar_grid_extracts_assignments_and_exam_windows() -> None:
    document = ExtractedDocument(
        text="CSC 349A - February 2026",
        pages=["CSC 349A - February 2026"],
        tables=[
            [
                ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
                ["1 Due: Ass 2", "2", "3", "4", "5", "6", "7"],
                ["8", "9", "10", "11", "12 Midterm 1", "13 Midterm 1", "14"],
            ]
        ],
    )

    items = _extract_calendar_items(document, date(2026, 1, 5))

    assert [(item.name, item.deadline_at.date()) for item in items if item.deadline_at] == [
        ("Assignment 2", date(2026, 2, 1)),
        ("Midterm 1", date(2026, 2, 12)),
        ("Midterm 1", date(2026, 2, 13)),
    ]
    merged = _merge_items(items)
    midterm = next(item for item in merged if item.name == "Midterm 1")
    assert midterm.deadline_at and midterm.deadline_at.date() == date(2026, 2, 13)
    assert "February 12" in midterm.source_text
    assert "February 13" in midterm.source_text


def test_calendar_year_conflicts_and_missing_dates_are_review_warnings() -> None:
    document = ExtractedDocument(text="CSC 349A - March 2025", pages=[], tables=[])
    year_warnings = _source_date_warnings(document, date(2026, 1, 5))
    item = proposal("Final Exam", "exam", 40)
    proposal_warnings = _proposal_warnings(
        OutlineCourseProposal(code="CSC 349A", name="Numerical Analysis", confidence=0.9),
        [item],
        [],
        "course_schedule",
    )

    assert year_warnings == [
        "The document contains calendar headings for 2025, but this semester starts in 2026. "
        "DoNext used 2026; review those dates."
    ]
    assert any("1 academic item has no date" in warning for warning in proposal_warnings)
    assert any("No recurring class times" in warning for warning in proposal_warnings)


def test_formal_outline_tables_extract_assessments_and_recurring_meetings() -> None:
    tables = [
        [
            [
                "Section",
                "Schedule",
                "Location",
                "Days of Weeks*",
                "Hours of Day",
                "Instructor",
            ],
            ["A01", "Lecture", "MAC D283", "MWR", "12:30-14:20", "Sean Chester"],
        ],
        [
            ["Exams", "Due Date"],
            ["Basic Skills Test", "Thu, 30 July 2026"],
            ["Design Test", "Thu, 13 August 2026"],
        ],
    ]
    course = OutlineCourseProposal(
        code="CSC 370", name="Database Systems", instructor="Sean Chester", confidence=0.95
    )

    items = _extract_items_from_tables(tables, 2026)
    meetings = _extract_meetings_from_tables(tables, course)

    assert [item.name for item in items] == ["Basic Skills Test", "Design Test"]
    assert [item.deadline_at.date() for item in items if item.deadline_at] == [
        date(2026, 7, 30),
        date(2026, 8, 13),
    ]
    assert {meeting.day_of_week for meeting in meetings} == {0, 2, 3}
    assert {meeting.location for meeting in meetings} == {"MAC D283"}


def proposal(name: str, kind: str, weight: float | None = None) -> OutlineItemProposal:
    return OutlineItemProposal(
        name=name,
        kind=kind,  # type: ignore[arg-type]
        weight_percent=weight,
        estimated_minutes=240,
        confidence=0.9,
        source_text=f"{name} {weight or ''}%",
    )


def test_csc_349a_grading_rules_become_two_complete_schemes() -> None:
    items = [
        *[proposal(f"Assignment {number}", "assignment") for number in range(1, 7)],
        proposal("Assignments", "assignment", 30),
        proposal("Midterm 1", "exam"),
        proposal("Midterm 2", "exam"),
        proposal("Midterms", "exam", 30),
        proposal("Final Exam", "exam", 40),
    ]
    items, groups, schemes = _build_grading_proposal(
        items,
        [
            "Lowest grade is dropped",
            "2 Midterms 30% and Final Exam 40%.",
            "Best Midterm 20% and Final Exam 50%",
        ],
    )

    assert {group.key for group in groups} == {"assignments", "midterms"}
    assignments = next(group for group in groups if group.key == "assignments")
    assert assignments.weight_origin.value == "explicit"
    assert len([item for item in items if item.group_key == "assignments"]) == 6
    assert [scheme.is_complete for scheme in schemes] == [True, True]
    standard_assignments = schemes[0].components[0]
    assert standard_assignments.selection_rule.value == "drop_lowest_n"
    assert standard_assignments.selection_count == 1
    alternative_midterms = next(
        component for component in schemes[1].components if component.target_group_key == "midterms"
    )
    assert alternative_midterms.weight_percent == 20
    assert alternative_midterms.selection_rule.value == "best_n"


def test_csc_370_project_attempt_and_pass_rules_are_preserved() -> None:
    items = [
        proposal("Group term project", "project", 40),
        *[
            OutlineItemProposal(
                name=f"Sprint {number}",
                kind="project",
                estimated_minutes=720,
                confidence=0.96,
                source_text=f"Sprint {number} | 20%",
            )
            for number in range(1, 6)
        ],
        proposal("Basic skills test", "exam", 35),
        proposal("Design test", "exam", 25),
        proposal("Optional Rewrite", "exam"),
    ]
    items, groups, schemes = _build_grading_proposal(
        items,
        [
            "A grade of 60% or higher is required on the Basic skills test.",
            "A student must score at least 60% on at least one attempt of the Basic skills test.",
        ],
    )

    assert {group.key for group in groups} == {"term-project", "basic-skills-attempts"}
    sprints = [item for item in items if item.group_key == "term-project"]
    assert [item.relative_weight_percent for item in sprints] == [20, 20, 20, 20, 20]
    attempt_component = next(
        component
        for component in schemes[0].components
        if component.target_group_key == "basic-skills-attempts"
    )
    assert attempt_component.weight_percent == 35
    assert attempt_component.selection_rule.value == "highest_attempt"
    assert attempt_component.minimum_required_percent == 60
    assert schemes[0].is_complete
