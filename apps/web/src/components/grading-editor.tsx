"use client";

import { AlertTriangle, Check, LoaderCircle, Scale, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { FormDialog } from "@/components/form-dialog";
import { apiRequest, ApiRequestError } from "@/lib/api";
import type {
  AcademicImpact,
  AcademicItem,
  Course,
  CourseGrading,
  GradingScheme,
  SelectionRule,
} from "@/lib/types";

export function GradingEditor({ course, open, onClose, onSaved }: { course: Course; open: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [grading, setGrading] = useState<CourseGrading | null>(null);
  const [impacts, setImpacts] = useState<AcademicImpact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.all([
      apiRequest<CourseGrading>(`/courses/${course.id}/grading`),
      apiRequest<AcademicImpact[]>(`/courses/${course.id}/academic-impact`),
    ]).then(([nextGrading, nextImpacts]) => {
      if (!active) return;
      setGrading(nextGrading);
      setImpacts(nextImpacts);
    }).catch((requestError: unknown) => {
      if (active) setError(requestError instanceof ApiRequestError ? requestError.message : "Could not load the grading model.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [course.id, open]);

  const impactByItem = useMemo(
    () => new Map(impacts.map((impact) => [impact.academic_item_id, impact])),
    [impacts],
  );

  function updateItem(itemId: string, updates: Partial<AcademicItem>) {
    setGrading((current) => current ? { ...current, items: current.items.map((item) => item.id === itemId ? { ...item, ...updates } : item) } : current);
  }

  function updateScheme(schemeId: string, componentId: string, updates: Partial<GradingScheme["components"][number]>) {
    setGrading((current) => current ? { ...current, schemes: current.schemes.map((scheme) => scheme.id === schemeId ? { ...scheme, components: scheme.components.map((component) => component.id === componentId ? { ...component, ...updates } : component) } : scheme) } : current);
  }

  async function save() {
    if (!grading) return;
    setSaving(true);
    setError(null);
    const groupKeys = new Map(grading.groups.map((group) => [group.id, `group-${group.id}`]));
    const itemKeys = new Map(grading.items.map((item) => [item.id, `item-${item.id}`]));
    try {
      const saved = await apiRequest<CourseGrading>(`/courses/${course.id}/grading`, {
        method: "PUT",
        body: JSON.stringify({
          current_grade: grading.course.current_grade,
          target_grade: grading.course.target_grade,
          groups: grading.groups.map((group) => ({
            key: groupKeys.get(group.id),
            parent_key: group.parent_group_id ? groupKeys.get(group.parent_group_id) : null,
            name: group.name,
            allocation_method: group.allocation_method,
            relative_weight_percent: group.relative_weight_percent,
            weight_origin: group.weight_origin,
            extraction_confidence: group.extraction_confidence,
            source_text: group.source_text,
          })),
          items: grading.items.map((item) => ({
            key: itemKeys.get(item.id),
            group_key: item.assessment_group_id ? groupKeys.get(item.assessment_group_id) : null,
            item_type: item.item_type,
            name: item.name,
            description: item.description,
            due_at: item.due_at,
            direct_weight_percent: item.direct_weight_percent,
            relative_weight_percent: item.relative_weight_percent,
            points_possible: item.points_possible,
            points_earned: item.points_earned,
            grade_status: item.points_earned === null ? item.grade_status : "graded",
            weight_origin: item.weight_origin,
            extraction_confidence: item.extraction_confidence,
            minimum_required_percent: item.minimum_required_percent,
            extra_credit: item.extra_credit,
            source_text: item.source_text,
            source_references: item.source_references,
          })),
          schemes: grading.schemes.map((scheme) => ({
            key: `scheme-${scheme.id}`,
            name: scheme.name,
            selection_mode: scheme.selection_mode,
            is_primary: scheme.is_primary,
            is_complete: scheme.is_complete,
            components: scheme.components.map((component) => ({
              target_group_key: component.assessment_group_id ? groupKeys.get(component.assessment_group_id) : null,
              target_item_key: component.academic_item_id ? itemKeys.get(component.academic_item_id) : null,
              weight_percent: component.weight_percent,
              selection_rule: component.selection_rule,
              selection_count: component.selection_count,
              is_extra_credit: component.is_extra_credit,
              minimum_required_percent: component.minimum_required_percent,
            })),
          })),
        }),
      });
      setGrading(saved);
      setImpacts(await apiRequest<AcademicImpact[]>(`/courses/${course.id}/academic-impact`));
      await onSaved();
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : "Could not save the grading model.");
    } finally {
      setSaving(false);
    }
  }

  return <FormDialog description="Review weights, grading rules, returned grades, and the planning importance they produce." onClose={onClose} open={open} title={`${course.code} grading and impact`} wide>
    {loading ? <div className="page-status"><LoaderCircle className="spin" size={19} /> Loading grading model…</div> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {grading ? <div className="grading-editor">
      <section className="grading-grade-targets">
        <label><span>Current course grade <small>Optional</small></span><span><input min="0" max="100" step="0.1" type="number" value={grading.course.current_grade ?? ""} onChange={(event) => setGrading({ ...grading, course: { ...grading.course, current_grade: nullableNumber(event.target.value) } })} />%</span></label>
        <label><span>Target course grade <small>Optional</small></span><span><input min="0" max="100" step="0.1" type="number" value={grading.course.target_grade ?? ""} onChange={(event) => setGrading({ ...grading, course: { ...grading.course, target_grade: nullableNumber(event.target.value) } })} />%</span></label>
      </section>

      {grading.warnings.map((warning) => <p className="proposal-warning" key={warning}><AlertTriangle size={15} /> {warning}</p>)}

      <section className="grading-editor-section">
        <header><Scale size={17} /><div><strong>Grading schemes</strong><small>Ordinary complete schemes must total 100%; extra credit may go above it.</small></div></header>
        {grading.schemes.length ? grading.schemes.map((scheme) => <article className="managed-scheme" key={scheme.id}>
          <div><strong>{scheme.name}</strong><span>{scheme.is_primary ? "Primary" : "Alternative"}</span></div>
          {scheme.components.map((component) => <div className="managed-component" key={component.id}>
            <span>{componentName(component, grading)}</span>
            <label><span>Weight</span><span><input min="0" max="100" step="0.5" type="number" value={component.weight_percent} onChange={(event) => updateScheme(scheme.id, component.id, { weight_percent: Number(event.target.value) })} />%</span></label>
            <label><span>Rule</span><select value={component.selection_rule} onChange={(event) => updateScheme(scheme.id, component.id, { selection_rule: event.target.value as SelectionRule, selection_count: ["best_n", "drop_lowest_n"].includes(event.target.value) ? (component.selection_count ?? 1) : null })}><option value="all">All count</option><option value="best_n">Best N</option><option value="drop_lowest_n">Drop lowest N</option><option value="highest_attempt">Highest attempt</option><option value="latest_attempt">Latest attempt</option></select></label>
            {["best_n", "drop_lowest_n"].includes(component.selection_rule) ? <label><span>Count</span><input min="1" type="number" value={component.selection_count ?? 1} onChange={(event) => updateScheme(scheme.id, component.id, { selection_count: Number(event.target.value) })} /></label> : null}
            <label><span>Minimum to pass</span><span><input min="0" max="100" placeholder="None" type="number" value={component.minimum_required_percent ?? ""} onChange={(event) => updateScheme(scheme.id, component.id, { minimum_required_percent: nullableNumber(event.target.value) })} />%</span></label>
          </div>)}
        </article>) : <p className="grading-empty">No grading scheme yet. Unknown-weight items remain visible and are never presented as facts.</p>}
      </section>

      <section className="grading-editor-section">
        <header><ShieldAlert size={17} /><div><strong>Assessments and planning importance</strong><small>The score stays internal. You see the tier and the reasons behind it.</small></div></header>
        {grading.items.map((item) => {
          const impact = impactByItem.get(item.id);
          return <article className="managed-item" key={item.id}>
            <div className="managed-item-heading"><div><strong>{item.name}</strong><small>{grading.groups.find((group) => group.id === item.assessment_group_id)?.name ?? item.item_type.replaceAll("_", " ")} · {originLabel(item.weight_origin)}</small></div>{impact ? <span className={`impact-tier ${impact.tier}`}>{impact.tier}</span> : null}</div>
            <div className="managed-item-fields">
              <label><span>Deadline</span><input type="date" value={item.due_at?.slice(0, 10) ?? ""} onChange={(event) => updateItem(item.id, { due_at: event.target.value ? `${event.target.value}T23:59:00` : null })} /></label>
              <label><span>{item.assessment_group_id ? "Within group" : "Course weight"}</span><span><input min="0" max="100" placeholder="Unknown" step="0.5" type="number" value={(item.assessment_group_id ? item.relative_weight_percent : item.direct_weight_percent) ?? ""} onChange={(event) => updateItem(item.id, item.assessment_group_id ? { relative_weight_percent: nullableNumber(event.target.value), weight_origin: event.target.value ? "manual" : "inferred_equal" } : { direct_weight_percent: nullableNumber(event.target.value), weight_origin: event.target.value ? "manual" : "unknown" })} />%</span></label>
              <label><span>Points possible</span><input min="0.01" step="0.01" type="number" value={item.points_possible ?? ""} onChange={(event) => updateItem(item.id, { points_possible: nullableNumber(event.target.value) })} /></label>
              <label><span>Points earned</span><input min="0" step="0.01" type="number" value={item.points_earned ?? ""} onChange={(event) => updateItem(item.id, { points_earned: nullableNumber(event.target.value) })} /></label>
            </div>
            {impact ? <div className="impact-explanation"><strong>{impact.minimum_weight_percent === impact.maximum_weight_percent ? `${impact.effective_weight_percent}% effective weight` : `${impact.minimum_weight_percent}%–${impact.maximum_weight_percent}% across schemes`}</strong>{impact.blocking_rule ? <span><ShieldAlert size={13} /> {impact.blocking_rule}</span> : null}<ul>{impact.reasons.map((reason) => <li key={reason.code}>{reason.label}</li>)}</ul></div> : null}
            {item.source_text ? <details className="managed-source"><summary>Supporting source</summary><p>{item.source_text}</p>{item.source_references.length ? <small>{item.source_references.join(" · ")}</small> : null}</details> : null}
          </article>;
        })}
      </section>
      <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onClose}>Close</button><button className="primary-button" disabled={saving} type="button" onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Save grading model</button></div>
    </div> : null}
  </FormDialog>;
}

function nullableNumber(value: string) {
  return value === "" ? null : Number(value);
}

function componentName(component: GradingScheme["components"][number], grading: CourseGrading) {
  return grading.groups.find((group) => group.id === component.assessment_group_id)?.name
    ?? grading.items.find((item) => item.id === component.academic_item_id)?.name
    ?? "Assessment";
}

function originLabel(origin: AcademicItem["weight_origin"]) {
  return {
    explicit: "explicit",
    inferred_equal: "provisional equal share",
    calculated_from_points: "calculated from points",
    inherited_from_group: "inherited from group",
    manual: "manually confirmed",
    unknown: "weight unknown",
  }[origin];
}
