"use client";

import { CalendarPlus, Check, CircleAlert, LoaderCircle, Plus, Undo2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { useApiResource } from "@/hooks/use-api-resource";
import { apiRequest, ApiRequestError } from "@/lib/api";
import type { ActivationPrompt, Course, DirectPlacement, Semester } from "@/lib/types";

type WorkIntakeProps = {
  semester: Semester;
  onChanged: () => Promise<void> | void;
};

type NewWorkKind = "assignment" | "quiz" | "midterm" | "final_exam" | "project";

const KIND_LABELS: Record<NewWorkKind, string> = {
  assignment: "Assignment",
  project: "Project",
  quiz: "Quiz",
  midterm: "Midterm",
  final_exam: "Final",
};

/**
 * The intake surface. Work reaches the calendar when the student says it exists, so this is
 * where they say so: activate a deadline DoNext already knows about, or enter something the
 * course outline never contained. Nothing here blocks plan generation.
 */
export function WorkIntake({ semester, onChanged }: WorkIntakeProps) {
  const queue = useApiResource<ActivationPrompt[]>(`/semesters/${semester.id}/activation-queue`);
  const courses = useApiResource<Course[]>(`/semesters/${semester.id}/courses`);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const prompts = useMemo(() => queue.data ?? [], [queue.data]);
  const waiting = useMemo(() => prompts.filter((prompt) => !prompt.activated), [prompts]);
  const answered = useMemo(() => prompts.filter((prompt) => prompt.activated), [prompts]);
  const urgentCount = useMemo(
    () => waiting.filter((prompt) => prompt.urgent).length,
    [waiting],
  );

  async function refresh() {
    await Promise.all([queue.reload(), onChanged()]);
  }

  // Activating is only half the job: work that fits the time the plan is not already using
  // should land without a review ceremony, or entering work stops being worth the friction.
  async function place(taskId: string, label: string) {
    try {
      const placement = await apiRequest<DirectPlacement>(
        `/semesters/${semester.id}/schedule/direct-placement`,
        { method: "POST", body: JSON.stringify({ task_id: taskId }) },
      );
      setOutcome(
        placement.placed
          ? `${label} is on your schedule. ${placement.reason}`
          : `${label} is activated but not placed. ${placement.reason}`,
      );
    } catch (placementError) {
      setOutcome(
        `${label} is activated. Regenerate your plan to give it time. ` +
          (placementError instanceof ApiRequestError ? placementError.message : ""),
      );
    }
  }

  async function activate(prompt: ActivationPrompt, hours: string) {
    const minutes = Math.round(Number(hours) * 12) * 5;
    if (hours.trim() && (!Number.isFinite(minutes) || minutes < 15)) {
      setError("Enter at least a quarter of an hour, or leave it blank to use the estimate.");
      return;
    }
    setBusyItem(prompt.academic_item_id);
    setError(null);
    setOutcome(null);
    try {
      await apiRequest(`/academic-items/${prompt.academic_item_id}/activation`, {
        method: "PUT",
        body: JSON.stringify(
          hours.trim() ? { decision: "student", minutes } : { decision: "use_default" },
        ),
      });
      await place(prompt.task_id, prompt.name);
      await refresh();
    } catch (activationError) {
      setError(
        activationError instanceof ApiRequestError
          ? activationError.message
          : "That could not be activated.",
      );
    } finally {
      setBusyItem(null);
    }
  }

  // Work entered by mistake, or withdrawn by the course, goes back to being a known deadline.
  // The estimate is kept, so activating it again does not ask the same question twice.
  async function deactivate(prompt: ActivationPrompt) {
    setBusyItem(prompt.academic_item_id);
    setError(null);
    setOutcome(null);
    try {
      await apiRequest(`/academic-items/${prompt.academic_item_id}/activation`, {
        method: "DELETE",
      });
      setOutcome(
        `${prompt.name} is back to a known deadline. Regenerate your plan to release the time it holds.`,
      );
      await refresh();
    } catch (deactivationError) {
      setError(
        deactivationError instanceof ApiRequestError
          ? deactivationError.message
          : "That could not be moved back.",
      );
    } finally {
      setBusyItem(null);
    }
  }

  return (
    <section className="intake-card" aria-label="Work intake">
      <header className="intake-header">
        <div>
          <p className="eyebrow">What just landed</p>
          <h2>Tell DoNext what you have been given.</h2>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setComposing((open) => !open);
            setError(null);
            setOutcome(null);
          }}
        >
          {composing ? <X size={16} /> : <Plus size={16} />}
          {composing ? "Close" : "Add work"}
        </button>
      </header>

      {composing ? (
        <NewWorkForm
          courses={courses.data ?? []}
          onCancel={() => setComposing(false)}
          onCreated={async (taskId, label) => {
            setComposing(false);
            await place(taskId, label);
            await refresh();
          }}
          onError={setError}
        />
      ) : null}

      {outcome ? (
        <p className="planner-alert info" role="status">
          <Check size={15} /> {outcome}
        </p>
      ) : null}
      {error ? (
        <p className="planner-alert error" role="alert">
          <CircleAlert size={15} /> {error}
        </p>
      ) : null}

      {queue.loading && !queue.data ? (
        <p className="planner-quiet">
          <LoaderCircle className="spin" size={15} /> Checking what is waiting
        </p>
      ) : (
        <>
          {waiting.length ? (
            <>
              <p className="intake-summary">
                {waiting.length} {waiting.length === 1 ? "deadline is" : "deadlines are"} in view
                with no time booked
                {urgentCount ? ` · ${urgentCount} running out of room` : ""}.
              </p>
              <ul className="intake-queue">
                {waiting.map((prompt) => (
                  <ActivationRow
                    busy={busyItem === prompt.academic_item_id}
                    key={prompt.academic_item_id}
                    prompt={prompt}
                    onActivate={(hours) => activate(prompt, hours)}
                  />
                ))}
              </ul>
            </>
          ) : (
            <p className="planner-quiet">
              Every deadline DoNext knows about in the next two weeks has an answer.
            </p>
          )}

          {answered.length ? (
            <>
              <p className="intake-summary answered">
                Holding time in your plan · say so if any of these are not really out.
              </p>
              <ul className="intake-queue">
                {answered.map((prompt) => (
                  <li className="intake-row answered" key={prompt.academic_item_id}>
                    <div className="intake-row-copy">
                      <span>
                        {prompt.course_code || "Course"} ·{" "}
                        {KIND_LABELS[prompt.item_type as NewWorkKind] || "Work"}
                      </span>
                      <strong>{prompt.name}</strong>
                      <small>
                        Due {formatDate(prompt.due_at)} ·{" "}
                        {formatMinutes(prompt.fallback_minutes)} left
                        {prompt.estimate_is_fallback ? " (estimated for you)" : " (your estimate)"}
                      </small>
                    </div>
                    <button
                      className="secondary-button"
                      disabled={busyItem === prompt.academic_item_id}
                      type="button"
                      onClick={() => void deactivate(prompt)}
                    >
                      {busyItem === prompt.academic_item_id ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : (
                        <Undo2 size={15} />
                      )}
                      Not out yet
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

function ActivationRow({
  prompt,
  busy,
  onActivate,
}: {
  prompt: ActivationPrompt;
  busy: boolean;
  onActivate: (hours: string) => Promise<void>;
}) {
  const [hours, setHours] = useState("");
  return (
    <li className={prompt.urgent ? "intake-row urgent" : "intake-row"}>
      <div className="intake-row-copy">
        <span>
          {prompt.course_code || "Course"} · {KIND_LABELS[prompt.item_type as NewWorkKind] || "Work"}
        </span>
        <strong>{prompt.name}</strong>
        <small>
          Due {formatDate(prompt.due_at)} · {formatMinutes(prompt.capacity_before_due_minutes)} of
          focus time left before then
          {prompt.urgent ? ` · less than the ${formatMinutes(prompt.fallback_minutes)} this usually takes` : ""}
        </small>
      </div>
      <label className="intake-hours">
        <span className="sr-only">Hours for {prompt.name}</span>
        <input
          inputMode="decimal"
          placeholder={(prompt.fallback_minutes / 60).toFixed(1)}
          value={hours}
          onChange={(event) => setHours(event.target.value)}
        />
        <em>hrs</em>
      </label>
      <button
        className="primary-button"
        disabled={busy}
        type="button"
        onClick={() => void onActivate(hours)}
      >
        {busy ? <LoaderCircle className="spin" size={15} /> : <CalendarPlus size={15} />}
        It is out
      </button>
    </li>
  );
}

function NewWorkForm({
  courses,
  onCreated,
  onCancel,
  onError,
}: {
  courses: Course[];
  onCreated: (taskId: string, label: string) => Promise<void>;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [kind, setKind] = useState<NewWorkKind>("assignment");
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  // Course work is due at the end of its day unless the student says otherwise.
  const [dueTime, setDueTime] = useState("23:59");
  const [hours, setHours] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!courseId || !name.trim() || !dueDate) {
      onError("A course, a name, and a deadline are needed.");
      return;
    }
    const minutes = hours.trim() ? Math.round(Number(hours) * 12) * 5 : null;
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 15)) {
      onError("Enter at least a quarter of an hour, or leave it blank to use the estimate.");
      return;
    }
    setSaving(true);
    try {
      const created = await apiRequest<{ task_id: string | null; name: string }>(
        `/courses/${courseId}/academic-items`,
        {
          method: "POST",
          body: JSON.stringify({
            item_type: kind,
            name: name.trim(),
            due_at: new Date(`${dueDate}T${dueTime || "23:59"}`).toISOString(),
            activate: true,
            estimated_minutes: minutes,
          }),
        },
      );
      if (created.task_id) await onCreated(created.task_id, created.name);
    } catch (createError) {
      onError(
        createError instanceof ApiRequestError ? createError.message : "That could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="intake-form">
      <label>
        <span>Course</span>
        <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.code}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Kind</span>
        <select value={kind} onChange={(event) => setKind(event.target.value as NewWorkKind)}>
          {(Object.keys(KIND_LABELS) as NewWorkKind[]).map((value) => (
            <option key={value} value={value}>
              {KIND_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="intake-form-wide">
        <span>What is it</span>
        <input
          placeholder="Assignment 2"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        <span>Due</span>
        <input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />
      </label>
      <label>
        <span>Time</span>
        <input
          type="time"
          value={dueTime}
          onChange={(event) => setDueTime(event.target.value)}
        />
      </label>
      <label>
        <span>Hours</span>
        <input
          inputMode="decimal"
          placeholder="Estimate"
          value={hours}
          onChange={(event) => setHours(event.target.value)}
        />
      </label>
      <div className="intake-form-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" disabled={saving} type="button" onClick={() => void submit()}>
          {saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
          Add it
        </button>
      </div>
    </div>
  );
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric" }).format(
    new Date(value),
  );
}
