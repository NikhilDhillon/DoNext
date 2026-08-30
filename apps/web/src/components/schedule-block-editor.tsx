"use client";

import { LoaderCircle, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";

import { FormDialog } from "@/components/form-dialog";
import { useApiResource } from "@/hooks/use-api-resource";
import { apiRequest, ApiRequestError } from "@/lib/api";
import type {
  AvailabilityWindow,
  PlannerTask,
  PlanningEntry,
  ScheduleBlock,
} from "@/lib/types";

type ScheduleBlockEditorProps = {
  open: boolean;
  semesterId: string;
  date: string;
  tasks: PlannerTask[];
  entry: PlanningEntry | null;
  duplicateOf?: PlanningEntry | null;
  suggestedTask: PlannerTask | null;
  proposalId?: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

export function ScheduleBlockEditor({
  open,
  semesterId,
  date,
  tasks,
  entry,
  duplicateOf = null,
  suggestedTask,
  proposalId,
  onClose,
  onSaved,
}: ScheduleBlockEditorProps) {
  const availability = useApiResource<AvailabilityWindow[]>(open ? "/availability" : null);
  const defaults = useMemo(
    () => defaultTimes(date, availability.data ?? []),
    [availability.data, date],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setError(null);
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const taskId = String(form.get("task_id") || "") || null;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title: String(form.get("title")),
        task_id: taskId,
        fixed_event_id: taskId ? null : entry?.kind === "scheduled_block" ? null : undefined,
        goal_id: taskId ? null : (entry ?? duplicateOf)?.goal_id ?? null,
        start_at: new Date(String(form.get("start_at"))).toISOString(),
        end_at: new Date(String(form.get("end_at"))).toISOString(),
        block_type: String(form.get("block_type")),
        locked: form.get("locked") === "on",
      };
      const path = proposalId
        ? entry
          ? `/schedule-proposals/${proposalId}/blocks/${entry.source_id}`
          : `/schedule-proposals/${proposalId}/blocks`
        : entry
          ? `/schedule-blocks/${entry.source_id}`
          : `/semesters/${semesterId}/schedule/blocks`;
      await apiRequest<ScheduleBlock>(
        path,
        {
          method: entry ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      window.dispatchEvent(new Event("donext:planning-updated"));
      await onSaved();
      close();
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : "DoNext could not save that time block.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!entry) return;
    setBusy(true);
    setError(null);
    try {
      const path = proposalId
        ? `/schedule-proposals/${proposalId}/blocks/${entry.source_id}`
        : `/schedule-blocks/${entry.source_id}`;
      await apiRequest<void>(path, { method: "DELETE" });
      window.dispatchEvent(new Event("donext:planning-updated"));
      await onSaved();
      close();
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : "DoNext could not remove that time block.",
      );
    } finally {
      setBusy(false);
    }
  }

  const source = entry ?? duplicateOf;
  const startValue = source ? toDateTimeInput(source.start_at) : defaults.start;
  const endValue = source ? toDateTimeInput(source.end_at) : defaults.end;
  const selectedTaskId = source?.task_id ?? suggestedTask?.id ?? "";
  const title = source?.title ?? suggestedTask?.name ?? "";
  const formKey = `${entry?.id ?? duplicateOf?.id ?? "new"}:${suggestedTask?.id ?? "none"}:${date}:${defaults.start}:${open}`;

  return (
    <FormDialog
      open={open}
      title={entry ? "Adjust time block" : duplicateOf ? "Duplicate time block" : "Plan a time block"}
      description={duplicateOf
        ? "Choose a new time for this copy before adding it to the draft."
        : proposalId
          ? "Adjust this draft before accepting it."
          : "Choose the exact time yourself."}
      onClose={close}
    >
      <form className="onboarding-form planner-block-form" key={formKey} onSubmit={submit}>
        <label>
          <span>Title</span>
          <input name="title" defaultValue={title} placeholder="Focused work" required />
        </label>
        <label>
          <span>Linked task <small>Optional</small></span>
          <select name="task_id" defaultValue={selectedTaskId}>
            <option value="">No linked task</option>
            {entry?.task_id && !tasks.some((task) => task.id === entry.task_id) && (
              <option value={entry.task_id}>{entry.course_code ? `${entry.course_code} · ` : ""}{entry.title}</option>
            )}
            {tasks.map((task) => (
              <option value={task.id} key={task.id}>{task.course_code ? `${task.course_code} · ` : ""}{task.name}</option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            <span>Starts</span>
            <input name="start_at" type="datetime-local" defaultValue={startValue} required />
          </label>
          <label>
            <span>Ends</span>
            <input name="end_at" type="datetime-local" defaultValue={endValue} required />
          </label>
        </div>
        <div className="form-row">
          <label>
            <span>Type</span>
            <select name="block_type" defaultValue={source?.block_type ?? "focus"}>
              <option value="focus">Focused work</option>
              <option value="goal">Personal goal</option>
              <option value="commitment">Commitment</option>
              <option value="break">Break</option>
              <option value="personal">Personal</option>
            </select>
          </label>
          <label className="checkbox-field planner-lock-field">
            <input name="locked" type="checkbox" defaultChecked={source?.locked ?? false} />
            <span><strong>Keep this time fixed</strong><small>Future planning will work around it.</small></span>
          </label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions planner-dialog-actions">
          {entry && (
            <button className="danger-button" disabled={busy} type="button" onClick={remove}>
              <Trash2 size={16} /> Remove
            </button>
          )}
          <button className="secondary-button" disabled={busy} type="button" onClick={close}>Cancel</button>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
            {busy ? "Saving" : duplicateOf ? "Add copy" : "Save block"}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}

function toDateTimeInput(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function defaultTimes(dateValue: string, availability: AvailabilityWindow[]) {
  const now = new Date();
  const today = localDateValue(now);
  const weekdayIndex = (new Date(`${dateValue}T12:00:00Z`).getUTCDay() + 6) % 7;
  const firstWindow = availability
    .filter((window) => window.day_of_week === weekdayIndex && window.type !== "unavailable")
    .sort((first, second) => first.start_time.localeCompare(second.start_time))[0];
  const start = firstWindow
    ? new Date(`${dateValue}T${firstWindow.start_time.slice(0, 5)}:00`)
    : dateValue === today
      ? new Date(now)
      : new Date(`${dateValue}T09:00:00`);
  if (!firstWindow && dateValue === today) {
    start.setSeconds(0, 0);
    start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30);
  }
  const preferredEnd = new Date(start.getTime() + 50 * 60_000);
  const windowEnd = firstWindow
    ? new Date(`${dateValue}T${firstWindow.end_time.slice(0, 5)}:00`)
    : null;
  const end = windowEnd && windowEnd < preferredEnd ? windowEnd : preferredEnd;
  return { start: toDateTimeInput(start.toISOString()), end: toDateTimeInput(end.toISOString()) };
}

function localDateValue(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}
