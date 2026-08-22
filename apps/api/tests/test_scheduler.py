from datetime import UTC, date, datetime

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
