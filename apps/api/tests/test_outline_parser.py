from datetime import date

from donext.outline_parser import (
    ExtractedDocument,
    _extract_calendar_items,
    _extract_items_from_tables,
    _extract_meetings_from_tables,
)
from donext.schemas import OutlineCourseProposal


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
