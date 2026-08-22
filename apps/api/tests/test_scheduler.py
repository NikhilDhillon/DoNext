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
