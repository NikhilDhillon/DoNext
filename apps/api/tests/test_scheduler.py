import time
from datetime import UTC, date, datetime, timedelta
from typing import cast

import pytest

import donext.scheduler as scheduler
from donext.scheduler import SchedulingItem, SchedulingWindow, session_durations, solve_schedule


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


@pytest.mark.parametrize("force_greedy", [False, True], ids=["cp-sat", "greedy"])
def test_exam_fairness_does_not_cross_urgency_bands(
    monkeypatch: pytest.MonkeyPatch, force_greedy: bool
) -> None:
    if force_greedy:
        monkeypatch.setattr(scheduler, "_optimize_sessions", lambda *args, **kwargs: None)
    start = datetime(2026, 9, 9, 9, tzinfo=UTC)

    def exam(identifier: str, risk_tier: int) -> SchedulingItem:
        return SchedulingItem(
            id=identifier,
            title=identifier,
            target_minutes=100,
            minimum_session_minutes=50,
            preferred_session_minutes=50,
            maximum_session_minutes=50,
            priority_rank=3,
            intensity="moderate",
            kind="exam_prep",
            risk_tier=risk_tier,
        )

    result = solve_schedule(
        [exam("urgent-exam", 4), exam("later-exam", 2)],
        [SchedulingWindow(start, start + timedelta(minutes=110))],
        minimum_break_minutes=0,
    )

    assert result.scheduled_minutes == {"urgent-exam": 100, "later-exam": 0}


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


def test_placements_name_the_work_they_displaced() -> None:
    windows = [
        SchedulingWindow(
            start_at=datetime(2026, 9, 1, 9, tzinfo=UTC),
            end_at=datetime(2026, 9, 1, 13, tzinfo=UTC),
            daily_capacity_minutes=130,
        )
    ]
    required = task("task:report", minutes=120, importance=100)
    goal = SchedulingItem(
        id="goal:running",
        title="Evening run",
        target_minutes=120,
        minimum_session_minutes=30,
        preferred_session_minutes=30,
        maximum_session_minutes=30,
        priority_rank=2,
        intensity="light",
        kind="goal",
        required=False,
    )

    result = solve_schedule([required, goal], windows, minimum_break_minutes=10)

    assert result.scheduled_minutes["task:report"] == 120
    assert result.scheduled_minutes["goal:running"] < 120
    academic = [placement for placement in result.placements if placement.item_id == "task:report"]
    assert academic
    assert all(
        placement.reason_details["displaced_title"] == "Evening run" for placement in academic
    )
    assert all(placement.reason_details["displaced_kind"] == "goal" for placement in academic)
    assert all(
        cast(int, placement.reason_details["displaced_shortfall_minutes"]) > 0
        for placement in academic
    )


def test_a_block_that_displaced_nothing_makes_no_claim() -> None:
    windows = [
        SchedulingWindow(
            start_at=datetime(2026, 9, 1, 9, tzinfo=UTC),
            end_at=datetime(2026, 9, 1, 17, tzinfo=UTC),
            daily_capacity_minutes=480,
        )
    ]

    result = solve_schedule([task("task:report", minutes=60)], windows, minimum_break_minutes=10)

    assert result.placements
    assert all("displaced_title" not in placement.reason_details for placement in result.placements)


def test_urgent_work_beats_the_pre_exam_boost_when_capacity_is_scarce() -> None:
    start = datetime(2026, 9, 2, 9, tzinfo=UTC)
    urgent = SchedulingItem(
        id="urgent",
        title="Urgent assignment",
        target_minutes=50,
        minimum_session_minutes=50,
        preferred_session_minutes=50,
        maximum_session_minutes=50,
        priority_rank=3,
        intensity="moderate",
        risk_tier=4,
        importance_rank=4_000_000,
    )
    pre_exam = SchedulingItem(
        id="pre-exam",
        title="Pre-exam assignment",
        target_minutes=50,
        minimum_session_minutes=50,
        preferred_session_minutes=50,
        maximum_session_minutes=50,
        priority_rank=3,
        intensity="moderate",
        risk_tier=3,
        importance_rank=3_000_000,
        exam_relationship="same_course_pre_exam",
    )

    result = solve_schedule(
        [pre_exam, urgent],
        [SchedulingWindow(start, start + timedelta(minutes=50))],
        minimum_break_minutes=0,
    )

    assert result.used_baseline is False
    assert result.scheduled_minutes == {"pre-exam": 0, "urgent": 50}


@pytest.mark.parametrize("force_greedy", [False, True], ids=["cp-sat", "greedy"])
def test_same_course_pre_exam_relationship_beats_otherwise_equal_work(
    monkeypatch: pytest.MonkeyPatch, force_greedy: bool
) -> None:
    if force_greedy:
        monkeypatch.setattr(scheduler, "_optimize_sessions", lambda *args, **kwargs: None)
    start = datetime(2026, 9, 2, 9, tzinfo=UTC)
    common = {
        "target_minutes": 50,
        "minimum_session_minutes": 50,
        "preferred_session_minutes": 50,
        "maximum_session_minutes": 50,
        "priority_rank": 3,
        "intensity": "moderate",
        "due_at": datetime(2026, 9, 8, 17, tzinfo=UTC),
        "slack_minutes": 300,
    }
    ordinary = SchedulingItem(id="ordinary", title="Ordinary", risk_tier=2, **common)
    pre_exam = SchedulingItem(
        id="pre-exam",
        title="Pre-exam",
        risk_tier=3,
        exam_relationship="same_course_pre_exam",
        **common,
    )

    result = solve_schedule(
        [ordinary, pre_exam],
        [SchedulingWindow(start, start + timedelta(minutes=50))],
        minimum_break_minutes=0,
    )

    assert result.scheduled_minutes == {"ordinary": 0, "pre-exam": 50}


def test_optimizer_uses_and_reports_the_actual_window_energy() -> None:
    day = datetime(2026, 9, 2, tzinfo=UTC)
    deep = SchedulingItem(
        id="deep",
        title="Deep work",
        target_minutes=50,
        minimum_session_minutes=50,
        preferred_session_minutes=50,
        maximum_session_minutes=50,
        priority_rank=3,
        intensity="deep",
    )
    result = solve_schedule(
        [deep],
        [
            SchedulingWindow(day.replace(hour=9), day.replace(hour=10), "low"),
            SchedulingWindow(day.replace(hour=15), day.replace(hour=16), "high"),
        ],
        minimum_break_minutes=0,
    )

    assert result.placements[0].start_at.hour == 15
    assert result.placements[0].reason_details["energy_level"] == "high"
    assert result.placements[0].reason_details["energy_matched"] is True


@pytest.mark.parametrize(
    ("intensity", "window_energy", "matched"),
    [("moderate", "high", False), ("deep", "low", False), ("deep", "high", True)],
)
def test_placement_reports_the_window_energy_it_actually_used(
    intensity: str, window_energy: str, matched: bool
) -> None:
    # The only opening is the one under test, so the reported energy has to be that window's
    # own level. Reporting a match instead would make the mismatch objective blind to ordinary
    # work and would let a block claim an energy fit that was never checked.
    day = datetime(2026, 9, 2, tzinfo=UTC)
    item = SchedulingItem(
        id="work",
        title="Work",
        target_minutes=50,
        minimum_session_minutes=50,
        preferred_session_minutes=50,
        maximum_session_minutes=50,
        priority_rank=3,
        intensity=intensity,
    )

    result = solve_schedule(
        [item],
        [SchedulingWindow(day.replace(hour=9), day.replace(hour=11), window_energy)],
        minimum_break_minutes=0,
    )

    details = result.placements[0].reason_details
    assert details["energy_level"] == window_energy
    assert details["chosen_energy_level"] == window_energy
    assert details["energy_matched"] is matched


def test_greedy_keeps_the_break_between_openings_that_meet_exactly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Availability that runs to midnight leaves one opening ending exactly where the next
    # begins. The break separates generated sessions, so it has to be reserved across the
    # boundary rather than only inside the opening being split.
    monkeypatch.setattr(scheduler, "_optimize_sessions", lambda *args, **kwargs: None)
    windows = [
        SchedulingWindow(
            datetime(2026, 9, 3, 23, tzinfo=UTC),
            datetime(2026, 9, 4, tzinfo=UTC),
            daily_capacity_minutes=600,
        ),
        SchedulingWindow(
            datetime(2026, 9, 4, tzinfo=UTC),
            datetime(2026, 9, 4, 3, tzinfo=UTC),
            daily_capacity_minutes=600,
        ),
    ]
    deadline = datetime(2026, 9, 4, 6, tzinfo=UTC)
    items = [
        task("first", minutes=60, due_at=deadline, latest_end_at=deadline),
        task("second", minutes=60, due_at=deadline, latest_end_at=deadline),
    ]

    result = solve_schedule(items, windows, minimum_break_minutes=15)

    assert result.used_baseline is True
    assert not constraint_violations(items, windows, result, 15)
    assert result.scheduled_minutes == {"first": 60, "second": 60}


def test_session_partition_preserves_exact_minutes_and_never_breaks_minimum() -> None:
    exact = task("exact", minutes=151)
    impossible = SchedulingItem(
        id="remainder",
        title="Remainder",
        target_minutes=15,
        minimum_session_minutes=10,
        preferred_session_minutes=10,
        maximum_session_minutes=10,
        priority_rank=1,
        intensity="moderate",
    )

    assert sum(session_durations(exact)) == 151
    assert all(25 <= duration <= 90 for duration in session_durations(exact))
    assert session_durations(impossible) == [10]


def test_final_session_does_not_need_a_trailing_break_inside_the_window() -> None:
    start = datetime(2026, 9, 2, 9, tzinfo=UTC)
    result = solve_schedule(
        [task("deadline", minutes=50)],
        [SchedulingWindow(start, start + timedelta(minutes=50))],
        minimum_break_minutes=10,
    )

    assert result.scheduled_minutes["deadline"] == 50


def test_start_alignment_rounds_a_boundary_with_seconds_to_the_next_quarter_hour() -> None:
    window_start = datetime(2026, 9, 2, 12, 54, 23, tzinfo=UTC)
    result = solve_schedule(
        [task("aligned", minutes=50)],
        [SchedulingWindow(window_start, window_start.replace(hour=15))],
        minimum_break_minutes=0,
    )

    assert result.placements[0].start_at == datetime(2026, 9, 2, 13, 0, tzinfo=UTC)


def test_displacement_requires_a_session_that_fits_the_freed_block() -> None:
    start = datetime(2026, 9, 2, 9, tzinfo=UTC)
    required = SchedulingItem(
        id="required",
        title="Required",
        target_minutes=30,
        minimum_session_minutes=30,
        preferred_session_minutes=30,
        maximum_session_minutes=30,
        priority_rank=3,
        intensity="moderate",
    )
    goal = SchedulingItem(
        id="goal",
        title="Goal",
        target_minutes=60,
        minimum_session_minutes=60,
        preferred_session_minutes=60,
        maximum_session_minutes=60,
        priority_rank=2,
        intensity="moderate",
        kind="goal",
        required=False,
    )
    result = solve_schedule(
        [required, goal],
        [SchedulingWindow(start, start + timedelta(minutes=30))],
        minimum_break_minutes=0,
    )

    assert result.placements
    assert "displaced_title" not in result.placements[0].reason_details


@pytest.mark.parametrize("force_greedy", [False, True], ids=["cp-sat", "greedy"])
def test_same_local_due_date_uses_known_weight_as_the_tie_breaker(
    monkeypatch: pytest.MonkeyPatch, force_greedy: bool
) -> None:
    if force_greedy:
        monkeypatch.setattr(scheduler, "_optimize_sessions", lambda *args, **kwargs: None)
    start = datetime(2026, 9, 2, 9, tzinfo=UTC)
    due_at = datetime(2026, 9, 8, 23, 59, tzinfo=UTC)

    def weighted(identifier: str, weight: float) -> SchedulingItem:
        return SchedulingItem(
            id=identifier,
            title=identifier,
            target_minutes=50,
            minimum_session_minutes=50,
            preferred_session_minutes=50,
            maximum_session_minutes=50,
            priority_rank=3,
            intensity="moderate",
            due_at=due_at,
            risk_tier=2,
            slack_minutes=500,
            weight_percent=weight,
        )

    result = solve_schedule(
        [weighted("low-weight", 5), weighted("high-weight", 30)],
        [SchedulingWindow(start, start + timedelta(minutes=50))],
        minimum_break_minutes=0,
    )

    assert result.scheduled_minutes == {"low-weight": 0, "high-weight": 50}


@pytest.mark.parametrize("force_greedy", [False, True], ids=["cp-sat", "greedy"])
def test_unknown_weight_skips_weight_comparison_and_falls_back_to_exact_deadline(
    monkeypatch: pytest.MonkeyPatch, force_greedy: bool
) -> None:
    if force_greedy:
        monkeypatch.setattr(scheduler, "_optimize_sessions", lambda *args, **kwargs: None)
    start = datetime(2026, 9, 2, 9, tzinfo=UTC)
    common = {
        "target_minutes": 50,
        "minimum_session_minutes": 50,
        "preferred_session_minutes": 50,
        "maximum_session_minutes": 50,
        "priority_rank": 3,
        "intensity": "moderate",
        "risk_tier": 2,
        "slack_minutes": 500,
    }
    earlier_unknown = SchedulingItem(
        id="earlier-unknown",
        title="Earlier unknown weight",
        due_at=datetime(2026, 9, 8, 12, tzinfo=UTC),
        weight_percent=None,
        **common,
    )
    later_known = SchedulingItem(
        id="later-known",
        title="Later known weight",
        due_at=datetime(2026, 9, 8, 18, tzinfo=UTC),
        weight_percent=80,
        **common,
    )

    result = solve_schedule(
        [later_known, earlier_unknown],
        [SchedulingWindow(start, start + timedelta(minutes=50))],
        minimum_break_minutes=0,
    )

    assert result.scheduled_minutes == {"later-known": 0, "earlier-unknown": 50}


def constraint_violations(
    items: list[SchedulingItem],
    windows: list[SchedulingWindow],
    result: object,
    minimum_break_minutes: int,
) -> list[str]:
    """Hard constraints that must hold whichever path produced the placements."""
    placements = sorted(
        cast(list[object], getattr(result, "placements")),  # noqa: B009
        key=lambda placement: getattr(placement, "start_at"),  # noqa: B009
    )
    by_id = {item.id: item for item in items}
    problems: list[str] = []
    for earlier, later in zip(placements, placements[1:], strict=False):
        gap = (later.start_at - earlier.end_at).total_seconds() / 60  # type: ignore[attr-defined]
        if gap < 0:
            problems.append("overlapping placements")
        elif gap < minimum_break_minutes:
            problems.append("break shorter than the configured minimum")
    used_by_day: dict[date, int] = {}
    for placement in placements:
        minutes = round((placement.end_at - placement.start_at).total_seconds() / 60)  # type: ignore[attr-defined]
        day = placement.start_at.date()  # type: ignore[attr-defined]
        used_by_day[day] = used_by_day.get(day, 0) + minutes
        item = by_id[placement.item_id]  # type: ignore[attr-defined]
        if item.earliest_start_at is not None and placement.start_at < item.earliest_start_at:  # type: ignore[attr-defined]
            problems.append(f"{item.id} started before its earliest start")
        if item.latest_end_at is not None and placement.end_at > item.latest_end_at:  # type: ignore[attr-defined]
            problems.append(f"{item.id} finished after its deadline")
        if item.eligible_dates is not None and day not in item.eligible_dates:
            problems.append(f"{item.id} landed on an ineligible day")
        if not any(
            window.start_at <= placement.start_at and placement.end_at <= window.end_at  # type: ignore[attr-defined]
            for window in windows
        ):
            problems.append(f"{item.id} landed outside every availability window")
    for day, minutes in used_by_day.items():
        cap = max(
            (
                window.daily_capacity_minutes
                for window in windows
                if window.start_at.date() == day and window.daily_capacity_minutes is not None
            ),
            default=None,
        )
        if cap is not None and minutes > cap:
            problems.append(f"{day} exceeded its daily capacity")
    return problems


def mixed_load() -> tuple[list[SchedulingItem], list[SchedulingWindow]]:
    start = datetime(2026, 9, 7, 9, tzinfo=UTC)
    windows = [
        SchedulingWindow(
            start_at=start + timedelta(days=offset),
            end_at=start + timedelta(days=offset, hours=8),
            daily_capacity_minutes=300,
        )
        for offset in range(5)
    ]
    items = [
        task("task:early", minutes=150, importance=90, latest_end_at=start + timedelta(days=2)),
        task("task:late", minutes=200, importance=40, latest_end_at=start + timedelta(days=4)),
        SchedulingItem(
            id="exam:midterm",
            title="CSC 370 · Midterm prep",
            target_minutes=240,
            minimum_session_minutes=30,
            preferred_session_minutes=45,
            maximum_session_minutes=45,
            priority_rank=4,
            intensity="deep",
            kind="exam_prep",
        ),
        SchedulingItem(
            id="goal:run",
            title="Evening run",
            target_minutes=90,
            minimum_session_minutes=30,
            preferred_session_minutes=30,
            maximum_session_minutes=30,
            priority_rank=2,
            intensity="light",
            kind="goal",
            required=False,
        ),
    ]
    return items, windows


def test_a_long_assignment_starts_early_when_delay_would_make_it_infeasible() -> None:
    # Ten hours due in four days against exactly ten hours of capacity: any idle day makes the
    # deadline impossible, so the long assignment has to begin on the first day even though a
    # one-hour assignment is due sooner.
    start = datetime(2026, 9, 7, 9, tzinfo=UTC)
    windows = [
        SchedulingWindow(
            start_at=start + timedelta(days=offset),
            end_at=start + timedelta(days=offset, hours=6),
            daily_capacity_minutes=165,
        )
        for offset in range(4)
    ]
    long_assignment = task(
        "task:capstone",
        minutes=600,
        importance=50,
        latest_end_at=start + timedelta(days=3, hours=6),
    )
    short_assignment = task(
        "task:worksheet",
        minutes=60,
        importance=60,
        latest_end_at=start + timedelta(days=1, hours=6),
    )

    result = solve_schedule([long_assignment, short_assignment], windows, minimum_break_minutes=10)

    long_days = sorted(
        {
            placement.start_at.date()
            for placement in result.placements
            if placement.item_id == "task:capstone"
        }
    )
    assert long_days
    assert long_days[0] == start.date()
    assert result.scheduled_minutes["task:worksheet"] == 60
    assert not constraint_violations([long_assignment, short_assignment], windows, result, 10)


def test_greedy_and_optimized_paths_satisfy_the_same_hard_constraints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    items, windows = mixed_load()
    optimized = solve_schedule(items, windows, minimum_break_minutes=10)

    monkeypatch.setattr(scheduler, "_optimize_sessions", lambda *args, **kwargs: None)
    greedy = solve_schedule(items, windows, minimum_break_minutes=10)

    assert optimized.used_baseline is False
    assert greedy.used_baseline is True
    assert not constraint_violations(items, windows, optimized, 10)
    assert not constraint_violations(items, windows, greedy, 10)
    # Both paths must respect the same sacrifice order: required academics never lose capacity
    # to the flexible goal.
    for result in (optimized, greedy):
        assert result.scheduled_minutes["task:early"] == 150
        assert result.scheduled_minutes["task:late"] == 200
