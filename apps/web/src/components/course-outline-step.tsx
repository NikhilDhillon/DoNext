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
import type { Course, OutlineExtraction, PlanningTask, Semester } from "@/lib/types";

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
      const extracted = await Promise.all(
        files.map(async (file) => {
          const body = new FormData();
          body.append("file", file);
          body.append("semester_start", semester.start_date);
          return apiUpload<OutlineExtraction>("/documents/parse-outline", body);
        }),
      );
      setProposals(extracted);
      setFiles([]);
    } catch (error) {
      setParseError(
        error instanceof ApiRequestError
          ? error.message
          : "DoNext could not read those outlines. Try a text-based PDF or enter the details manually.",
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

  const courseIds = new Set(courses.map((course) => course.id));
  const outlineTasks = tasks.filter((task) => task.course_id && courseIds.has(task.course_id));

  return (
    <>
      <header className="onboarding-step-heading">
        <div><p className="eyebrow">Start with the source</p></div>
        <h2>Upload your course outlines.</h2>
        <p>DoNext reads each file locally and proposes the course, assignments, exams, and class times it finds. Nothing is added until you review it.</p>
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
          <strong>Drop course outlines here</strong>
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
          <article className="outline-proposal" key={`${proposal.file_name}-${proposalIndex}`}>
            <header>
              <span><FileCheck2 size={19} /></span>
              <div><strong>{proposal.file_name}</strong><small>{proposal.items.length} academic items · {proposal.meetings.length} class meetings found</small></div>
              <button aria-label={`Dismiss ${proposal.file_name}`} type="button" onClick={() => setProposals((current) => current.filter((_, index) => index !== proposalIndex))}><X size={17} /></button>
            </header>

            <div className="outline-course-fields form-row">
              <label><span>Course code</span><input value={proposal.course.code ?? ""} onChange={(event) => updateProposal(proposalIndex, { ...proposal, course: { ...proposal.course, code: event.target.value } })} placeholder="CSC 320" /></label>
              <label><span>Course name</span><input value={proposal.course.name ?? ""} onChange={(event) => updateProposal(proposalIndex, { ...proposal, course: { ...proposal.course, name: event.target.value } })} placeholder="Algorithms" /></label>
            </div>
            <label className="outline-instructor"><span>Instructor <small>Optional</small></span><input value={proposal.course.instructor ?? ""} onChange={(event) => updateProposal(proposalIndex, { ...proposal, course: { ...proposal.course, instructor: event.target.value || null } })} placeholder="Dr. Chen" /></label>

            {proposal.items.length ? <div className="proposal-items">
              <div className="proposal-section-title"><strong>Assignments and exams</strong><small>Review every date before importing.</small></div>
              {proposal.items.map((item, itemIndex) => <div className="proposal-item" key={`${item.name}-${itemIndex}`}>
                <input aria-label="Item name" value={item.name} onChange={(event) => updateProposal(proposalIndex, { ...proposal, items: proposal.items.map((current, index) => index === itemIndex ? { ...current, name: event.target.value } : current) })} />
                <input aria-label={`${item.name} deadline`} type="date" value={item.deadline_at?.slice(0, 10) ?? ""} onChange={(event) => updateProposal(proposalIndex, { ...proposal, items: proposal.items.map((current, index) => index === itemIndex ? { ...current, deadline_at: event.target.value ? `${event.target.value}T23:59:00` : null } : current) })} />
                <span>{Math.round(item.confidence * 100)}% confidence</span>
                <button aria-label={`Remove ${item.name}`} type="button" onClick={() => updateProposal(proposalIndex, { ...proposal, items: proposal.items.filter((_, index) => index !== itemIndex) })}><Trash2 size={15} /></button>
              </div>)}
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
