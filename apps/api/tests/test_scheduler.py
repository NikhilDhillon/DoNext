from datetime import UTC, datetime

from donext.scheduler import SchedulingItem, SchedulingWindow, solve_schedule


def task(identifier: str, minutes: int = 50, priority: int = 3) -> SchedulingItem:
    return SchedulingItem(
        id=identifier,
        title=f"Task {identifier}",
        target_minutes=minutes,
        minimum_session_minutes=25,
        preferred_session_minutes=50,
        maximum_session_minutes=90,
        priority_rank=priority,
        intensity="moderate",
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
