"use client";

import {
  AlertTriangle,
  BookOpen,
  FileCheck2,
  FileText,
  LoaderCircle,
  Plus,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";

import { apiUpload, ApiRequestError } from "@/lib/api";
import type {
  Course,
  GradingSchemeComponentProposal,
  OutlineExtraction,
  OutlineItemProposal,
  PlanningTask,
  Semester,
} from "@/lib/types";

type CourseOutlineStepProps = {
  semester: Semester;
  courses: Course[];
  tasks: PlanningTask[];
  busy: boolean;
  onImport: (proposal: OutlineExtraction) => Promise<boolean>;
  onCreateCourse: (event: FormEvent<HTMLFormElement>) => void;
  onCreateItem: (event: FormEvent<HTMLFormElement>) => void;
  onRemoveCourse: (id: string) => void;
  onRemoveItem: (id: string) => void;
};

export function CourseOutlineStep({
  semester,
  courses,
  tasks,
  busy,
  onImport,
  onCreateCourse,
  onCreateItem,
  onRemoveCourse,
  onRemoveItem,
}: CourseOutlineStepProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [proposals, setProposals] = useState<OutlineExtraction[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  function selectFiles(selected: FileList | File[]) {
    const accepted = Array.from(selected).filter((file) =>
      [".pdf", ".docx", ".txt"].some((extension) => file.name.toLowerCase().endsWith(extension)),
    );
    setFiles(accepted);
    setParseError(
      accepted.length === selected.length
        ? null
        : "DoNext accepts PDF, DOCX, and TXT course outlines.",
    );
  }

  async function analyzeFiles() {
    if (!files.length) return;
    setParsing(true);
    setParseError(null);
    try {
      const body = new FormData();
      files.forEach((file) => body.append("files", file));
      body.append("semester_start", semester.start_date);
      const extracted = await apiUpload<OutlineExtraction[]>("/documents/parse-outlines", body);
      setProposals(extracted);
      setFiles([]);
    } catch (error) {
      setParseError(
        error instanceof ApiRequestError
          ? error.message
          : "DoNext could not read those documents. Try a text-based PDF or enter the details manually.",
      );
    } finally {
      setParsing(false);
    }
  }

  function updateProposal(index: number, proposal: OutlineExtraction) {
    setProposals((current) => current.map((item, itemIndex) => itemIndex === index ? proposal : item));
  }

  async function importProposal(index: number) {
    const proposal = proposals[index];
    if (!proposal.course.code?.trim() || !proposal.course.name?.trim()) {
      setParseError("Add the course code and name before importing this outline.");
      return;
    }
    const imported = await onImport(proposal);
    if (imported) setProposals((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function updateSchemeComponent(
    proposalIndex: number,
    schemeIndex: number,
    componentIndex: number,
    updates: Partial<GradingSchemeComponentProposal>,
  ) {
    const proposal = proposals[proposalIndex];
    updateProposal(proposalIndex, {
      ...proposal,
      schemes: proposal.schemes.map((scheme, currentSchemeIndex) =>
        currentSchemeIndex === schemeIndex
          ? {
            ...scheme,
            components: scheme.components.map((component, currentComponentIndex) =>
              currentComponentIndex === componentIndex ? { ...component, ...updates } : component),
          }
          : scheme),
    });
  }

  const courseIds = new Set(courses.map((course) => course.id));
  const outlineTasks = tasks.filter((task) => task.course_id && courseIds.has(task.course_id));

  return (
    <>
      <header className="onboarding-step-heading">
        <div><p className="eyebrow">Start with the source</p></div>
        <h2>Upload your course outlines.</h2>
        <p>Upload outlines, schedules, or course slides together. DoNext identifies which files belong to the same course, combines their useful details, and waits for your review before adding anything.</p>
      </header>

      <section className="outline-upload-card">
        <label
          className="outline-dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event: DragEvent<HTMLLabelElement>) => {
            event.preventDefault();
            selectFiles(event.dataTransfer.files);
          }}
        >
          <input
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            multiple
            type="file"
            onChange={(event: ChangeEvent<HTMLInputElement>) => event.target.files && selectFiles(event.target.files)}
          />
          <span><UploadCloud size={25} /></span>
          <strong>Drop course documents here</strong>
          <small>or choose files · PDF, DOCX, or TXT · up to 10 MB each</small>
        </label>

        {files.length ? (
          <div className="outline-file-queue">
            <div>{files.map((file) => <span key={`${file.name}-${file.size}`}><FileText size={15} />{file.name}</span>)}</div>
            <button className="primary-button" disabled={parsing} type="button" onClick={() => void analyzeFiles()}>
              {parsing ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
              {parsing ? "Reading outlines…" : `Analyze ${files.length === 1 ? "outline" : `${files.length} outlines`}`}
            </button>
          </div>
        ) : null}
      </section>

      {parseError ? <p className="onboarding-error" role="alert">{parseError}</p> : null}

      <div className="outline-proposals">
        {proposals.map((proposal, proposalIndex) => (
          <article className="outline-proposal" key={`${proposal.source_files.join("-")}-${proposalIndex}`}>
            <header>
              <span><FileCheck2 size={19} /></span>
              <div><strong>{proposal.source_files.length === 1 ? proposal.source_files[0] : `${proposal.source_files.length} files combined`}</strong><small>{proposal.items.length} academic items · {proposal.meetings.length} class meetings · {proposal.document_types.map(formatDocumentType).join(" + ")}</small><small title={proposal.source_files.join(", ")}>{proposal.source_files.join(" · ")}</small></div>
              <button aria-label={`Dismiss ${proposal.source_files.join(", ")}`} type="button" onClick={() => setProposals((current) => current.filter((_, index) => index !== proposalIndex))}><X size={17} /></button>
            </header>

            <div className="outline-course-fields form-row">
              <label><span>Course code</span><input value={proposal.course.code ?? ""} onChange={(event) => updateProposal(proposalIndex, { ...proposal, course: { ...proposal.course, code: event.target.value } })} placeholder="CSC 320" /></label>
              <label><span>Course name</span><input value={proposal.course.name ?? ""} onChange={(event) => updateProposal(proposalIndex, { ...proposal, course: { ...proposal.course, name: event.target.value } })} placeholder="Algorithms" /></label>
            </div>
            <label className="outline-instructor"><span>Instructor <small>Optional</small></span><input value={proposal.course.instructor ?? ""} onChange={(event) => updateProposal(proposalIndex, { ...proposal, course: { ...proposal.course, instructor: event.target.value || null } })} placeholder="Dr. Chen" /></label>

            {proposal.schemes.length ? <div className="grading-scheme-review">
              <div className="proposal-section-title"><strong>Grading schemes</strong><small>Alternatives stay separate; DoNext plans for the highest plausible impact.</small></div>
              {proposal.schemes.map((scheme, schemeIndex) => <article key={scheme.key}>
                <header><div><strong>{scheme.name}</strong><small>{scheme.is_complete ? "Complete 100% scheme" : "Incomplete — review the missing weight"}</small></div><span>{scheme.selection_mode === "best_outcome" ? "Best outcome" : "Standard"}</span></header>
                <div>{scheme.components.map((component, componentIndex) => {
                  const target = proposal.groups.find((group) => group.key === component.target_group_key)?.name
                    ?? proposal.items.find((item) => item.key === component.target_item_key)?.name
                    ?? "Assessment";
                  return <label key={`${component.target_group_key ?? component.target_item_key}-${componentIndex}`}><span>{target}</span><span className="scheme-weight-input"><input aria-label={`${target} course weight in ${scheme.name}`} min="0" max="100" step="0.5" type="number" value={component.weight_percent} onChange={(event) => updateSchemeComponent(proposalIndex, schemeIndex, componentIndex, { weight_percent: Number(event.target.value) })} />%</span></label>;
                })}</div>
              </article>)}
            </div> : null}

            {proposal.items.length ? <div className="proposal-items">
              <div className="proposal-section-title"><strong>Assignments and exams</strong><small>Review weights, dates, and source evidence before importing.</small></div>
              {proposal.groups.map((group) => {
                const primarySchemeIndex = Math.max(0, proposal.schemes.findIndex((scheme) => scheme.is_primary));
                const componentIndex = proposal.schemes[primarySchemeIndex]?.components.findIndex((component) => component.target_group_key === group.key) ?? -1;
                const component = componentIndex >= 0 ? proposal.schemes[primarySchemeIndex].components[componentIndex] : null;
                const groupItems = proposal.items.filter((item) => item.group_key === group.key);
                if (!groupItems.length) return null;
                return <section className="proposal-group" key={group.key}>
                  <header>
                    <div><strong>{group.name}{component ? ` — ${component.weight_percent}% — ${formatRule(component)}` : ""}</strong><small>{formatOrigin(group.weight_origin)} · {Math.round(group.extraction_confidence * 100)}% confidence</small></div>
                    {component ? <div className="group-rule-editor"><label><span>Group weight</span><span><input min="0" max="100" step="0.5" type="number" value={component.weight_percent} onChange={(event) => updateSchemeComponent(proposalIndex, primarySchemeIndex, componentIndex, { weight_percent: Number(event.target.value) })} />%</span></label><label><span>Counting rule</span><select value={component.selection_rule} onChange={(event) => updateSchemeComponent(proposalIndex, primarySchemeIndex, componentIndex, { selection_rule: event.target.value as GradingSchemeComponentProposal["selection_rule"], selection_count: ["best_n", "drop_lowest_n"].includes(event.target.value) ? (component.selection_count ?? 1) : null })}><option value="all">All items count</option><option value="best_n">Best N</option><option value="drop_lowest_n">Drop lowest N</option><option value="highest_attempt">Highest attempt</option><option value="latest_attempt">Latest attempt</option></select></label>{["best_n", "drop_lowest_n"].includes(component.selection_rule) ? <label><span>Number</span><input min="1" max={groupItems.length} type="number" value={component.selection_count ?? 1} onChange={(event) => updateSchemeComponent(proposalIndex, primarySchemeIndex, componentIndex, { selection_count: Number(event.target.value) })} /></label> : null}</div> : null}
                  </header>
                  {group.source_text ? <p className="proposal-source">Source: {group.source_text}</p> : null}
                  {groupItems.map((item) => {
                    const itemIndex = proposal.items.indexOf(item);
                    return <ProposalItemRow grouped item={item} key={item.key ?? `${item.name}-${itemIndex}`} onChange={(updates) => updateProposal(proposalIndex, { ...proposal, items: proposal.items.map((current, index) => index === itemIndex ? { ...current, ...updates } : current) })} onRemove={() => updateProposal(proposalIndex, { ...proposal, items: proposal.items.filter((_, index) => index !== itemIndex) })} />;
                  })}
                </section>;
              })}
              {proposal.items.filter((item) => !item.group_key).map((item) => {
                const itemIndex = proposal.items.indexOf(item);
                return <ProposalItemRow grouped={false} item={item} key={item.key ?? `${item.name}-${itemIndex}`} onChange={(updates) => updateProposal(proposalIndex, { ...proposal, items: proposal.items.map((current, index) => index === itemIndex ? { ...current, ...updates } : current) })} onRemove={() => updateProposal(proposalIndex, { ...proposal, items: proposal.items.filter((_, index) => index !== itemIndex) })} />;
              })}
            </div> : null}

            {proposal.warnings.map((warning) => <p className="proposal-warning" key={warning}><AlertTriangle size={15} />{warning}</p>)}
            <button className="primary-button import-outline-button" disabled={busy} type="button" onClick={() => void importProposal(proposalIndex)}><Plus size={17} /> Confirm and add course</button>
          </article>
        ))}
      </div>

      {courses.length ? <section className="imported-courses">
        <div className="proposal-section-title"><strong>Courses already added</strong><small>{courses.length} in {semester.name}</small></div>
        {courses.map((course) => <article key={course.id}><span><BookOpen size={17} /></span><div><strong>{course.code} · {course.name}</strong><small>{outlineTasks.filter((task) => task.course_id === course.id).length} assignments or exams</small></div><button aria-label={`Remove ${course.code}`} type="button" onClick={() => onRemoveCourse(course.id)}><Trash2 size={16} /></button></article>)}
      </section> : null}

      <details className="manual-entry-panel">
        <summary><span><Plus size={17} /></span><div><strong>Enter course information manually</strong><small>Add the course first, then its assignments and exams.</small></div></summary>
        <div className="manual-entry-content">
          <form className="onboarding-form compact-form" onSubmit={onCreateCourse}>
            <div className="form-row"><label><span>Course code</span><input name="code" placeholder="CSC 320" required /></label><label><span>Course name</span><input name="name" placeholder="Algorithms" required /></label></div>
            <label><span>Instructor <small>Optional</small></span><input name="instructor" placeholder="Dr. Chen" /></label>
            <div className="form-row"><label><span>Difficulty</span><select name="difficulty" defaultValue="3"><option value="1">1 · Light</option><option value="2">2</option><option value="3">3 · Moderate</option><option value="4">4</option><option value="5">5 · Demanding</option></select></label><label><span>Weekly study target</span><select name="weekly_hours" defaultValue="3"><option value="1">1 hour</option><option value="2">2 hours</option><option value="3">3 hours</option><option value="4">4 hours</option><option value="5">5 hours</option><option value="6">6 hours</option><option value="8">8 hours</option></select></label></div>
            <button className="secondary-button form-submit" disabled={busy} type="submit"><Plus size={17} /> Add course</button>
          </form>

          {courses.length ? <form className="onboarding-form compact-form" onSubmit={onCreateItem}>
            <div className="form-row"><label><span>Course</span><select name="course_id" required>{courses.map((course) => <option key={course.id} value={course.id}>{course.code}</option>)}</select></label><label><span>Assignment or exam</span><input name="name" placeholder="Midterm exam" required /></label></div>
            <div className="form-row"><label><span>Deadline</span><input name="deadline" type="date" required /></label><label><span>Estimated effort</span><select name="estimated_hours" defaultValue="3"><option value="1">1 hour</option><option value="2">2 hours</option><option value="3">3 hours</option><option value="5">5 hours</option><option value="8">8 hours</option><option value="12">12 hours</option><option value="20">20 hours</option></select></label></div>
            <input name="priority" type="hidden" value="high" /><input name="intensity" type="hidden" value="deep" />
            <button className="secondary-button form-submit" disabled={busy} type="submit"><Plus size={17} /> Add academic item</button>
          </form> : null}

          {outlineTasks.length ? <div className="manual-task-list">{outlineTasks.map((task) => <article key={task.id}><FileText size={16} /><div><strong>{task.name}</strong><small>{courses.find((course) => course.id === task.course_id)?.code} · {task.deadline_at ? new Date(task.deadline_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : "No deadline"}</small></div><button aria-label={`Remove ${task.name}`} type="button" onClick={() => onRemoveItem(task.id)}><Trash2 size={15} /></button></article>)}</div> : null}
        </div>
      </details>
    </>
  );
}

function ProposalItemRow({ item, grouped, onChange, onRemove }: { item: OutlineItemProposal; grouped: boolean; onChange: (updates: Partial<OutlineItemProposal>) => void; onRemove: () => void }) {
  const weight = grouped ? item.relative_weight_percent : item.weight_percent;
  return <div className="proposal-item">
    <input aria-label="Item name" value={item.name} onChange={(event) => onChange({ name: event.target.value })} />
    <input aria-label={`${item.name} deadline`} type="date" value={item.deadline_at?.slice(0, 10) ?? ""} onChange={(event) => onChange({ deadline_at: event.target.value ? `${event.target.value}T23:59:00` : null })} />
    <label className="proposal-weight-field"><span>{grouped ? "Within group" : "Course weight"}</span><span><input aria-label={`${item.name} weight`} min="0" max="100" placeholder={grouped ? "Equal" : "Unknown"} step="0.5" type="number" value={weight ?? ""} onChange={(event) => onChange({ [grouped ? "relative_weight_percent" : "weight_percent"]: event.target.value === "" ? null : Number(event.target.value), weight_origin: event.target.value === "" ? (grouped ? "inferred_equal" : "unknown") : "manual" })} />%</span></label>
    <span title={item.source_text}>{formatOrigin(item.weight_origin)} · {Math.round(item.confidence * 100)}%</span>
    <button aria-label={`Remove ${item.name}`} type="button" onClick={onRemove}><Trash2 size={15} /></button>
    <small className="proposal-item-source">Source: {item.source_text}</small>
  </div>;
}

function formatRule(component: GradingSchemeComponentProposal) {
  if (component.selection_rule === "drop_lowest_n") return `drop lowest ${component.selection_count ?? 1}`;
  if (component.selection_rule === "best_n") return `best ${component.selection_count ?? 1}`;
  if (component.selection_rule === "highest_attempt") return "highest attempt";
  if (component.selection_rule === "latest_attempt") return "latest attempt";
  return "all count";
}

function formatOrigin(value: OutlineItemProposal["weight_origin"]) {
  return {
    explicit: "Explicit weight",
    inferred_equal: "Provisional equal share",
    calculated_from_points: "Calculated from points",
    inherited_from_group: "Inherited from group",
    manual: "Manually confirmed",
    unknown: "Weight unknown",
  }[value];
}

function formatDocumentType(value: OutlineExtraction["document_types"][number]) {
  return {
    course_outline: "outline",
    course_schedule: "schedule",
    lecture_material: "lecture material",
    unknown: "other document",
  }[value];
}
