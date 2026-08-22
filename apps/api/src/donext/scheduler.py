from __future__ import annotations

import math
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from datetime import time as clock_time
from typing import Literal

from ortools.sat.python import cp_model

START_GRID_MINUTES = 15
MINUTE_UNIT = 5


@dataclass(frozen=True)
class SchedulingItem:
    id: str
    title: str
    target_minutes: int
    minimum_session_minutes: int
    preferred_session_minutes: int
    maximum_session_minutes: int
    priority_rank: int
    intensity: str
    kind: str = "task"
    eligible_dates: frozenset[date] | None = None
    importance_rank: int = 0
    due_at: datetime | None = None
    earliest_start_at: datetime | None = None
    latest_end_at: datetime | None = None


@dataclass(frozen=True)
class SchedulingWindow:
    start_at: datetime
    end_at: datetime
    energy_level: str = "medium"
    daily_capacity_minutes: int | None = None
    protected_free_minutes: int = 0


@dataclass(frozen=True)
class SchedulingPolicy:
    max_blocks_per_day: int | None = None
    preferred_time_ranges: tuple[tuple[int | None, clock_time, clock_time], ...] = ()


@dataclass(frozen=True)
class Placement:
    item_id: str
    title: str
    start_at: datetime
    end_at: datetime
    kind: str
    reason_code: str
    reason_details: dict[str, object]


@dataclass(frozen=True)
class SchedulingResult:
    status: Literal["optimal", "feasible", "infeasible"]
    placements: list[Placement]
    scheduled_minutes: dict[str, int]
    timed_out: bool
    used_baseline: bool = False
    eligible_capacity_minutes: int = 0
    protected_free_minutes: int = 0
    runtime_ms: int = field(default=0, compare=False)


@dataclass(frozen=True)
class _Session:
    item: SchedulingItem
    index: int
    duration_minutes: int


@dataclass
class _FreeSegment:
    start_at: datetime
    end_at: datetime
    energy_level: str


@dataclass(frozen=True)
class _Alternative:
    session: _Session
    day: date
    start: cp_model.IntVar
    selected: cp_model.IntVar
    interval: cp_model.IntervalVar
    energy_level: str


def solve_schedule(
    items: list[SchedulingItem],
    windows: list[SchedulingWindow],
    minimum_break_minutes: int,
    time_limit_seconds: float = 5.0,
    policy: SchedulingPolicy | None = None,
) -> SchedulingResult:
    started = time.monotonic()
    sessions = [
        _Session(item, index, duration)
        for item in items
        for index, duration in enumerate(_session_plan(item))
    ]
    capacity_by_day = _capacity_by_day(windows)
    baseline = _greedy_baseline(
        items, sessions, windows, capacity_by_day, minimum_break_minutes, policy
    )
    optimizer_attempted = policy is None or not policy.preferred_time_ranges
    if not optimizer_attempted:
        improved = None
    else:
        remaining = max(time_limit_seconds - (time.monotonic() - started), 0.05)
        improved = _optimize_sessions(
            items,
            sessions,
            windows,
            capacity_by_day,
            minimum_break_minutes,
            baseline,
            remaining,
            policy,
        )
    result = improved or baseline
    return SchedulingResult(
        status=result.status,
        placements=result.placements,
        scheduled_minutes=result.scheduled_minutes,
        timed_out=(optimizer_attempted and improved is None) or result.timed_out,
        used_baseline=improved is None,
        eligible_capacity_minutes=sum(capacity_by_day.values()),
        protected_free_minutes=_protected_free_minutes(windows),
        runtime_ms=round((time.monotonic() - started) * 1000),
    )


def _greedy_baseline(
    items: list[SchedulingItem],
    sessions: list[_Session],
    windows: list[SchedulingWindow],
    capacity_by_day: dict[date, int],
    minimum_break_minutes: int,
    policy: SchedulingPolicy | None,
) -> SchedulingResult:
    free = [
        _FreeSegment(window.start_at, window.end_at, window.energy_level)
        for window in sorted(windows, key=lambda value: value.start_at)
    ]
    used_by_day: dict[date, int] = defaultdict(int)
    blocks_by_day: dict[date, int] = defaultdict(int)
    item_dates: dict[tuple[str, date], int] = defaultdict(int)
    scheduled = {item.id: 0 for item in items}
    placements: list[Placement] = []
    sessions_by_item: dict[str, list[_Session]] = defaultdict(list)
    for session in sessions:
        sessions_by_item[session.item.id].append(session)

    tasks = sorted(
        (item for item in items if item.kind == "task"),
        key=lambda item: (
            item.due_at or datetime.max.replace(tzinfo=UTC),
            -item.importance_rank,
            -item.priority_rank,
            item.id,
        ),
    )
    ordered: list[_Session] = []
    for item in tasks:
        ordered.extend(sessions_by_item[item.id])
    flexible = [item for item in items if item.kind != "task"]
    for priority in sorted({item.priority_rank for item in flexible}, reverse=True):
        band = sorted(
            (item for item in flexible if item.priority_rank == priority),
            key=lambda item: item.id,
        )
        cursor = 0
        while any(cursor < len(sessions_by_item[item.id]) for item in band):
            for item in band:
                if cursor < len(sessions_by_item[item.id]):
                    ordered.append(sessions_by_item[item.id][cursor])
            cursor += 1

    for session in ordered:
        choice = _best_greedy_slot(
            session,
            free,
            used_by_day,
            capacity_by_day,
            item_dates,
            blocks_by_day,
            minimum_break_minutes,
            policy,
        )
        if choice is None:
            continue
        segment_index, start_at = choice
        occupied_end = start_at + timedelta(
            minutes=session.duration_minutes + minimum_break_minutes
        )
        segment = free.pop(segment_index)
        if segment.start_at < start_at:
            free.append(_FreeSegment(segment.start_at, start_at, segment.energy_level))
        if occupied_end < segment.end_at:
            free.append(_FreeSegment(occupied_end, segment.end_at, segment.energy_level))
        free.sort(key=lambda value: value.start_at)
        used_by_day[start_at.date()] += session.duration_minutes
        blocks_by_day[start_at.date()] += 1
        item_dates[(session.item.id, start_at.date())] += 1
        scheduled[session.item.id] += session.duration_minutes
        placements.append(_placement(session, start_at, segment.energy_level))

    placements.sort(key=lambda placement: (placement.start_at, placement.item_id))
    complete = all(scheduled[item.id] == item.target_minutes for item in items)
    return SchedulingResult(
        "optimal" if complete else "feasible",
        placements,
        scheduled,
        False,
        used_baseline=True,
    )


def _best_greedy_slot(
    session: _Session,
    free: list[_FreeSegment],
    used_by_day: dict[date, int],
    capacity_by_day: dict[date, int],
    item_dates: dict[tuple[str, date], int],
    blocks_by_day: dict[date, int],
    minimum_break_minutes: int,
    policy: SchedulingPolicy | None,
) -> tuple[int, datetime] | None:
    choices: list[tuple[tuple[object, ...], int, datetime]] = []
    occupied = session.duration_minutes + minimum_break_minutes
    for index, segment in enumerate(free):
        day = segment.start_at.date()
        if session.item.eligible_dates is not None and day not in session.item.eligible_dates:
            continue
        if used_by_day[day] + session.duration_minutes > capacity_by_day.get(day, 0):
            continue
        if (
            policy is not None
            and policy.max_blocks_per_day is not None
            and blocks_by_day[day] >= policy.max_blocks_per_day
        ):
            continue
        earliest = max(
            segment.start_at,
            session.item.earliest_start_at or segment.start_at,
        )
        start_at = _round_up(earliest)
        latest_end = min(
            segment.end_at,
            session.item.latest_end_at or segment.end_at,
        )
        if start_at + timedelta(minutes=occupied) > latest_end:
            continue
        if session.item.kind == "task":
            score: tuple[object, ...] = (
                _preferred_time_penalty(start_at, policy),
                start_at,
                0 if _energy_matches(session.item.intensity, segment.energy_level) else 1,
            )
        else:
            day_load = used_by_day[day] / max(capacity_by_day.get(day, 1), 1)
            score = (
                _preferred_time_penalty(start_at, policy),
                item_dates[(session.item.id, day)],
                day_load,
                start_at,
            )
        choices.append((score, index, start_at))
    if not choices:
        return None
    _, index, start_at = min(choices, key=lambda value: value[0])
    return index, start_at


def _optimize_sessions(
    items: list[SchedulingItem],
    sessions: list[_Session],
    windows: list[SchedulingWindow],
    capacity_by_day: dict[date, int],
    minimum_break_minutes: int,
    baseline: SchedulingResult,
    time_limit_seconds: float,
    policy: SchedulingPolicy | None,
) -> SchedulingResult | None:
    if not sessions or not windows:
        return baseline
    epoch = min(window.start_at for window in windows).astimezone(UTC)
    windows_by_day: dict[date, list[SchedulingWindow]] = defaultdict(list)
    for window in windows:
        windows_by_day[window.start_at.date()].append(window)
    model = cp_model.CpModel()
    alternatives: list[_Alternative] = []
    alternatives_by_session: dict[tuple[str, int], list[_Alternative]] = defaultdict(list)
    presence_by_session: dict[tuple[str, int], cp_model.IntVar] = {}
    intervals: list[cp_model.IntervalVar] = []
    day_selected: dict[date, list[tuple[cp_model.IntVar, int]]] = defaultdict(list)

    for session in sessions:
        key = (session.item.id, session.index)
        presence = model.new_bool_var(f"present_{session.item.id}_{session.index}")
        presence_by_session[key] = presence
        for day, day_windows in sorted(windows_by_day.items()):
            if session.item.eligible_dates is not None and day not in session.item.eligible_dates:
                continue
            starts, energy = _allowed_starts(session, day_windows, minimum_break_minutes, epoch)
            if not starts:
                continue
            selected = model.new_bool_var(
                f"selected_{session.item.id}_{session.index}_{day.isoformat()}"
            )
            start = model.new_int_var_from_domain(
                cp_model.Domain.from_values(starts),
                f"start_{session.item.id}_{session.index}_{day.isoformat()}",
            )
            interval = model.new_optional_fixed_size_interval_var(
                start,
                math.ceil((session.duration_minutes + minimum_break_minutes) / MINUTE_UNIT),
                selected,
                f"interval_{session.item.id}_{session.index}_{day.isoformat()}",
            )
            alternative = _Alternative(session, day, start, selected, interval, energy)
            alternatives.append(alternative)
            alternatives_by_session[key].append(alternative)
            intervals.append(interval)
            day_selected[day].append((selected, session.duration_minutes))
        model.add(sum(alt.selected for alt in alternatives_by_session[key]) == presence)

    model.add_no_overlap(intervals)
    for day, daily_choices in day_selected.items():
        model.add(
            sum(choice * duration for choice, duration in daily_choices)
            <= capacity_by_day.get(day, 0)
        )
        if policy is not None and policy.max_blocks_per_day is not None:
            model.add(
                sum(choice for choice, _duration in daily_choices) <= policy.max_blocks_per_day
            )
    for item in items:
        item_sessions = [session for session in sessions if session.item.id == item.id]
        for previous, current in zip(item_sessions, item_sessions[1:], strict=False):
            model.add(
                presence_by_session[(previous.item.id, previous.index)]
                >= presence_by_session[(current.item.id, current.index)]
            )

    _add_baseline_hints(model, baseline, alternatives, presence_by_session, epoch)
    academic_minutes = sum(
        presence_by_session[(session.item.id, session.index)] * session.duration_minutes
        for session in sessions
        if session.item.kind == "task"
    )
    academic_importance = sum(
        presence_by_session[(session.item.id, session.index)]
        * session.duration_minutes
        * max(session.item.importance_rank, 0)
        for session in sessions
        if session.item.kind == "task"
    )
    maximum_importance = sum(
        item.target_minutes * max(item.importance_rank, 0) for item in items if item.kind == "task"
    )
    coverage_base = maximum_importance + 1
    model.maximize(academic_minutes * coverage_base + academic_importance)
    first_solver = _solver(max(time_limit_seconds * 0.6, 0.05))
    first_status = first_solver.solve(model)
    if first_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    best_academic = first_solver.value(academic_minutes)
    best_importance = first_solver.value(academic_importance)
    model.add(academic_minutes == best_academic)
    model.add(academic_importance == best_importance)

    flexible_minutes = sum(
        presence_by_session[(session.item.id, session.index)] * session.duration_minutes
        for session in sessions
        if session.item.kind != "task"
    )
    fairness_terms: list[cp_model.LinearExpr] = []
    for priority in sorted(
        {item.priority_rank for item in items if item.kind != "task"}, reverse=True
    ):
        band_items = [
            item for item in items if item.kind != "task" and item.priority_rank == priority
        ]
        minimum_satisfaction = model.new_int_var(0, 1000, f"fairness_{priority}")
        for item in band_items:
            item_minutes = sum(
                presence_by_session[(session.item.id, session.index)] * session.duration_minutes
                for session in sessions
                if session.item.id == item.id
            )
            model.add(item_minutes * 1000 >= minimum_satisfaction * item.target_minutes)
        fairness_terms.append(minimum_satisfaction * (priority + 1))

    timing_terms: list[cp_model.LinearExpr] = []
    latest_tick = max(_ticks_from(epoch, window.end_at) for window in windows)
    for index, alternative in enumerate(alternatives):
        effective_start = model.new_int_var(0, latest_tick, f"effective_{index}")
        model.add_multiplication_equality(
            effective_start, [alternative.start, alternative.selected]
        )
        energy_bonus = (
            30
            if _energy_matches(alternative.session.item.intensity, alternative.energy_level)
            else 0
        )
        timing_terms.append(alternative.selected * (latest_tick + energy_bonus) - effective_start)
    model.maximize(flexible_minutes * 100_000 + sum(fairness_terms) * 10_000 + sum(timing_terms))
    second_solver = _solver(max(time_limit_seconds * 0.4, 0.05))
    second_status = second_solver.solve(model)
    if second_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        active_solver = second_solver
        active_status = second_status
    else:
        active_solver = first_solver
        active_status = first_status
    placements: list[Placement] = []
    scheduled = {item.id: 0 for item in items}
    for alternative in alternatives:
        if not active_solver.boolean_value(alternative.selected):
            continue
        start_at = epoch + timedelta(minutes=active_solver.value(alternative.start) * MINUTE_UNIT)
        scheduled[alternative.session.item.id] += alternative.session.duration_minutes
        placements.append(_placement(alternative.session, start_at, alternative.energy_level))
    placements.sort(key=lambda placement: (placement.start_at, placement.item_id))
    baseline_academic = sum(
        baseline.scheduled_minutes[item.id] for item in items if item.kind == "task"
    )
    optimized_academic = sum(scheduled[item.id] for item in items if item.kind == "task")
    if optimized_academic < baseline_academic:
        return None
    complete = all(scheduled[item.id] == item.target_minutes for item in items)
    timed_out = active_status != cp_model.OPTIMAL or second_status not in (
        cp_model.OPTIMAL,
        cp_model.FEASIBLE,
    )
    return SchedulingResult(
        "optimal" if complete and not timed_out else "feasible",
        placements,
        scheduled,
        timed_out,
    )


def _allowed_starts(
    session: _Session,
    windows: list[SchedulingWindow],
    minimum_break_minutes: int,
    epoch: datetime,
) -> tuple[list[int], str]:
    starts: list[int] = []
    energy = "medium"
    occupied = session.duration_minutes + minimum_break_minutes
    for window in sorted(windows, key=lambda value: value.start_at):
        earliest = max(
            window.start_at,
            session.item.earliest_start_at or window.start_at,
        )
        cursor = _round_up(earliest)
        latest_end = min(
            window.end_at,
            session.item.latest_end_at or window.end_at,
        )
        while cursor + timedelta(minutes=occupied) <= latest_end:
            starts.append(_ticks_from(epoch, cursor))
            cursor += timedelta(minutes=START_GRID_MINUTES)
        if starts and _energy_matches(session.item.intensity, window.energy_level):
            energy = window.energy_level
    return sorted(set(starts)), energy


def _add_baseline_hints(
    model: cp_model.CpModel,
    baseline: SchedulingResult,
    alternatives: list[_Alternative],
    presence_by_session: dict[tuple[str, int], cp_model.IntVar],
    epoch: datetime,
) -> None:
    placements_by_item: dict[str, list[Placement]] = defaultdict(list)
    for baseline_placement in baseline.placements:
        placements_by_item[baseline_placement.item_id].append(baseline_placement)
    for placements in placements_by_item.values():
        placements.sort(key=lambda value: value.start_at)
    for alternative in alternatives:
        key = (alternative.session.item.id, alternative.session.index)
        placements = placements_by_item[alternative.session.item.id]
        placement_hint: Placement | None = (
            placements[alternative.session.index]
            if alternative.session.index < len(placements)
            else None
        )
        hinted_selection = (
            placement_hint is not None and placement_hint.start_at.date() == alternative.day
        )
        model.add_hint(alternative.selected, int(hinted_selection))
        if hinted_selection and placement_hint is not None:
            model.add_hint(alternative.start, _ticks_from(epoch, placement_hint.start_at))
    for key, presence in presence_by_session.items():
        model.add_hint(presence, int(key[1] < len(placements_by_item[key[0]])))


def _session_plan(item: SchedulingItem) -> list[int]:
    target_units = max(item.target_minutes // MINUTE_UNIT, 0)
    if not target_units:
        return []
    minimum_units = max(math.ceil(item.minimum_session_minutes / MINUTE_UNIT), 1)
    maximum_units = max(item.maximum_session_minutes // MINUTE_UNIT, minimum_units)
    preferred_units = min(
        max(round(item.preferred_session_minutes / MINUTE_UNIT), minimum_units),
        maximum_units,
    )
    minimum_sessions = max(math.ceil(target_units / maximum_units), 1)
    maximum_sessions = max(target_units // minimum_units, minimum_sessions)
    session_count = min(
        max(math.ceil(target_units / preferred_units), minimum_sessions), maximum_sessions
    )
    base, remainder = divmod(target_units, session_count)
    durations = [base + (1 if index < remainder else 0) for index in range(session_count)]
    return sorted((duration * MINUTE_UNIT for duration in durations), reverse=True)


def _capacity_by_day(windows: list[SchedulingWindow]) -> dict[date, int]:
    raw: dict[date, int] = defaultdict(int)
    explicit: dict[date, int] = {}
    for window in windows:
        day = window.start_at.date()
        raw[day] += round((window.end_at - window.start_at).total_seconds() / 60)
        if window.daily_capacity_minutes is not None:
            explicit[day] = window.daily_capacity_minutes
    return {day: explicit.get(day, minutes) for day, minutes in raw.items()}


def _protected_free_minutes(windows: list[SchedulingWindow]) -> int:
    grouped: dict[date, list[SchedulingWindow]] = defaultdict(list)
    for window in windows:
        grouped[window.start_at.date()].append(window)
    return sum(
        max(window.protected_free_minutes for window in day_windows)
        for day_windows in grouped.values()
    )


def _placement(session: _Session, start_at: datetime, energy_level: str) -> Placement:
    item = session.item
    return Placement(
        item_id=item.id,
        title=item.title,
        start_at=start_at,
        end_at=start_at + timedelta(minutes=session.duration_minutes),
        kind=item.kind,
        reason_code=(
            "flexible_commitment_target"
            if item.kind == "flexible_commitment"
            else "goal_maintenance"
            if item.kind == "goal"
            else "dated_work"
        ),
        reason_details={
            "energy_level": energy_level,
            "priority_rank": item.priority_rank,
            "importance_rank": item.importance_rank,
            "session_minutes": session.duration_minutes,
            **({"due_at": item.due_at.isoformat()} if item.due_at else {}),
            **({"eligible_date": start_at.date().isoformat()} if item.eligible_dates else {}),
        },
    )


def _solver(time_limit_seconds: float) -> cp_model.CpSolver:
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_seconds
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 27
    return solver


def _energy_matches(intensity: str, energy_level: str) -> bool:
    if intensity == "deep":
        return energy_level == "high"
    if intensity in {"light", "administrative", "passive"}:
        return energy_level == "low"
    return energy_level == "medium"


def _preferred_time_penalty(start_at: datetime, policy: SchedulingPolicy | None) -> int:
    if policy is None or not policy.preferred_time_ranges:
        return 0
    local_time = start_at.timetz().replace(tzinfo=None)
    for weekday, start, end in policy.preferred_time_ranges:
        if weekday is not None and weekday != start_at.weekday():
            continue
        if start <= local_time < end:
            return 0
    return 1


def _ticks_from(epoch: datetime, value: datetime) -> int:
    minutes = round((value.astimezone(UTC) - epoch.astimezone(UTC)).total_seconds() / 60)
    return minutes // MINUTE_UNIT


def _round_up(value: datetime) -> datetime:
    result = value.replace(second=0, microsecond=0)
    remainder = (result.hour * 60 + result.minute) % START_GRID_MINUTES
    if remainder:
        result += timedelta(minutes=START_GRID_MINUTES - remainder)
    if value.second or value.microsecond:
        result += timedelta(minutes=START_GRID_MINUTES)
    return result
