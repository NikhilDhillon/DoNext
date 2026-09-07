"use client";

import { LoaderCircle, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./schedule-block-editor.css";

import { focusIntervalsForDate } from "@/components/draft-calendar/lib";
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
          ? "Choose one day and a time within your saved focus hours. Saved to this draft until you accept it."
          : "Choose the exact time yourself."}
      onClose={close}
    >
      <form className="onboarding-form planner-block-form" key={formKey} onSubmit={submit} onChange={() => setError(null)}>
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
        {proposalId ? (
          <DraftBlockTimes
            key={formKey}
            startValue={startValue}
            endValue={endValue}
            availability={availability.data}
            availabilityError={availability.error}
          />
        ) : <div className="form-row">
          <label>
            <span>Starts</span>
            <input name="start_at" type="datetime-local" defaultValue={startValue} required />
          </label>
          <label>
            <span>Ends</span>
            <input name="end_at" type="datetime-local" defaultValue={endValue} required />
          </label>
        </div>}
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

function DraftBlockTimes({ startValue, endValue, availability, availabilityError }: {
  startValue: string;
  endValue: string;
  availability: AvailabilityWindow[] | null;
  availabilityError: string | null;
}) {
  const [day, setDay] = useState(startValue.slice(0, 10));
  const [start, setStart] = useState(startValue.slice(11, 16));
  const [end, setEnd] = useState(endValue.slice(11, 16));
  const intervals = day ? focusIntervalsForDate(day, availability ?? []) : [];
  const startMinute = minutesOfDay(start);
  const endMinute = end === "00:00" ? 1440 : minutesOfDay(end);
  const duration = endMinute - startMinute;
  const complete = Boolean(day && start && end);
  const validation = availabilityError
    ? "Focus hours could not load. Reopen this form to try again."
    : !availability
      ? "Wait for your focus hours to load."
      : !complete
        ? "Choose a date, start time, and end time."
        : duration <= 0
          ? "End time must be later than start time on this day."
          : !intervals.some(([from, to]) => from <= startMinute && endMinute <= to)
            ? intervals.length
              ? "Choose a start and end within one of the focus windows above."
              : "No focus hours on this day. Choose another date or update your focus hours in Settings."
            : "";
  const nextDay = day ? new Date(`${day}T12:00:00`) : null;
  nextDay?.setDate(nextDay.getDate() + 1);
  const endDay = end === "00:00" && nextDay ? localDateValue(nextDay) : day;

  return (
    <fieldset className="block-time-fields">
      <legend>When</legend>
      <label>
        <span>Date <small>One day only</small></span>
        <input name="block_date" type="date" value={day} onChange={(event) => setDay(event.target.value)} required aria-describedby="block-focus-hours" />
      </label>
      <p className="block-focus-hours" id="block-focus-hours" aria-live="polite">
        {availabilityError ? "Saved focus hours are unavailable." : !availability ? "Loading saved focus hours…" : !day ? "Choose a date to see your focus hours." : intervals.length
          ? `Focus hours: ${intervals.map(([from, to]) => `${formatClock(from)}–${formatClock(to)}`).join(" · ")}`
          : "No saved focus hours for this day."}
      </p>
      <div className="form-row">
        <label>
          <span>Start time</span>
          <input name="block_start_time" type="time" value={start} onChange={(event) => setStart(event.target.value)} required aria-describedby="block-focus-hours block-time-summary" />
        </label>
        <label>
          <span>End time</span>
          <input name="block_end_time" type="time" value={end} onChange={(event) => setEnd(event.target.value)} required
            ref={(input) => { input?.setCustomValidity(validation); }}
            aria-invalid={Boolean(validation && availability && complete)} aria-describedby="block-focus-hours block-time-summary" />
        </label>
      </div>
      <p className={`block-time-summary${validation && availability ? " invalid" : ""}`} id="block-time-summary" aria-live="polite">
        {validation || `${formatDuration(duration)} · ${end === "00:00" ? "Ends at midnight, at the end of this day." : "Starts and ends on the selected day."}`}
      </p>
      <input name="start_at" type="hidden" value={`${day}T${start}`} />
      <input name="end_at" type="hidden" value={`${endDay}T${end}`} />
    </fieldset>
  );
}

function minutesOfDay(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatClock(minutes: number) {
  if (minutes === 1440) return "midnight";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours % 12 || 12}${remainder ? `:${String(remainder).padStart(2, "0")}` : ""} ${hours < 12 ? "AM" : "PM"}`;
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours} hr` : "", remainder ? `${remainder} min` : ""].filter(Boolean).join(" ");
}

function toDateTimeInput(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function defaultTimes(dateValue: string, availability: AvailabilityWindow[]) {
  const now = new Date();
  const today = localDateValue(now);
  const firstWindow = focusIntervalsForDate(dateValue, availability)[0];
  const start = firstWindow
    ? new Date(`${dateValue}T00:00:00`)
    : dateValue === today
      ? new Date(now)
      : new Date(`${dateValue}T09:00:00`);
  if (firstWindow) start.setMinutes(firstWindow[0]);
  if (!firstWindow && dateValue === today) {
    start.setSeconds(0, 0);
    start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30);
  }
  const preferredEnd = new Date(start.getTime() + 50 * 60_000);
  const windowEnd = firstWindow
    ? new Date(`${dateValue}T00:00:00`)
    : null;
  if (windowEnd && firstWindow) windowEnd.setMinutes(firstWindow[1]);
  const end = windowEnd && windowEnd < preferredEnd ? windowEnd : preferredEnd;
  return { start: toDateTimeInput(start.toISOString()), end: toDateTimeInput(end.toISOString()) };
}

function localDateValue(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}
