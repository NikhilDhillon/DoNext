"use client";

import { LoaderCircle, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";

import { FormDialog } from "@/components/form-dialog";
import { apiRequest, ApiRequestError } from "@/lib/api";
import type { AcademicItem, Course, SemesterDeadline } from "@/lib/types";

type ItemType = NonNullable<AcademicItem["item_type"]>;

/** Course work is due at the end of its day unless the student says otherwise. */
const DEFAULT_DUE_TIME = "23:59";

const ITEM_TYPES: { value: ItemType; label: string }[] = [
  { value: "assignment", label: "Assignment" },
  { value: "project", label: "Project" },
  { value: "quiz", label: "Quiz" },
  { value: "midterm", label: "Midterm" },
  { value: "final_exam", label: "Final exam" },
  { value: "presentation", label: "Presentation" },
  { value: "lab", label: "Lab" },
  { value: "reading", label: "Reading" },
  { value: "other", label: "Other" },
];

export function DeadlineEditor({
  open,
  deadline,
  courses,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Null while adding a date; an existing row while editing one. */
  deadline: SemesterDeadline | null;
  courses: Course[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const graded = deadline === null || deadline.kind === "academic_item";

  // Every way out of the dialog runs close(), so the transient state is reset there.
  function close() {
    setError(null);
    setConfirmingRemoval(false);
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const dueDate = String(form.get("due_date") || "");
    const dueTime = String(form.get("due_time") || "") || DEFAULT_DUE_TIME;
    const courseId = String(form.get("course_id") || "");
    if (!name || !dueDate) {
      setError("A name and a date are needed.");
      return;
    }
    const dueAt = new Date(`${dueDate}T${dueTime}`).toISOString();
    if (deadline === null && !courseId) {
      setError("Choose the course this date belongs to.");
      return;
    }
    const minutes = parseHours(form.get("hours"));
    if (minutes === "invalid") {
      setError("Enter the hours as a number, at least a quarter of an hour.");
      return;
    }
    const weight = parseWeight(form.get("weight_percent"));
    if (weight === "invalid") {
      setError("Enter the weight as a percentage between 0 and 100.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (deadline === null) {
        await apiRequest(`/courses/${courseId}/academic-items`, {
          method: "POST",
          body: JSON.stringify({
            item_type: String(form.get("item_type")),
            name,
            due_at: dueAt,
            direct_weight_percent: weight,
            estimated_minutes: minutes,
            // Saying how long the work takes is how work is activated; a bare date stays a
            // known deadline until the student sizes it on Today.
            activate: minutes !== null,
          }),
        });
      } else if (deadline.kind === "academic_item") {
        await apiRequest(`/academic-items/${deadline.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            item_type: String(form.get("item_type")),
            due_at: dueAt,
            direct_weight_percent: weight,
            ...(minutes === null ? {} : { estimated_minutes: minutes }),
          }),
        });
      } else {
        await apiRequest(`/tasks/${deadline.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            deadline_at: dueAt,
            ...(minutes === null ? {} : resizedTask(deadline, minutes)),
          }),
        });
      }
      window.dispatchEvent(new Event("donext:planning-updated"));
      await onSaved();
      close();
    } catch (saveError) {
      setError(messageFor(saveError, "DoNext could not save that date."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deadline) return;
    if (!confirmingRemoval) {
      setConfirmingRemoval(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = deadline.kind === "academic_item"
        ? `/academic-items/${deadline.id}`
        : `/tasks/${deadline.id}`;
      await apiRequest<void>(path, { method: "DELETE" });
      window.dispatchEvent(new Event("donext:planning-updated"));
      await onSaved();
      close();
    } catch (deleteError) {
      setError(messageFor(deleteError, "DoNext could not remove that date."));
    } finally {
      setBusy(false);
    }
  }

  const course = deadline?.course_id
    ? courses.find((option) => option.id === deadline.course_id) ?? null
    : null;
  const formKey = `${deadline?.id ?? "new"}:${open}`;

  return (
    <FormDialog
      open={open}
      title={deadline ? "Edit this date" : "Add an important date"}
      description={deadline
        ? "Changes here move the deadline and resize the work behind it."
        : "Dated course work counts toward the semester workload as soon as it is saved."}
      onClose={close}
    >
      <form className="onboarding-form deadline-form" key={formKey} onSubmit={submit} onChange={() => setError(null)}>
        <label>
          <span>What is it</span>
          <input name="name" defaultValue={deadline?.name ?? ""} placeholder="Assignment 2" required />
        </label>
        <div className={`form-row${graded ? " three-columns" : ""}`}>
          {deadline === null ? (
            <label>
              <span>Course</span>
              <select name="course_id" defaultValue={courses[0]?.id ?? ""} required>
                {courses.map((option) => (
                  <option key={option.id} value={option.id}>{option.code}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              <span>Course</span>
              <input value={course?.code ?? deadline.course_code ?? "Personal work"} readOnly />
            </label>
          )}
          {graded && (
            <>
              <label>
                <span>Kind</span>
                <select name="item_type" defaultValue={deadline?.item_type ?? "assignment"}>
                  {ITEM_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Weight</span>
                <input
                  name="weight_percent"
                  inputMode="decimal"
                  placeholder="% of grade"
                  defaultValue={deadline?.weight_percent == null ? "" : String(deadline.weight_percent)}
                />
              </label>
            </>
          )}
        </div>
        <div className="form-row three-columns">
          <label>
            <span>Due</span>
            <input
              name="due_date"
              type="date"
              defaultValue={deadline ? toDateInput(deadline.due_at) : ""}
              required
            />
          </label>
          <label>
            <span>Time</span>
            <input
              name="due_time"
              type="time"
              defaultValue={deadline ? toTimeInput(deadline.due_at) : DEFAULT_DUE_TIME}
            />
          </label>
          <label>
            <span>Hours of work</span>
            <input
              name="hours"
              inputMode="decimal"
              placeholder="Estimate"
              defaultValue={toHours(deadline?.estimated_minutes ?? null)}
            />
          </label>
        </div>
        {deadline && confirmingRemoval && (
          <p className="form-error" role="status">
            Removing this date also removes the work planned for it. Press remove again to confirm.
          </p>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions planner-dialog-actions">
          {deadline && (
            <button className="danger-button" disabled={busy} type="button" onClick={remove}>
              <Trash2 size={16} /> {confirmingRemoval ? "Remove for good" : "Remove"}
            </button>
          )}
          <button className="secondary-button" disabled={busy} type="button" onClick={close}>Cancel</button>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
            {busy ? "Saving" : deadline ? "Save date" : "Add date"}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}

/** Resizing keeps finished work finished, matching how the academic-item route resizes a task. */
function resizedTask(deadline: SemesterDeadline, minutes: number) {
  const done = Math.max((deadline.estimated_minutes ?? 0) - (deadline.remaining_minutes ?? 0), 0);
  return { estimated_minutes: minutes, remaining_minutes: Math.max(minutes - done, 0) };
}

function parseHours(value: FormDataEntryValue | null): number | null | "invalid" {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const hours = Number(raw);
  if (!Number.isFinite(hours)) return "invalid";
  const minutes = Math.round((hours * 60) / 5) * 5;
  return minutes >= 15 && minutes <= 10080 ? minutes : "invalid";
}

function parseWeight(value: FormDataEntryValue | null): number | null | "invalid" {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const weight = Number(raw);
  if (!Number.isFinite(weight) || weight < 0 || weight > 100) return "invalid";
  return weight;
}

function toHours(minutes: number | null) {
  if (minutes == null) return "";
  return String(Math.round((minutes / 60) * 100) / 100);
}

function toDateInput(value: string) {
  return localInput(value).slice(0, 10);
}

function toTimeInput(value: string) {
  return localInput(value).slice(11, 16);
}

function localInput(value: string) {
  const due = new Date(value);
  return new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function messageFor(cause: unknown, fallback: string) {
  return cause instanceof ApiRequestError ? cause.message : fallback;
}
