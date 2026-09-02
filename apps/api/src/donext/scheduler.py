from __future__ import annotations

import math
import time
from collections import defaultdict
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta
from datetime import time as clock_time
from functools import cmp_to_key
from typing import Literal

from ortools.sat.python import cp_model

START_GRID_MINUTES = 15
MINUTE_UNIT = 1


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
    required: bool = True
    risk_tier: int = 0
    slack_minutes: int | None = None
    weight_percent: float | None = None
    exam_relationship: str | None = None
    readiness_at: datetime | None = None
    preferred_completion_at: datetime | None = None
    # While urgent same-course assignments are still underway, exam preparation is paced at
    # this cadence instead of being packed. Both fields are unset once preparation intensifies.
    review_cadence_days: int | None = None
    review_phase_end_at: datetime | None = None
    course_id: str | None = None
    material_release_schedule: tuple[tuple[datetime, int], ...] = ()
    material_release_method: str | None = None
    strategic_lead: bool = False


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
    title: str
    remaining_before_minutes: int
    release_at: datetime | None = None


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
    minimize_excess_over: dict[date, int] | None = None,
) -> SchedulingResult:
    started = time.monotonic()
    sessions: list[_Session] = []
    for item in items:
        durations = session_durations(item)
        scheduled_before = 0
        for index, duration in enumerate(durations):
            cumulative = scheduled_before + duration
            release_at = next(
                (
                    available_at
                    for available_at, unlocked in item.material_release_schedule
                    if unlocked >= cumulative
                ),
                None,
            )
            sessions.append(
                _Session(
                    item=item,
                    index=index,
                    duration_minutes=duration,
                    title=item.title,
                    remaining_before_minutes=item.target_minutes - scheduled_before,
                    release_at=release_at,
                )
            )
            scheduled_before = cumulative
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
            minimize_excess_over,
        )
    result = improved or baseline
    placements = attach_displacement(items, result.placements, result.scheduled_minutes)
    return SchedulingResult(
        status=result.status,
        placements=placements,
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
    item_days: dict[str, set[date]] = defaultdict(set)
    item_ready_at: dict[str, datetime] = {}
    scheduled = {item.id: 0 for item in items}
    placements: list[Placement] = []
    sessions_by_item: dict[str, list[_Session]] = defaultdict(list)
    for session in sessions:
        sessions_by_item[session.item.id].append(session)

    tasks = sorted(
        (item for item in items if item.kind in {"task", "exam_prep"}),
        key=cmp_to_key(_compare_academic),
    )
    ordered: list[_Session] = []
    exam_groups_added: set[tuple[bool, int]] = set()
    for item in tasks:
        if item.kind != "exam_prep":
            ordered.extend(sessions_by_item[item.id])
            continue
        group = (item.required, item.risk_tier)
        if group in exam_groups_added:
            continue
        exam_groups_added.add(group)
        exam_items = [
            candidate
            for candidate in tasks
            if candidate.kind == "exam_prep" and (candidate.required, candidate.risk_tier) == group
        ]
        cursor = 0
        while any(cursor < len(sessions_by_item[candidate.id]) for candidate in exam_items):
            for candidate in exam_items:
                if cursor < len(sessions_by_item[candidate.id]):
                    ordered.append(sessions_by_item[candidate.id][cursor])
            cursor += 1
    flexible = [item for item in items if item.kind in {"goal", "flexible_commitment"}]
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
    distant = sorted(
        (item for item in items if item.kind == "distant_task"),
        key=lambda item: (
            item.due_at or datetime.max.replace(tzinfo=UTC),
            item.weight_percent is None,
            -(item.weight_percent or 0),
            item.id,
        ),
    )
    for item in distant:
        ordered.extend(sessions_by_item[item.id])

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
            item_ready_at.get(session.item.id),
            item_days[session.item.id],
        )
        if choice is None:
            continue
        segment_index, start_at = choice
        energy_level = free[segment_index].energy_level
        occupied_end = start_at + timedelta(
            minutes=session.duration_minutes + minimum_break_minutes
        )
        # The required break separates this session from every other generated session, so the
        # gap is reserved across all remaining openings rather than only inside the one being
        # split. Two openings can meet exactly - availability that runs to midnight, or a fixed
        # commitment shorter than the break - and trimming only the chosen segment would leave
        # the next session free to start with no gap at all.
        reserved_start = start_at - timedelta(minutes=minimum_break_minutes)
        remaining_free: list[_FreeSegment] = []
        for segment in free:
            if segment.end_at <= reserved_start or segment.start_at >= occupied_end:
                remaining_free.append(segment)
                continue
            if segment.start_at < reserved_start:
                remaining_free.append(
                    _FreeSegment(segment.start_at, reserved_start, segment.energy_level)
                )
            if occupied_end < segment.end_at:
                remaining_free.append(
                    _FreeSegment(
                        max(occupied_end, segment.start_at), segment.end_at, segment.energy_level
                    )
                )
        free = remaining_free
        free.sort(key=lambda value: value.start_at)
        used_by_day[start_at.date()] += session.duration_minutes
        blocks_by_day[start_at.date()] += 1
        item_dates[(session.item.id, start_at.date())] += 1
        item_days[session.item.id].add(start_at.date())
        scheduled[session.item.id] += session.duration_minutes
        item_ready_at[session.item.id] = occupied_end
        placements.append(_placement(session, start_at, energy_level))

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
    item_ready_at: datetime | None,
    placed_days: set[date],
) -> tuple[int, datetime] | None:
    choices: list[tuple[tuple[object, ...], int, datetime]] = []
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
            session.release_at or segment.start_at,
            item_ready_at or segment.start_at,
        )
        start_at = _round_up(earliest)
        latest_end = min(
            segment.end_at,
            session.item.latest_end_at or segment.end_at,
        )
        if start_at + timedelta(minutes=session.duration_minutes) > latest_end:
            continue
        score: tuple[object, ...]
        if session.item.kind == "exam_prep":
            score = (
                _review_spacing_penalty(session.item, day, placed_days),
                item_dates[(session.item.id, day)],
                _preferred_time_penalty(start_at, policy),
                start_at,
                0 if _energy_matches(session.item.intensity, segment.energy_level) else 1,
            )
        elif session.item.kind in {"task", "distant_task"}:
            score = (
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


def _in_review_phase(item: SchedulingItem, day: date) -> bool:
    return item.review_phase_end_at is not None and day <= item.review_phase_end_at.date()


# Early review is a soft preference for one block roughly every `review_cadence_days`. Days
# closer than that are ranked last rather than forbidden, so a block still lands when the
# spaced-out days have no opening.
def _review_spacing_penalty(item: SchedulingItem, day: date, placed_days: set[date]) -> int:
    cadence = item.review_cadence_days
    if not cadence or not placed_days or not _in_review_phase(item, day):
        return 0
    nearest = min(abs((day - placed).days) for placed in placed_days)
    return 1 if nearest < cadence else 0


def _compare_academic(left: SchedulingItem, right: SchedulingItem) -> int:
    if left.required != right.required:
        return -1 if left.required else 1
    if left.risk_tier != right.risk_tier:
        return -1 if left.risk_tier > right.risk_tier else 1
    left_due = left.due_at or datetime.max.replace(tzinfo=UTC)
    right_due = right.due_at or datetime.max.replace(tzinfo=UTC)
    if left.risk_tier >= 5:
        if (
            left.weight_percent is not None
            and right.weight_percent is not None
            and left.weight_percent != right.weight_percent
        ):
            return -1 if left.weight_percent > right.weight_percent else 1
        if left_due != right_due:
            return -1 if left_due < right_due else 1
    else:
        left_slack = left.slack_minutes if left.slack_minutes is not None else 10**9
        right_slack = right.slack_minutes if right.slack_minutes is not None else 10**9
        if left_slack != right_slack:
            return -1 if left_slack < right_slack else 1
        if left_due.date() != right_due.date():
            return -1 if left_due.date() < right_due.date() else 1
        if (
            left.weight_percent is not None
            and right.weight_percent is not None
            and left.weight_percent != right.weight_percent
        ):
            return -1 if left.weight_percent > right.weight_percent else 1
        if left_due != right_due:
            return -1 if left_due < right_due else 1
    if left.target_minutes != right.target_minutes:
        return -1 if left.target_minutes > right.target_minutes else 1
    return (left.id > right.id) - (left.id < right.id)


def _optimize_sessions(
    items: list[SchedulingItem],
    sessions: list[_Session],
    windows: list[SchedulingWindow],
    capacity_by_day: dict[date, int],
    minimum_break_minutes: int,
    baseline: SchedulingResult,
    time_limit_seconds: float,
    policy: SchedulingPolicy | None,
    minimize_excess_over: dict[date, int] | None,
) -> SchedulingResult | None:
    if not sessions or not windows:
        return baseline
    epoch = (
        min(window.start_at for window in windows)
        .astimezone(UTC)
        .replace(hour=0, minute=0, second=0, microsecond=0)
    )
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
            sorted_windows = sorted(day_windows, key=lambda value: value.start_at)
            for window_index, window in enumerate(sorted_windows):
                starts, energy = _allowed_starts(session, [window], minimum_break_minutes, epoch)
                if not starts:
                    continue
                selected = model.new_bool_var(
                    f"selected_{session.item.id}_{session.index}_{day.isoformat()}_{window_index}"
                )
                start = model.new_int_var_from_domain(
                    cp_model.Domain.from_values(starts),
                    f"start_{session.item.id}_{session.index}_{day.isoformat()}_{window_index}",
                )
                interval = model.new_optional_fixed_size_interval_var(
                    start,
                    session.duration_minutes + minimum_break_minutes,
                    selected,
                    f"interval_{session.item.id}_{session.index}_{day.isoformat()}_{window_index}",
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
            for previous_alternative in alternatives_by_session[(previous.item.id, previous.index)]:
                for current_alternative in alternatives_by_session[
                    (current.item.id, current.index)
                ]:
                    model.add(
                        previous_alternative.start < current_alternative.start
                    ).only_enforce_if([previous_alternative.selected, current_alternative.selected])

    _add_baseline_hints(model, baseline, alternatives, presence_by_session, epoch)
    required_academic_minutes = sum(
        presence_by_session[(session.item.id, session.index)] * session.duration_minutes
        for session in sessions
        if session.item.required and session.item.kind in {"task", "exam_prep"}
    )
    academic_minutes = sum(
        presence_by_session[(session.item.id, session.index)] * session.duration_minutes
        for session in sessions
        if session.item.kind in {"task", "exam_prep"}
    )
    ordered_academics = sorted(
        (item for item in items if item.kind in {"task", "exam_prep"}),
        key=cmp_to_key(_compare_academic),
    )
    allocation_rank = {
        item.id: len(ordered_academics) - index for index, item in enumerate(ordered_academics)
    }
    academic_importance = sum(
        presence_by_session[(session.item.id, session.index)]
        * session.duration_minutes
        * allocation_rank[session.item.id]
        for session in sessions
        if session.item.kind in {"task", "exam_prep"}
    )
    maximum_importance = sum(
        item.target_minutes * allocation_rank[item.id] for item in ordered_academics
    )
    coverage_base = maximum_importance + 1
    model.maximize(required_academic_minutes)
    required_solver = _solver(max(time_limit_seconds * 0.2, 0.05))
    required_status = required_solver.solve(model)
    if required_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    model.add(required_academic_minutes == required_solver.value(required_academic_minutes))

    overdue_terms = [
        presence_by_session[(session.item.id, session.index)] * session.duration_minutes
        for session in sessions
        if session.item.risk_tier >= 5 and session.item.kind in {"task", "exam_prep"}
    ]
    if overdue_terms:
        overdue_minutes = sum(overdue_terms)
        model.maximize(overdue_minutes)
        overdue_solver = _solver(max(time_limit_seconds * 0.08, 0.05))
        overdue_status = overdue_solver.solve(model)
        if overdue_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        model.add(overdue_minutes == overdue_solver.value(overdue_minutes))

    urgent_terms = [
        presence_by_session[(session.item.id, session.index)] * session.duration_minutes
        for session in sessions
        if session.item.risk_tier == 4 and session.item.kind in {"task", "exam_prep"}
    ]
    if urgent_terms:
        urgent_minutes = sum(urgent_terms)
        model.maximize(urgent_minutes)
        urgent_solver = _solver(max(time_limit_seconds * 0.08, 0.05))
        urgent_status = urgent_solver.solve(model)
        if urgent_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        model.add(urgent_minutes == urgent_solver.value(urgent_minutes))

    pre_exam_assignment_terms = [
        presence_by_session[(session.item.id, session.index)] * session.duration_minutes
        for session in sessions
        if session.item.required
        and session.item.kind == "task"
        and session.item.exam_relationship == "same_course_pre_exam"
    ]
    if pre_exam_assignment_terms:
        pre_exam_assignment_minutes = sum(pre_exam_assignment_terms)
        model.maximize(pre_exam_assignment_minutes)
        pre_exam_solver = _solver(max(time_limit_seconds * 0.08, 0.05))
        pre_exam_status = pre_exam_solver.solve(model)
        if pre_exam_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        model.add(pre_exam_assignment_minutes == pre_exam_solver.value(pre_exam_assignment_minutes))

    exam_groups: dict[tuple[bool, int], list[SchedulingItem]] = defaultdict(list)
    for item in items:
        if item.kind == "exam_prep":
            exam_groups[(item.required, item.risk_tier)].append(item)
    for group_index, (_band, exam_items) in enumerate(
        sorted(exam_groups.items(), key=lambda entry: entry[0], reverse=True)
    ):
        if len(exam_items) < 2:
            continue
        minimum_exam_completion = model.new_int_var(
            0, 1000, f"minimum_exam_completion_{group_index}"
        )
        for item in exam_items:
            item_minutes = sum(
                presence_by_session[(session.item.id, session.index)] * session.duration_minutes
                for session in sessions
                if session.item.id == item.id
            )
            model.add(item_minutes * 1000 >= minimum_exam_completion * item.target_minutes)
        model.maximize(minimum_exam_completion)
        exam_fairness_solver = _solver(max(time_limit_seconds * 0.1, 0.05))
        exam_fairness_status = exam_fairness_solver.solve(model)
        if exam_fairness_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        model.add(minimum_exam_completion == exam_fairness_solver.value(minimum_exam_completion))

    model.maximize(academic_minutes * coverage_base + academic_importance)
    first_solver = _solver(max(time_limit_seconds * 0.2, 0.05))
    first_status = first_solver.solve(model)
    if first_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None
    best_academic = first_solver.value(academic_minutes)
    best_importance = first_solver.value(academic_importance)
    model.add(academic_minutes == best_academic)
    model.add(academic_importance == best_importance)

    late_preferred_terms: list[cp_model.LinearExpr] = []
    for index, alternative in enumerate(alternatives):
        preferred = alternative.session.item.preferred_completion_at
        if preferred is None or alternative.session.item.kind != "task":
            continue
        cutoff = _ticks_from(epoch, preferred) - alternative.session.duration_minutes
        late = model.new_bool_var(f"late_preferred_{index}")
        model.add(late <= alternative.selected)
        model.add(alternative.start <= cutoff).only_enforce_if(
            [alternative.selected, late.negated()]
        )
        model.add(alternative.start > cutoff).only_enforce_if([alternative.selected, late])
        late_preferred_terms.append(late * alternative.session.duration_minutes)
    if late_preferred_terms:
        late_preferred_minutes = sum(late_preferred_terms)
        model.minimize(late_preferred_minutes)
        preferred_solver = _solver(max(time_limit_seconds * 0.08, 0.05))
        preferred_status = preferred_solver.solve(model)
        if preferred_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        model.add(late_preferred_minutes == preferred_solver.value(late_preferred_minutes))

    if minimize_excess_over is not None and day_selected:
        excess_by_day: dict[date, cp_model.IntVar] = {}
        for day in sorted(day_selected):
            maximum = capacity_by_day.get(day, 0)
            excess = model.new_int_var(0, maximum, f"extra_focus_{day.isoformat()}")
            used = sum(choice * duration for choice, duration in day_selected[day])
            model.add(excess >= used - minimize_excess_over.get(day, 0))
            excess_by_day[day] = excess
        total_excess = sum(excess_by_day.values())
        model.minimize(total_excess)
        total_excess_solver = _solver(max(time_limit_seconds * 0.08, 0.05))
        total_excess_status = total_excess_solver.solve(model)
        if total_excess_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        model.add(total_excess == total_excess_solver.value(total_excess))

        peak_excess = model.new_int_var(
            0, max(capacity_by_day.values(), default=0), "peak_extra_focus"
        )
        model.add_max_equality(peak_excess, list(excess_by_day.values()))
        model.minimize(peak_excess)
        peak_solver = _solver(max(time_limit_seconds * 0.06, 0.05))
        peak_status = peak_solver.solve(model)
        if peak_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        model.add(peak_excess == peak_solver.value(peak_excess))

        for day in sorted(excess_by_day):
            day_excess = excess_by_day[day]
            model.minimize(day_excess)
            day_solver = _solver(max(time_limit_seconds * 0.025, 0.03))
            day_status = day_solver.solve(model)
            if day_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                return None
            model.add(day_excess == day_solver.value(day_excess))

    exam_day_active: dict[tuple[str, date], cp_model.IntVar] = {}
    for item in items:
        if item.kind != "exam_prep":
            continue
        for day in sorted(windows_by_day):
            selections = [
                alternative.selected
                for alternative in alternatives
                if alternative.session.item.id == item.id and alternative.day == day
            ]
            if not selections:
                continue
            active = model.new_bool_var(f"exam_day_{item.id}_{day.isoformat()}")
            model.add_max_equality(active, selections)
            exam_day_active[(item.id, day)] = active

    # Early review cadence: while urgent same-course assignments are still underway, every run
    # of `review_cadence_days` consecutive usable days should contain at least one preparation
    # block. Maximizing covered runs both spaces the early blocks out and, once preparation
    # intensifies, leaves no excessive gap. It is a soft stage, so urgent assignment work that
    # consumes the day's safe capacity simply leaves a run uncovered.
    cadence_terms: list[cp_model.IntVar] = []
    for item in items:
        cadence = item.review_cadence_days
        if item.kind != "exam_prep" or not cadence:
            continue
        review_days = [
            day
            for day in sorted(windows_by_day)
            if (item.id, day) in exam_day_active and _in_review_phase(item, day)
        ]
        for index in range(len(review_days) - cadence + 1):
            covered = model.new_bool_var(f"review_run_{item.id}_{index}")
            model.add_max_equality(
                covered,
                [exam_day_active[(item.id, day)] for day in review_days[index : index + cadence]],
            )
            cadence_terms.append(covered)
    if cadence_terms:
        review_coverage = sum(cadence_terms)
        model.maximize(review_coverage)
        cadence_solver = _solver(max(time_limit_seconds * 0.08, 0.05))
        cadence_status = cadence_solver.solve(model)
        if cadence_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        model.add(review_coverage == cadence_solver.value(review_coverage))

    # With the cadence presence fixed, keep the early phase light: total academic minutes are
    # already locked, so minimizing the minutes that land inside the review phase moves the
    # bulk of preparation past the urgent assignments, which is where the remaining estimate
    # should drive more frequent blocks.
    early_review_terms = [
        alternative.selected * alternative.session.duration_minutes
        for alternative in alternatives
        if alternative.session.item.kind == "exam_prep"
        and alternative.session.item.review_cadence_days
        and _in_review_phase(alternative.session.item, alternative.day)
    ]
    if early_review_terms:
        early_review_minutes = sum(early_review_terms)
        model.minimize(early_review_minutes)
        early_review_solver = _solver(max(time_limit_seconds * 0.06, 0.05))
        early_review_status = early_review_solver.solve(model)
        if early_review_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        model.add(early_review_minutes == early_review_solver.value(early_review_minutes))

    if exam_day_active:
        exam_momentum = sum(exam_day_active.values())
        model.maximize(exam_momentum)
        momentum_solver = _solver(max(time_limit_seconds * 0.15, 0.05))
        momentum_status = momentum_solver.solve(model)
        if momentum_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        model.add(exam_momentum == momentum_solver.value(exam_momentum))

    academic_energy_mismatches = [
        alternative.selected
        for alternative in alternatives
        if alternative.session.item.kind in {"task", "exam_prep", "distant_task"}
        and not _energy_matches(alternative.session.item.intensity, alternative.energy_level)
    ]
    if academic_energy_mismatches:
        mismatch_total = sum(academic_energy_mismatches)
        model.minimize(mismatch_total)
        energy_solver = _solver(max(time_limit_seconds * 0.08, 0.05))
        energy_status = energy_solver.solve(model)
        if energy_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        model.add(mismatch_total == energy_solver.value(mismatch_total))

    latest_tick = max(_ticks_from(epoch, window.end_at) for window in windows)
    academic_start_terms: list[cp_model.IntVar] = []
    for index, alternative in enumerate(alternatives):
        if alternative.session.item.kind not in {"task", "exam_prep"}:
            continue
        effective_start = model.new_int_var(0, latest_tick, f"academic_start_{index}")
        model.add_multiplication_equality(
            effective_start, [alternative.start, alternative.selected]
        )
        academic_start_terms.append(effective_start)
    if academic_start_terms:
        academic_start_total = sum(academic_start_terms)
        model.minimize(academic_start_total)
        timing_solver = _solver(max(time_limit_seconds * 0.15, 0.05))
        timing_status = timing_solver.solve(model)
        if timing_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None
        model.add(academic_start_total == timing_solver.value(academic_start_total))

    flexible_minutes = sum(
        presence_by_session[(session.item.id, session.index)] * session.duration_minutes
        for session in sessions
        if session.item.kind in {"goal", "flexible_commitment"}
    )
    distant_minutes = sum(
        presence_by_session[(session.item.id, session.index)] * session.duration_minutes
        for session in sessions
        if session.item.kind == "distant_task"
    )
    fairness_terms: list[cp_model.LinearExpr] = []
    for priority in sorted(
        {item.priority_rank for item in items if item.kind in {"goal", "flexible_commitment"}},
        reverse=True,
    ):
        band_items = [
            item
            for item in items
            if item.kind in {"goal", "flexible_commitment"} and item.priority_rank == priority
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
    model.maximize(
        flexible_minutes * 100_000_000
        + sum(fairness_terms) * 10_000_000
        + distant_minutes * 100_000
        + sum(timing_terms)
    )
    second_solver = _solver(max(time_limit_seconds * 0.2, 0.05))
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
        baseline.scheduled_minutes[item.id] for item in items if item.kind in {"task", "exam_prep"}
    )
    optimized_academic = sum(
        scheduled[item.id] for item in items if item.kind in {"task", "exam_prep"}
    )
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
    for window in sorted(windows, key=lambda value: value.start_at):
        earliest = max(
            window.start_at,
            session.item.earliest_start_at or window.start_at,
            session.release_at or window.start_at,
        )
        cursor = _round_up(earliest)
        latest_end = min(
            window.end_at,
            session.item.latest_end_at or window.end_at,
        )
        window_starts: list[int] = []
        while cursor + timedelta(minutes=session.duration_minutes) <= latest_end:
            window_starts.append(_ticks_from(epoch, cursor))
            cursor += timedelta(minutes=START_GRID_MINUTES)
        if window_starts:
            starts.extend(window_starts)
            # Report the energy the student actually saved for this opening. Reporting a match
            # instead would make the mismatch objective blind to ordinary work and would let a
            # block claim an energy fit that was never checked.
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


def session_durations(item: SchedulingItem) -> list[int]:
    target = max(item.target_minutes, 0)
    if not target:
        return []
    minimum = max(item.minimum_session_minutes, 1)
    maximum = max(item.maximum_session_minutes, minimum)
    preferred = min(max(item.preferred_session_minutes, minimum), maximum)

    scheduled = target
    counts: list[int] = []
    while scheduled >= minimum:
        minimum_count = math.ceil(scheduled / maximum)
        maximum_count = scheduled // minimum
        if minimum_count <= maximum_count:
            counts = list(range(minimum_count, maximum_count + 1))
            break
        scheduled -= 1
    if not counts:
        return []
    session_count = min(
        counts,
        key=lambda count: (abs((scheduled / count) - preferred), count),
    )
    base, remainder = divmod(scheduled, session_count)
    return sorted(
        [base + (1 if index < remainder else 0) for index in range(session_count)],
        reverse=True,
    )


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
        title=session.title,
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
            "explanation_version": 1,
            "energy_level": energy_level,
            "chosen_energy_level": energy_level,
            "requested_energy_level": (
                "high"
                if item.intensity == "deep"
                else "low"
                if item.intensity in {"light", "administrative", "passive"}
                else "medium"
            ),
            "energy_matched": _energy_matches(item.intensity, energy_level),
            "priority_rank": item.priority_rank,
            "primary_priority_reason": (
                "overdue"
                if item.risk_tier >= 5
                else "deadline_within_48_hours"
                if item.risk_tier == 4
                else "same_course_pre_exam"
                if item.exam_relationship == "same_course_pre_exam"
                else "semester_pressure_proof"
                if item.strategic_lead
                else "low_slack"
                if item.slack_minutes is not None and item.slack_minutes <= 0
                else "deadline_and_feasibility"
            ),
            "required": item.required,
            "importance_rank": item.importance_rank,
            "risk_tier": item.risk_tier,
            "slack_minutes": item.slack_minutes,
            "weight_percent": item.weight_percent,
            "weight_tie_result": "not_compared",
            "exam_relationship": item.exam_relationship,
            "readiness_at": item.readiness_at.isoformat() if item.readiness_at else None,
            "material_release_at": session.release_at.isoformat() if session.release_at else None,
            "material_release_method": item.material_release_method,
            "preferred_completion_at": (
                item.preferred_completion_at.isoformat() if item.preferred_completion_at else None
            ),
            "session_minutes": session.duration_minutes,
            "remaining_before_minutes": session.remaining_before_minutes,
            "remaining_after_minutes": max(
                session.remaining_before_minutes - session.duration_minutes, 0
            ),
            "strategic_lead": item.strategic_lead,
            **({"due_at": item.due_at.isoformat()} if item.due_at else {}),
            **({"eligible_date": start_at.date().isoformat()} if item.eligible_dates else {}),
        },
    )


def _work_band(item: SchedulingItem) -> int:
    if item.kind in {"goal", "flexible_commitment"}:
        return 0
    if item.kind == "distant_task":
        return 1
    return 2


def _compare_protection(left: SchedulingItem, right: SchedulingItem) -> int:
    """Compare work from most to least protected without manufacturing missing weights."""

    left_band = _work_band(left)
    right_band = _work_band(right)
    if left_band != right_band:
        return -1 if left_band > right_band else 1
    if left_band == 2:
        return _compare_academic(left, right)
    return (left.id > right.id) - (left.id < right.id)


def _weight_tie_result(placed: SchedulingItem, displaced: SchedulingItem) -> str:
    if placed.due_at is None or displaced.due_at is None:
        return "not_compared"
    if placed.due_at.date() != displaced.due_at.date():
        return "not_compared"
    if placed.weight_percent is None or displaced.weight_percent is None:
        return "skipped_unknown_weight"
    if placed.weight_percent == displaced.weight_percent:
        return "equal_known_weight"
    if placed.weight_percent > displaced.weight_percent:
        return "higher_known_weight_preferred"
    return "higher_priority_band_overrode_weight"


def _compare_shortfalls(left: tuple[SchedulingItem, int], right: tuple[SchedulingItem, int]) -> int:
    return _compare_protection(left[0], right[0])


def _could_have_used(item: SchedulingItem, placement: Placement) -> bool:
    if item.eligible_dates is not None and placement.start_at.date() not in item.eligible_dates:
        return False
    if item.earliest_start_at is not None and placement.start_at < item.earliest_start_at:
        return False
    if item.latest_end_at is not None and placement.end_at > item.latest_end_at:
        return False
    missing = item.target_minutes
    valid_session = min(missing, item.maximum_session_minutes)
    if valid_session < item.minimum_session_minutes:
        return False
    available = round((placement.end_at - placement.start_at).total_seconds() / 60)
    return available >= min(valid_session, item.preferred_session_minutes)


_DISPLACEMENT_KEYS = (
    "displaced_item_id",
    "displaced_title",
    "displaced_kind",
    "displaced_shortfall_minutes",
)


def _without_displacement(reason_details: dict[str, object]) -> dict[str, object]:
    cleared = {key: value for key, value in reason_details.items() if key not in _DISPLACEMENT_KEYS}
    cleared["weight_tie_result"] = "not_compared"
    return cleared


# Names the specific alternative that lost capacity because this block was selected: the most
# protected item that still finished short, could have used this exact slot, and ranks below
# the placed work. Blocks that displaced nothing carry no claim.
#
# Safe to re-run against a different item set: any earlier claim is cleared first, so a caller
# that solved with rewritten targets can restate the trade-off against the real ones.
def attach_displacement(
    items: list[SchedulingItem],
    placements: list[Placement],
    scheduled_minutes: dict[str, int],
) -> list[Placement]:
    shortfalls = [
        (item, item.target_minutes - scheduled_minutes.get(item.id, 0))
        for item in items
        if item.target_minutes - scheduled_minutes.get(item.id, 0) > 0
    ]
    by_id = {item.id: item for item in items}
    enriched: list[Placement] = []
    for placement in placements:
        placed = by_id.get(placement.item_id)
        candidates = [
            (item, missing)
            for item, missing in shortfalls
            if placed is not None
            and item.id != placement.item_id
            and _compare_protection(placed, item) < 0
            and _could_have_used(item, placement)
        ]
        if not candidates:
            enriched.append(
                replace(placement, reason_details=_without_displacement(placement.reason_details))
            )
            continue
        assert placed is not None
        item, missing = sorted(
            candidates,
            key=cmp_to_key(_compare_shortfalls),
        )[0]
        enriched.append(
            replace(
                placement,
                reason_details={
                    **_without_displacement(placement.reason_details),
                    "displaced_item_id": item.id,
                    "displaced_title": item.title,
                    "displaced_kind": item.kind,
                    "displaced_shortfall_minutes": missing,
                    "weight_tie_result": _weight_tie_result(placed, item),
                },
            )
        )
    return enriched


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
    if remainder or value.second or value.microsecond:
        result += timedelta(minutes=START_GRID_MINUTES - remainder)
    return result
