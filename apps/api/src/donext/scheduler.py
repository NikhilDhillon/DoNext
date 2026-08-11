from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from ortools.sat.python import cp_model

GRID_MINUTES = 5


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


@dataclass(frozen=True)
class SchedulingWindow:
    start_at: datetime
    end_at: datetime
    energy_level: str = "medium"


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


@dataclass(frozen=True)
class _Candidate:
    item: SchedulingItem
    start_at: datetime
    duration_minutes: int
    energy_level: str


def solve_schedule(
    items: list[SchedulingItem],
    windows: list[SchedulingWindow],
    minimum_break_minutes: int,
    time_limit_seconds: float = 5.0,
) -> SchedulingResult:
    candidates = _candidates(items, windows)
    if not candidates:
        return SchedulingResult("optimal", [], {item.id: 0 for item in items}, False)

    epoch = min(window.start_at for window in windows).astimezone(UTC)
    model = cp_model.CpModel()
    selected: list[cp_model.IntVar] = []
    intervals: list[cp_model.IntervalVar] = []
    for index, candidate in enumerate(candidates):
        chosen = model.new_bool_var(f"candidate_{index}")
        start = _minutes_from(epoch, candidate.start_at)
        occupied = candidate.duration_minutes + minimum_break_minutes
        selected.append(chosen)
        intervals.append(
            model.new_optional_fixed_size_interval_var(start, occupied, chosen, f"block_{index}")
        )
    model.add_no_overlap(intervals)

    item_candidates: dict[str, list[int]] = {item.id: [] for item in items}
    for index, candidate in enumerate(candidates):
        item_candidates[candidate.item.id].append(index)
    for item in items:
        model.add(
            sum(
                selected[index] * candidates[index].duration_minutes
                for index in item_candidates[item.id]
            )
            <= item.target_minutes
        )

    required_minutes = cp_model.LinearExpr.sum(
        [
            selected[index] * candidate.duration_minutes
            for index, candidate in enumerate(candidates)
            if candidate.item.kind == "task"
        ]
    )
    model.maximize(required_minutes)
    solver = _solver(time_limit_seconds)
    first_status = solver.solve(model)
    if first_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SchedulingResult("infeasible", [], {item.id: 0 for item in items}, False)
    best_required = round(solver.objective_value)
    model.add(required_minutes == best_required)

    preference = cp_model.LinearExpr.sum(
        [
            selected[index] * _candidate_preference(candidate)
            for index, candidate in enumerate(candidates)
        ]
    )
    model.maximize(preference)
    solver = _solver(time_limit_seconds)
    final_status = solver.solve(model)
    if final_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SchedulingResult("infeasible", [], {item.id: 0 for item in items}, False)

    placements: list[Placement] = []
    scheduled = {item.id: 0 for item in items}
    for index, candidate in enumerate(candidates):
        if not solver.boolean_value(selected[index]):
            continue
        scheduled[candidate.item.id] += candidate.duration_minutes
        placements.append(
            Placement(
                item_id=candidate.item.id,
                title=candidate.item.title,
                start_at=candidate.start_at,
                end_at=candidate.start_at + timedelta(minutes=candidate.duration_minutes),
                kind=candidate.item.kind,
                reason_code=("goal_maintenance" if candidate.item.kind == "goal" else "dated_work"),
                reason_details={
                    "energy_level": candidate.energy_level,
                    "priority_rank": candidate.item.priority_rank,
                    "session_minutes": candidate.duration_minutes,
                },
            )
        )
    placements.sort(key=lambda placement: (placement.start_at, placement.item_id))
    timed_out = final_status == cp_model.FEASIBLE
    return SchedulingResult(
        "feasible" if timed_out else "optimal", placements, scheduled, timed_out
    )


def _solver(time_limit_seconds: float) -> cp_model.CpSolver:
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_seconds
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 27
    return solver


def _candidates(items: list[SchedulingItem], windows: list[SchedulingWindow]) -> list[_Candidate]:
    candidates: list[_Candidate] = []
    for item in sorted(items, key=lambda value: (-value.priority_rank, value.id)):
        durations = _session_durations(item)
        for window in sorted(windows, key=lambda value: value.start_at):
            for duration in durations:
                latest = window.end_at - timedelta(minutes=duration)
                cursor = _round_up(window.start_at)
                while cursor <= latest:
                    candidates.append(_Candidate(item, cursor, duration, window.energy_level))
                    cursor += timedelta(minutes=GRID_MINUTES)
    return candidates


def _session_durations(item: SchedulingItem) -> list[int]:
    upper = min(item.maximum_session_minutes, item.target_minutes)
    lower = min(item.minimum_session_minutes, upper)
    preferred = min(max(item.preferred_session_minutes, lower), upper)
    values = {
        lower,
        preferred,
        upper,
        item.target_minutes,
        item.target_minutes - upper,
        item.target_minutes % preferred,
    }
    return sorted({value for value in values if lower <= value <= upper}, reverse=True)


def _candidate_preference(candidate: _Candidate) -> int:
    duration_fit = 1000 - abs(candidate.duration_minutes - candidate.item.preferred_session_minutes)
    energy_fit = 100 if _energy_matches(candidate.item.intensity, candidate.energy_level) else 0
    kind_rank = 1000 if candidate.item.kind == "task" else 100
    return -10000 + kind_rank + candidate.item.priority_rank * 100 + duration_fit + energy_fit


def _energy_matches(intensity: str, energy_level: str) -> bool:
    if intensity == "deep":
        return energy_level == "high"
    if intensity in {"light", "administrative", "passive"}:
        return energy_level == "low"
    return energy_level == "medium"


def _minutes_from(epoch: datetime, value: datetime) -> int:
    return round((value.astimezone(UTC) - epoch).total_seconds() / 60)


def _round_up(value: datetime) -> datetime:
    remainder = value.minute % GRID_MINUTES
    if not remainder and not value.second and not value.microsecond:
        return value
    rounded = value.replace(second=0, microsecond=0) + timedelta(minutes=GRID_MINUTES - remainder)
    return rounded
