import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from donext.models import (
    AcademicItem,
    AcademicItemType,
    AllocationMethod,
    AssessmentGroup,
    Course,
    GradingScheme,
    GradingSchemeComponent,
    Priority,
    SelectionRule,
    Task,
    WeightOrigin,
)
from donext.schemas import AcademicImpactRead, AcademicImpactReason, AcademicImpactTier


@dataclass(frozen=True)
class CalculatedImpact:
    result: AcademicImpactRead
    score: float


@dataclass(frozen=True)
class WeightResult:
    effective: float
    minimum: float
    maximum: float
    origin: WeightOrigin
    rule: SelectionRule | None
    minimum_required: float | None
    hurdle_group_id: uuid.UUID | None
    extra_credit: bool


HORIZON_DAYS = {
    AcademicItemType.final_exam: 28,
    AcademicItemType.midterm: 28,
    AcademicItemType.project: 21,
    AcademicItemType.presentation: 21,
    AcademicItemType.assignment: 14,
    AcademicItemType.lab: 14,
    AcademicItemType.quiz: 7,
    AcademicItemType.reading: 7,
    AcademicItemType.other: 14,
}

PRIORITY_PRESSURE = {
    Priority.critical: 1.0,
    Priority.high: 0.75,
    Priority.medium: 0.5,
    Priority.low: 0.25,
    Priority.optional: 0.0,
}


def _descends_from(
    group_id: uuid.UUID | None,
    ancestor_id: uuid.UUID,
    groups: dict[uuid.UUID, AssessmentGroup],
) -> bool:
    seen: set[uuid.UUID] = set()
    current = group_id
    while current is not None and current not in seen:
        if current == ancestor_id:
            return True
        seen.add(current)
        group = groups.get(current)
        current = group.parent_group_id if group else None
    return False


def _group_share(
    item: AcademicItem,
    component: GradingSchemeComponent,
    group: AssessmentGroup,
    eligible: list[AcademicItem],
    groups: dict[uuid.UUID, AssessmentGroup],
) -> tuple[float, WeightOrigin]:
    if not eligible:
        return 0.0, WeightOrigin.unknown
    if group.allocation_method == AllocationMethod.points:
        total_points = sum(candidate.points_possible or 0 for candidate in eligible)
        if item.points_possible and total_points > 0:
            return (
                component.weight_percent * item.points_possible / total_points,
                WeightOrigin.calculated_from_points,
            )
    if item.relative_weight_percent is not None:
        nested_multiplier = 1.0
        current = groups.get(item.assessment_group_id) if item.assessment_group_id else None
        while current is not None and current.id != group.id:
            if current.relative_weight_percent is not None:
                nested_multiplier *= current.relative_weight_percent / 100
            current = groups.get(current.parent_group_id) if current.parent_group_id else None
        return (
            component.weight_percent * item.relative_weight_percent / 100 * nested_multiplier,
            WeightOrigin.inherited_from_group,
        )

    counted = len(eligible)
    if component.selection_rule == SelectionRule.best_n and component.selection_count:
        counted = min(counted, component.selection_count)
    elif component.selection_rule == SelectionRule.drop_lowest_n and component.selection_count:
        counted = max(1, counted - component.selection_count)
    elif component.selection_rule in {SelectionRule.highest_attempt, SelectionRule.latest_attempt}:
        counted = 1
    return component.weight_percent / max(1, counted), WeightOrigin.inferred_equal


def calculate_weights(
    items: list[AcademicItem],
    groups: list[AssessmentGroup],
    schemes: list[GradingScheme],
    components: list[GradingSchemeComponent],
) -> dict[object, WeightResult]:
    group_by_id = {group.id: group for group in groups}
    components_by_scheme: dict[object, list[GradingSchemeComponent]] = {}
    for component in components:
        components_by_scheme.setdefault(component.grading_scheme_id, []).append(component)

    item_results: dict[object, WeightResult] = {}
    for item in items:
        scheme_weights: list[float] = []
        origins: list[WeightOrigin] = []
        matched_rules: list[SelectionRule] = []
        required_values: list[float] = []
        hurdle_group_ids: list[uuid.UUID] = []
        extra_credit_values: list[bool] = []
        for scheme in schemes:
            scheme_weight = 0.0
            for component in components_by_scheme.get(scheme.id, []):
                if component.academic_item_id == item.id:
                    scheme_weight += component.weight_percent
                    origins.append(item.weight_origin)
                    matched_rules.append(component.selection_rule)
                    if component.minimum_required_percent is not None:
                        required_values.append(component.minimum_required_percent)
                        if component.assessment_group_id is not None:
                            hurdle_group_ids.append(component.assessment_group_id)
                    extra_credit_values.append(component.is_extra_credit)
                elif component.assessment_group_id is not None and _descends_from(
                    item.assessment_group_id, component.assessment_group_id, group_by_id
                ):
                    group = group_by_id[component.assessment_group_id]
                    eligible = [
                        candidate
                        for candidate in items
                        if _descends_from(
                            candidate.assessment_group_id,
                            component.assessment_group_id,
                            group_by_id,
                        )
                    ]
                    share, origin = _group_share(item, component, group, eligible, group_by_id)
                    scheme_weight += share
                    origins.append(origin)
                    matched_rules.append(component.selection_rule)
                    if component.minimum_required_percent is not None:
                        required_values.append(component.minimum_required_percent)
                        hurdle_group_ids.append(component.assessment_group_id)
                    extra_credit_values.append(component.is_extra_credit)
            scheme_weights.append(scheme_weight)

        if not schemes:
            scheme_weights = [item.direct_weight_percent or 0.0]
            origins = [item.weight_origin]
        elif item.direct_weight_percent is not None and not any(scheme_weights):
            scheme_weights = [item.direct_weight_percent]
            origins = [item.weight_origin]

        minimum = min(scheme_weights, default=0.0)
        maximum = max(scheme_weights, default=0.0)
        origin = origins[-1] if origins else WeightOrigin.unknown
        if WeightOrigin.inferred_equal in origins:
            origin = WeightOrigin.inferred_equal
        elif WeightOrigin.calculated_from_points in origins:
            origin = WeightOrigin.calculated_from_points
        item_results[item.id] = WeightResult(
            effective=maximum,
            minimum=minimum,
            maximum=maximum,
            origin=origin,
            rule=matched_rules[-1] if matched_rules else None,
            minimum_required=max(
                [value for value in required_values if value is not None]
                + (
                    [item.minimum_required_percent]
                    if item.minimum_required_percent is not None
                    else []
                ),
                default=None,
            ),
            hurdle_group_id=hurdle_group_ids[-1] if hurdle_group_ids else None,
            extra_credit=item.extra_credit
            or (bool(extra_credit_values) and all(extra_credit_values)),
        )
    return item_results


def _deadline_pressure(item: AcademicItem, now: datetime) -> tuple[float, str | None]:
    if item.due_at is None:
        return 0.0, None
    due_at = item.due_at
    if due_at.tzinfo is None:
        due_at = due_at.replace(tzinfo=UTC)
    days = (due_at - now).total_seconds() / 86400
    if days < 0:
        return 1.0, "Deadline has passed"
    horizon = HORIZON_DAYS[item.item_type]
    pressure = max(0.0, min(1.0, 1 - days / horizon))
    if pressure > 0:
        return pressure, f"Due within the {horizon}-day {item.item_type.value} horizon"
    return 0.0, None


def calculate_academic_impacts(
    course: Course,
    items: list[AcademicItem],
    groups: list[AssessmentGroup],
    schemes: list[GradingScheme],
    components: list[GradingSchemeComponent],
    tasks: list[Task],
    now: datetime | None = None,
) -> list[CalculatedImpact]:
    now = now or datetime.now(UTC)
    task_by_item = {task.academic_item_id: task for task in tasks if task.academic_item_id}
    weights = calculate_weights(items, groups, schemes, components)
    group_by_id = {group.id: group for group in groups}

    def hurdle_group_satisfied(group_id: uuid.UUID, minimum: float) -> bool:
        return any(
            candidate.points_earned is not None
            and candidate.points_possible is not None
            and candidate.points_earned / candidate.points_possible * 100 >= minimum
            for candidate in items
            if _descends_from(candidate.assessment_group_id, group_id, group_by_id)
        )

    results: list[CalculatedImpact] = []

    for item in items:
        weight = weights[item.id]
        task = task_by_item.get(item.id)
        weight_pressure = min(weight.effective / 30, 1)
        deadline_pressure, deadline_label = _deadline_pressure(item, now)
        grade_gap = 0.0
        if course.current_grade is not None and course.target_grade is not None:
            grade_gap = max(0.0, min(1.0, (course.target_grade - course.current_grade) / 20))
        priority_pressure = PRIORITY_PRESSURE[task.priority] if task else 0.5
        score = 100 * (
            0.5 * weight_pressure
            + 0.3 * deadline_pressure
            + 0.1 * grade_gap
            + 0.1 * priority_pressure
        )
        reasons: list[tuple[float, AcademicImpactReason]] = []
        if weight.effective > 0:
            label = f"Worth up to {weight.maximum:.1f}% of the course grade"
            if weight.minimum != weight.maximum:
                label = f"Worth {weight.minimum:.1f}%–{weight.maximum:.1f}% across grading schemes"
            reasons.append((50 * weight_pressure, AcademicImpactReason(code="weight", label=label)))
        else:
            reasons.append(
                (
                    0,
                    AcademicImpactReason(
                        code="unknown_weight",
                        label="Weight is unknown; confirm it before relying on this ranking",
                    ),
                )
            )
        if deadline_label:
            reasons.append(
                (
                    30 * deadline_pressure,
                    AcademicImpactReason(code="deadline", label=deadline_label),
                )
            )
        if grade_gap > 0:
            reasons.append(
                (
                    10 * grade_gap,
                    AcademicImpactReason(
                        code="grade_gap", label="Current course grade is below the target"
                    ),
                )
            )
        if task:
            reasons.append(
                (
                    10 * priority_pressure,
                    AcademicImpactReason(
                        code="user_priority",
                        label=f"Marked {task.priority.value} priority",
                    ),
                )
            )

        blocking_rule: str | None = None
        if weight.minimum_required is not None:
            score_percent = None
            if item.points_earned is not None and item.points_possible:
                score_percent = item.points_earned / item.points_possible * 100
            group_satisfied = bool(
                weight.hurdle_group_id
                and hurdle_group_satisfied(weight.hurdle_group_id, weight.minimum_required)
            )
            if not group_satisfied and (
                score_percent is None or score_percent < weight.minimum_required
            ):
                score = max(score, 75)
                blocking_rule = f"Requires at least {weight.minimum_required:g}% to pass"
                reasons.append(
                    (
                        100,
                        AcademicImpactReason(code="minimum_pass", label=blocking_rule),
                    )
                )

        if item.due_at is not None and deadline_pressure == 1 and task and task.required:
            due_at = item.due_at
            if due_at.tzinfo is None:
                due_at = due_at.replace(tzinfo=UTC)
            if due_at < now and task.status.value not in {"completed", "skipped"}:
                score = max(score, 75)
                blocking_rule = blocking_rule or "Required work is overdue"

        if weight.rule in {SelectionRule.highest_attempt, SelectionRule.latest_attempt}:
            target_met = (
                course.current_grade is not None
                and course.target_grade is not None
                and course.current_grade >= course.target_grade
            )
            if target_met:
                score *= 0.35
                reasons.append(
                    (
                        20,
                        AcademicImpactReason(
                            code="rewrite_not_needed",
                            label=(
                                "Replacement value is low because the target grade is already met"
                            ),
                        ),
                    )
                )

        extra_credit = weight.extra_credit
        if extra_credit:
            score *= 0.35
            reasons.append(
                (
                    20,
                    AcademicImpactReason(
                        code="extra_credit",
                        label="Extra credit is kept below required unsafe work",
                    ),
                )
            )

        score = max(0.0, min(100.0, score))
        tier: AcademicImpactTier
        if blocking_rule or score >= 75:
            tier = "critical"
        elif score >= 50:
            tier = "high"
        elif score >= 25:
            tier = "normal"
        else:
            tier = "low"
        if extra_credit and not blocking_rule and tier in {"critical", "high"}:
            tier = "normal"

        top_reasons = [
            reason for _, reason in sorted(reasons, key=lambda value: value[0], reverse=True)[:3]
        ]
        results.append(
            CalculatedImpact(
                score=score,
                result=AcademicImpactRead(
                    academic_item_id=item.id,
                    task_id=task.id if task else None,
                    tier=tier,
                    effective_weight_percent=round(weight.effective, 2),
                    minimum_weight_percent=round(weight.minimum, 2),
                    maximum_weight_percent=round(weight.maximum, 2),
                    weight_origin=weight.origin,
                    blocking_rule=blocking_rule,
                    reasons=top_reasons,
                ),
            )
        )
    return sorted(results, key=lambda result: result.score, reverse=True)
