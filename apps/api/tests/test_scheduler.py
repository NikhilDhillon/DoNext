import time
from datetime import UTC, date, datetime, timedelta

import pytest

import donext.scheduler as scheduler
from donext.scheduler import SchedulingItem, SchedulingWindow, solve_schedule


def task(
    identifier: str,
    minutes: int = 50,
    priority: int = 3,
    importance: int = 0,
    due_at: datetime | None = None,
    earliest_start_at: datetime | None = None,
    latest_end_at: datetime | None = None,
) -> SchedulingItem:
    return SchedulingItem(
        id=identifier,
        title=f"Task {identifier}",
        target_minutes=minutes,
        minimum_session_minutes=25,
        preferred_session_minutes=50,
        maximum_session_minutes=90,
        priority_rank=priority,
        intensity="moderate",
        importance_rank=importance,
        due_at=due_at,
        earliest_start_at=earliest_start_at,
        latest_end_at=latest_end_at,
    )


def test_solver_is_deterministic_and_respects_breaks() -> None:
    windows = [
        SchedulingWindow(
            datetime(2026, 8, 12, 16, 0, tzinfo=UTC),
            datetime(2026, 8, 12, 18, 0, tzinfo=UTC),
        )
    ]
    first = solve_schedule([task("a"), task("b")], windows, minimum_break_minutes=10)
    second = solve_schedule([task("a"), task("b")], windows, minimum_break_minutes=10)

    assert first == second
    assert first.status == "optimal"
    assert len(first.placements) == 2
    assert first.placements[1].start_at >= first.placements[0].end_at
    assert (first.placements[1].start_at - first.placements[0].end_at).total_seconds() >= 600


def test_solver_reports_partial_capacity_honestly() -> None:
    windows = [
        SchedulingWindow(
            datetime(2026, 8, 12, 16, 0, tzinfo=UTC),
            datetime(2026, 8, 12, 17, 0, tzinfo=UTC),
        )
    ]
    result = solve_schedule([task("large", minutes=120)], windows, minimum_break_minutes=10)

    assert result.scheduled_minutes["large"] < 120
    assert result.placements


def test_cp_sat_shares_partial_capacity_fairly_across_simultaneous_exams() -> None:
    start = datetime(2026, 9, 9, 9, 0, tzinfo=UTC)
    exams = [
        SchedulingItem(
            id=f"exam-{index}",
            title=f"Exam {index} prep",
            target_minutes=100,
            minimum_session_minutes=50,
            preferred_session_minutes=50,
            maximum_session_minutes=50,
            priority_rank=3,
            intensity="moderate",
            kind="exam_prep",
            due_at=start + timedelta(days=index + 2),
            risk_tier=2,
            slack_minutes=0,
        )
        for index in range(2)
    ]

    result = solve_schedule(
        exams,
        [SchedulingWindow(start, start + timedelta(minutes=110))],
        minimum_break_minutes=0,
    )

    assert result.used_baseline is False
    assert result.scheduled_minutes == {"exam-0": 50, "exam-1": 50}


def test_solver_uses_a_valid_remainder_session() -> None:
    windows = [
        SchedulingWindow(
            datetime(2026, 8, 12, 16, 0, tzinfo=UTC),
            datetime(2026, 8, 12, 20, 0, tzinfo=UTC),
        )
    ]
    result = solve_schedule([task("three-hours", minutes=180)], windows, minimum_break_minutes=10)

    assert result.scheduled_minutes["three-hours"] == 180
    assert (
        sum(
            round((placement.end_at - placement.start_at).total_seconds() / 60)
            for placement in result.placements
        )
        == 180
    )


def test_solver_keeps_selected_day_targets_on_their_eligible_date() -> None:
    item = SchedulingItem(
        id="gym:wednesday",
        title="Gym",
        target_minutes=60,
        minimum_session_minutes=15,
        preferred_session_minutes=60,
        maximum_session_minutes=90,
        priority_rank=2,
        intensity="moderate",
        kind="flexible_commitment",
        eligible_dates=frozenset({date(2026, 8, 12)}),
    )
    windows = [
        SchedulingWindow(
            datetime(2026, 8, 11, 16, 0, tzinfo=UTC),
            datetime(2026, 8, 11, 18, 0, tzinfo=UTC),
        ),
        SchedulingWindow(
            datetime(2026, 8, 12, 16, 0, tzinfo=UTC),
            datetime(2026, 8, 12, 18, 0, tzinfo=UTC),
        ),
    ]

    result = solve_schedule([item], windows, minimum_break_minutes=10)

    assert result.scheduled_minutes[item.id] == 60
    assert {placement.start_at.date() for placement in result.placements} == {date(2026, 8, 12)}
    assert {placement.reason_code for placement in result.placements} == {
        "flexible_commitment_target"
    }


def test_solver_gives_limited_capacity_to_the_earlier_deadline() -> None:
    start = datetime(2026, 9, 9, 16, 0, tzinfo=UTC)
    early_due = datetime(2026, 9, 12, 23, 59, tzinfo=UTC)
    later_due = datetime(2026, 9, 26, 23, 59, tzinfo=UTC)
    windows = [SchedulingWindow(start, start.replace(hour=17))]

    result = solve_schedule(
        [
            task("assignment-4", minutes=50, importance=10, due_at=later_due),
            task("assignment-1", minutes=50, importance=100, due_at=early_due),
        ],
        windows,
        minimum_break_minutes=0,
    )

    assert result.scheduled_minutes["assignment-1"] == 50
    assert result.scheduled_minutes["assignment-4"] == 0


def test_solver_places_earlier_deadline_work_first_when_both_fit() -> None:
    start = datetime(2026, 9, 9, 16, 0, tzinfo=UTC)
    windows = [SchedulingWindow(start, start.replace(hour=18))]
    result = solve_schedule(
        [
            task("assignment-4", importance=10),
            task("assignment-1", importance=100),
        ],
        windows,
        minimum_break_minutes=10,
    )

    placements = {placement.item_id: placement for placement in result.placements}
    assert placements["assignment-1"].start_at < placements["assignment-4"].start_at


def test_solver_respects_task_start_and_deadline_boundaries() -> None:
    window_start = datetime(2026, 9, 9, 9, 0, tzinfo=UTC)
    earliest = datetime(2026, 9, 9, 10, 0, tzinfo=UTC)
    deadline = datetime(2026, 9, 9, 11, 0, tzinfo=UTC)
    result = solve_schedule(
        [
            task(
                "bounded",
                earliest_start_at=earliest,
                latest_end_at=deadline,
                due_at=deadline,
            )
        ],
        [SchedulingWindow(window_start, window_start.replace(hour=12))],
        minimum_break_minutes=0,
    )

    assert result.placements
    assert all(placement.start_at >= earliest for placement in result.placements)
    assert all(placement.end_at <= deadline for placement in result.placements)


def test_daily_capacity_is_a_budget_instead_of_an_early_day_cutoff() -> None:
    current = date(2026, 9, 9)
    windows = [
        SchedulingWindow(
            datetime(2026, 9, 9, 10, 0, tzinfo=UTC),
            datetime(2026, 9, 9, 12, 0, tzinfo=UTC),
            daily_capacity_minutes=60,
        ),
        SchedulingWindow(
            datetime(2026, 9, 9, 20, 0, tzinfo=UTC),
            datetime(2026, 9, 10, 0, 0, tzinfo=UTC),
            daily_capacity_minutes=60,
        ),
    ]
    evening = SchedulingItem(
        id="evening",
        title="Evening session",
        target_minutes=60,
        minimum_session_minutes=30,
        preferred_session_minutes=60,
        maximum_session_minutes=60,
        priority_rank=2,
        intensity="moderate",
        eligible_dates=frozenset({current}),
        earliest_start_at=datetime(2026, 9, 9, 19, 0, tzinfo=UTC),
    )

    result = solve_schedule([evening], windows, minimum_break_minutes=0)

    assert result.scheduled_minutes[evening.id] == 60
    assert result.placements[0].start_at.hour >= 20
    assert result.eligible_capacity_minutes == 60


def test_flexible_commitments_cannot_displace_required_academic_work() -> None:
    assignment = SchedulingItem(
        id="task:assignment",
        title="Assignment 1",
        target_minutes=150,
        minimum_session_minutes=50,
        preferred_session_minutes=50,
        maximum_session_minutes=50,
        priority_rank=3,
        intensity="moderate",
        required=True,
    )
    commitments = [
        SchedulingItem(
            id=f"flex:gym:{day.isoformat()}",
            title="Gym",
            target_minutes=50,
            minimum_session_minutes=50,
            preferred_session_minutes=50,
            maximum_session_minutes=50,
            priority_rank=3,
            intensity="moderate",
            kind="flexible_commitment",
            eligible_dates=frozenset({day}),
        )
        for day in (date(2026, 9, 10), date(2026, 9, 11), date(2026, 9, 12), date(2026, 9, 13))
    ]
    windows = [
        SchedulingWindow(
            datetime(2026, 9, 9, 9, 0, tzinfo=UTC),
            datetime(2026, 9, 9, 17, 0, tzinfo=UTC),
        )
    ] + [
        SchedulingWindow(
            datetime(2026, 9, 10 + offset, 9, 0, tzinfo=UTC),
            datetime(2026, 9, 10 + offset, 10, 0, tzinfo=UTC),
        )
        for offset in range(4)
    ]

    result = solve_schedule(
        [assignment, *commitments], windows, minimum_break_minutes=10, time_limit_seconds=5.0
    )

    study = [placement for placement in result.placements if placement.item_id == "task:assignment"]
    assert (
        sum(
            round((placement.end_at - placement.start_at).total_seconds() / 60)
            for placement in study
        )
        == 150
    )
    assert all(placement.title == "Assignment 1" for placement in study)


def test_optimizer_failure_returns_the_valid_baseline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(scheduler, "_optimize_sessions", lambda *args, **kwargs: None)
    windows = [
        SchedulingWindow(
            datetime(2026, 8, 12, 16, 0, tzinfo=UTC),
            datetime(2026, 8, 12, 18, 0, tzinfo=UTC),
        )
    ]

    result = solve_schedule([task("baseline")], windows, minimum_break_minutes=10)

    assert result.placements
    assert result.used_baseline is True
    assert result.timed_out is True
    assert result.status != "infeasible"


def test_large_14_day_request_returns_a_non_empty_draft_within_five_seconds() -> None:
    horizon_start = datetime(2026, 9, 9, 10, 0, tzinfo=UTC)
    windows = [
        SchedulingWindow(
            horizon_start + timedelta(days=offset),
            horizon_start + timedelta(days=offset, hours=9),
            daily_capacity_minutes=365,
            protected_free_minutes=75,
        )
        for offset in range(14)
    ]
    requested = [
        task(f"academic-{index}", minutes=minutes, importance=100 - index)
        for index, minutes in enumerate((240, 240, 420, 125, 185))
    ]
    requested.extend(
        SchedulingItem(
            id=f"flex-{index}",
            title=f"Flexible {index}",
            target_minutes=minutes,
            minimum_session_minutes=15,
            preferred_session_minutes=60,
            maximum_session_minutes=120,
            priority_rank=2,
            intensity="moderate",
            kind="flexible_commitment",
        )
        for index, minutes in enumerate((720, 720, 840, 840))
    )

    started = time.monotonic()
    result = solve_schedule(requested, windows, minimum_break_minutes=10)

    assert time.monotonic() - started < 5.5
    assert result.placements
    assert sum(result.scheduled_minutes.values()) > 0
    assert result.status != "infeasible"


def review_item(target_minutes: int, phase_end: datetime) -> SchedulingItem:
    return SchedulingItem(
        id="exam",
        title="CSC 370 · Midterm prep",
        target_minutes=target_minutes,
        minimum_session_minutes=30,
        preferred_session_minutes=45,
        maximum_session_minutes=45,
        priority_rank=3,
        intensity="deep",
        kind="exam_prep",
        review_cadence_days=3,
        review_phase_end_at=phase_end,
    )


def review_windows(days: int, hours: int) -> list[SchedulingWindow]:
    return [
        SchedulingWindow(
            start_at=datetime(2026, 9, 1, 9, tzinfo=UTC) + timedelta(days=offset),
            end_at=datetime(2026, 9, 1, 9 + hours, tzinfo=UTC) + timedelta(days=offset),
            daily_capacity_minutes=hours * 60,
        )
        for offset in range(days)
    ]


def test_early_exam_review_keeps_a_three_day_cadence_then_intensifies() -> None:
    # Nine usable days; the first six still sit inside the urgent same-course assignment phase.
    phase_end = datetime(2026, 9, 6, 23, 59, tzinfo=UTC)
    result = solve_schedule([review_item(360, phase_end)], review_windows(9, 5), 10)

    days = sorted({placement.start_at.date() for placement in result.placements})
    review_days = [day for day in days if day <= phase_end.date()]
    review_minutes = sum(
        round((placement.end_at - placement.start_at).total_seconds() / 60)
        for placement in result.placements
        if placement.start_at.date() <= phase_end.date()
    )

    assert result.scheduled_minutes["exam"] == 360
    assert review_days
    assert all(
        (later - earlier).days >= 3
        for earlier, later in zip(review_days, review_days[1:], strict=False)
    )
    assert review_minutes < 360 - review_minutes
    assert [day for day in days if day > phase_end.date()]


def test_early_exam_review_leaves_no_gap_longer_than_the_cadence() -> None:
    phase_end = datetime(2026, 9, 10, 23, 59, tzinfo=UTC)
    result = solve_schedule([review_item(270, phase_end)], review_windows(10, 3), 10)

    days = sorted({placement.start_at.date() for placement in result.placements})
    assert days
    assert all((later - earlier).days <= 3 for earlier, later in zip(days, days[1:], strict=False))
