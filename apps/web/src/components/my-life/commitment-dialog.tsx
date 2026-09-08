"use client";

import { CalendarClock, LoaderCircle, Plus, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { FormDialog } from "@/components/form-dialog";
import { apiRequest, ApiRequestError } from "@/lib/api";
import {
  COMMITMENT_CATEGORIES,
  COMMITMENT_DURATIONS,
  fixedEventPayloads,
  formatMinutes,
  parseWeeklyRecurrence,
  PRIORITIES,
  todayInTimezone,
  WEEKDAYS,
  weeklyRecurrenceRule,
} from "@/lib/commitments";
import type { FixedCommitmentDraft } from "@/lib/commitments";
import type { FixedEvent, Goal } from "@/lib/types";

type EditTarget =
  | { kind: "fixed"; event: FixedEvent }
  | { kind: "flexible"; goal: Goal }
  | null;

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  timezone: string;
  semesterId: string | null;
  semesterEndDate: string | null;
  editing: EditTarget;
};

type PlanningMode = "fixed" | "flexible";
type FixedShape = "one_time" | "routine";
type EndMode = "ongoing" | "end_date" | "semester";
type Cadence = "weekly" | "selected_days";

const DURATION_VALUES = COMMITMENT_DURATIONS.map(([value]) => Number(value));

function durationForMinutes(minutes: number): number {
  return DURATION_VALUES.includes(minutes) ? minutes : 60;
}

export function CommitmentDialog({
  open,
  onClose,
  onSaved,
  timezone,
  semesterId,
  semesterEndDate,
  editing,
}: Props) {
  const today = todayInTimezone(timezone);
  const editingFixed = editing?.kind === "fixed" ? editing.event : null;
  const editingFlexible = editing?.kind === "flexible" ? editing.goal : null;
  const editingRecurrence = editingFixed ? parseWeeklyRecurrence(editingFixed.recurrence_rule) : null;

  const initialMode: PlanningMode = editingFlexible ? "flexible" : "fixed";
  const initialShape: FixedShape = editingFixed && !editingRecurrence ? "one_time" : "routine";
  const initialDuration = editingFixed
    ? durationForMinutes(
        Math.round(
          (new Date(editingFixed.end_at).getTime() - new Date(editingFixed.start_at).getTime()) / 60_000,
        ),
      )
    : 60;
  const initialStartTime = editingFixed
    ? new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: timezone,
      }).format(new Date(editingFixed.start_at))
    : "17:00";
  const initialWeekdays = editingRecurrence?.weekdays ?? (editingFixed ? [] : [0, 2, 4]);
  const initialEndMode: EndMode = editingRecurrence?.until ? "end_date" : "ongoing";
  const initialOneTimeDate = editingFixed && !editingRecurrence
    ? new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(editingFixed.start_at))
    : today;

  const flexRule = editingFlexible?.schedule_rule ?? null;

  const [mode, setMode] = useState<PlanningMode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(editingFixed && (editingFixed.commute_before_minutes || editingFixed.commute_after_minutes)),
  );

  // Fixed-commitment state
  const [shape, setShape] = useState<FixedShape>(initialShape);
  const [name, setName] = useState(editingFixed?.title ?? "");
  const [category, setCategory] = useState(editingFixed?.category ?? "work");
  const [priority, setPriority] = useState<string>(editingFixed?.priority ?? "medium");
  const [weekdays, setWeekdays] = useState<number[]>(initialWeekdays);
  const [startTime, setStartTime] = useState(initialStartTime);
  const [durationMinutes, setDurationMinutes] = useState(initialDuration);
  const [oneTimeDate, setOneTimeDate] = useState(initialOneTimeDate);
  const [location, setLocation] = useState(editingFixed?.location ?? "");
  const [commuteBefore, setCommuteBefore] = useState(editingFixed?.commute_before_minutes ?? 0);
  const [commuteAfter, setCommuteAfter] = useState(editingFixed?.commute_after_minutes ?? 0);
  const [endMode, setEndMode] = useState<EndMode>(initialEndMode);
  const [endDate, setEndDate] = useState(editingRecurrence?.until ?? semesterEndDate ?? "");

  // Flexible-commitment state
  const [flexName, setFlexName] = useState(editingFlexible?.name ?? "");
  const [flexCategory, setFlexCategory] = useState(editingFlexible?.category ?? "gym");
  const [flexPriority, setFlexPriority] = useState<string>(editingFlexible?.priority ?? "medium");
  const [cadence, setCadence] = useState<Cadence>(flexRule?.cadence ?? "weekly");
  const [flexDays, setFlexDays] = useState<number[]>(
    flexRule?.cadence === "selected_days" ? flexRule.days_of_week : [],
  );
  const [flexHours, setFlexHours] = useState(
    flexRule ? (flexRule.target_minutes / 60).toString() : "1",
  );

  const dialogTitle = editingFixed
    ? "Edit commitment"
    : editingFlexible
      ? "Edit flexible commitment"
      : "Add commitment";
  const dialogDescription = editing
    ? "Changes apply to the whole series."
    : "Something that needs time outside classes.";

  function toggleWeekday(index: number, list: number[], set: (next: number[]) => void) {
    set(
      list.includes(index)
        ? list.filter((day) => day !== index)
        : [...list, index].sort((left, right) => left - right),
    );
  }

  const resolvedEndDate = useMemo(() => {
    if (shape === "one_time") return null;
    if (endMode === "ongoing") return null;
    if (endMode === "semester") return semesterEndDate;
    return endDate || null;
  }, [shape, endMode, endDate, semesterEndDate]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (mode === "flexible") {
      const hours = Number(flexHours);
      const targetMinutes = Math.round(hours * 60);
      if (!Number.isFinite(targetMinutes) || targetMinutes <= 0 || targetMinutes % 15 !== 0) {
        setError("Enter the time target in 15-minute increments.");
        return;
      }
      if (cadence === "selected_days" && flexDays.length === 0) {
        setError("Select at least one weekday for this commitment.");
        return;
      }
      const scheduleRule =
        cadence === "selected_days"
          ? { cadence: "selected_days" as const, target_minutes: targetMinutes, days_of_week: flexDays }
          : { cadence: "weekly" as const, target_minutes: targetMinutes };
      const body = {
        name: flexName.trim(),
        category: flexCategory,
        priority: flexPriority,
        planning_kind: "flexible_commitment" as const,
        schedule_rule: scheduleRule,
      };
      setBusy(true);
      try {
        if (editingFlexible) {
          await apiRequest<Goal>(`/goals/${editingFlexible.id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          });
        } else {
          await apiRequest<Goal>("/goals", {
            method: "POST",
            body: JSON.stringify({ ...body, start_date: today, semester_id: semesterId }),
          });
        }
        await onSaved();
        onClose();
      } catch (requestError) {
        setError(messageFor(requestError, "Could not save this commitment."));
      } finally {
        setBusy(false);
      }
      return;
    }

    // Fixed commitment
    if (!name.trim()) {
      setError("Give this commitment a name.");
      return;
    }
    if (resolvedEndDate && resolvedEndDate < today) {
      setError("The end date must be in the future.");
      return;
    }
    const activeWeekdays = shape === "one_time" ? [weekdayOf(oneTimeDate)] : weekdays;
    if (shape === "routine" && weekdays.length === 0) {
      setError("Select at least one weekday for this routine.");
      return;
    }

    const draft: FixedCommitmentDraft = {
      title: name,
      category,
      priority,
      location: location || null,
      commuteBeforeMinutes: commuteBefore,
      commuteAfterMinutes: commuteAfter,
      repeats: shape === "routine",
      endDate: resolvedEndDate,
      oneTimeDate: shape === "one_time" ? oneTimeDate : null,
      days: activeWeekdays.map((weekday) => ({ weekday, startTime, durationMinutes })),
    };

    setBusy(true);
    try {
      if (editingFixed) {
        const recurrenceRule =
          shape === "routine" ? weeklyRecurrenceRule(weekdays, resolvedEndDate) : null;
        const [payload] = fixedEventPayloads(draft, timezone, editingFixed.semester_id, today);
        await apiRequest<FixedEvent>(`/events/${editingFixed.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: payload.title,
            category: payload.category,
            priority: payload.priority,
            start_at: payload.start_at,
            end_at: payload.end_at,
            recurrence_rule: recurrenceRule,
            location: payload.location,
            commute_before_minutes: payload.commute_before_minutes,
            commute_after_minutes: payload.commute_after_minutes,
          }),
        });
      } else {
        const payloads = fixedEventPayloads(draft, timezone, semesterId, today);
        for (const payload of payloads) {
          await apiRequest<FixedEvent>("/events", { method: "POST", body: JSON.stringify(payload) });
        }
      }
      await onSaved();
      onClose();
    } catch (requestError) {
      setError(messageFor(requestError, "Could not save this commitment."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog open={open} onClose={onClose} title={dialogTitle} description={dialogDescription} wide>
      <form className="stacked-form commitment-dialog-form" onSubmit={submit}>
        {!editing ? (
          <fieldset className="commitment-mode-picker">
            <legend>Who sets the times?</legend>
            <label>
              <input
                checked={mode === "fixed"}
                name="mode"
                type="radio"
                value="fixed"
                onChange={() => setMode("fixed")}
              />
              <span>
                <CalendarClock size={18} />
                <span>
                  <strong>I&rsquo;ll set the times</strong>
                  <small>Appointments and weekly routines placed on your calendar.</small>
                </span>
              </span>
            </label>
            <label>
              <input
                checked={mode === "flexible"}
                name="mode"
                type="radio"
                value="flexible"
                onChange={() => setMode("flexible")}
              />
              <span>
                <Sparkles size={18} />
                <span>
                  <strong>Let DoNext schedule it</strong>
                  <small>A weekly time target DoNext fits into your drafts.</small>
                </span>
              </span>
            </label>
          </fieldset>
        ) : null}

        {mode === "fixed" ? (
          <>
            <label>
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder="Work shift, physio, rehearsal"
                required
              />
            </label>
            <div className="form-row">
              <label>
                <span>Category</span>
                <select value={category} onChange={(event) => setCategory(event.currentTarget.value)}>
                  {COMMITMENT_CATEGORIES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Priority</span>
                <select value={priority} onChange={(event) => setPriority(event.currentTarget.value)}>
                  {PRIORITIES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <fieldset className="commitment-shape-picker">
              <legend>How often</legend>
              <label>
                <input
                  checked={shape === "one_time"}
                  name="shape"
                  type="radio"
                  onChange={() => setShape("one_time")}
                />
                <span>One-time appointment</span>
              </label>
              <label>
                <input
                  checked={shape === "routine"}
                  name="shape"
                  type="radio"
                  onChange={() => setShape("routine")}
                />
                <span>Weekly routine</span>
              </label>
            </fieldset>

            {shape === "one_time" ? (
              <div className="form-row">
                <label>
                  <span>Date</span>
                  <input
                    type="date"
                    value={oneTimeDate}
                    min={today}
                    onChange={(event) => setOneTimeDate(event.currentTarget.value)}
                    required
                  />
                </label>
                <label>
                  <span>Starts</span>
                  <input
                    type="time"
                    value={startTime}
                    step="900"
                    onChange={(event) => setStartTime(event.currentTarget.value)}
                    required
                  />
                </label>
              </div>
            ) : (
              <>
                <fieldset className="class-day-picker">
                  <legend>Repeats on</legend>
                  {WEEKDAYS.map((day, index) => (
                    <label key={day}>
                      <input
                        checked={weekdays.includes(index)}
                        type="checkbox"
                        onChange={() => toggleWeekday(index, weekdays, setWeekdays)}
                      />
                      <span>{day.slice(0, 3)}</span>
                    </label>
                  ))}
                </fieldset>
                <div className="form-row">
                  <label>
                    <span>Starts</span>
                    <input
                      type="time"
                      value={startTime}
                      step="900"
                      onChange={(event) => setStartTime(event.currentTarget.value)}
                      required
                    />
                  </label>
                  <label>
                    <span>Ends</span>
                    <select
                      value={endMode}
                      onChange={(event) => setEndMode(event.currentTarget.value as EndMode)}
                    >
                      <option value="ongoing">Ongoing</option>
                      <option value="end_date">On a date</option>
                      {semesterEndDate ? <option value="semester">End of semester</option> : null}
                    </select>
                  </label>
                </div>
                {endMode === "end_date" ? (
                  <label>
                    <span>End date</span>
                    <input
                      type="date"
                      value={endDate}
                      min={today}
                      onChange={(event) => setEndDate(event.currentTarget.value)}
                      required
                    />
                  </label>
                ) : null}
              </>
            )}

            <label>
              <span>Duration</span>
              <select
                value={durationMinutes}
                onChange={(event) => setDurationMinutes(Number(event.currentTarget.value))}
              >
                {COMMITMENT_DURATIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className="link-button"
              onClick={() => setAdvancedOpen((current) => !current)}
            >
              {advancedOpen ? "Hide" : "Show"} location and commute buffers
            </button>
            {advancedOpen ? (
              <>
                <label>
                  <span>
                    Location <small>Optional</small>
                  </span>
                  <input
                    value={location}
                    onChange={(event) => setLocation(event.currentTarget.value)}
                    placeholder="Campus gym"
                  />
                </label>
                <div className="form-row">
                  <label>
                    <span>Commute before</span>
                    <select
                      value={commuteBefore}
                      onChange={(event) => setCommuteBefore(Number(event.currentTarget.value))}
                    >
                      {[0, 10, 15, 20, 30, 45, 60].map((value) => (
                        <option key={value} value={value}>
                          {value === 0 ? "None" : formatMinutes(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Commute after</span>
                    <select
                      value={commuteAfter}
                      onChange={(event) => setCommuteAfter(Number(event.currentTarget.value))}
                    >
                      {[0, 10, 15, 20, 30, 45, 60].map((value) => (
                        <option key={value} value={value}>
                          {value === 0 ? "None" : formatMinutes(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            ) : null}
          </>
        ) : (
          <>
            <label>
              <span>Name</span>
              <input
                value={flexName}
                onChange={(event) => setFlexName(event.currentTarget.value)}
                placeholder="Gym, language practice, side project"
                required
              />
            </label>
            <div className="form-row">
              <label>
                <span>Category</span>
                <select
                  value={flexCategory}
                  onChange={(event) => setFlexCategory(event.currentTarget.value)}
                >
                  {COMMITMENT_CATEGORIES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Priority</span>
                <select
                  value={flexPriority}
                  onChange={(event) => setFlexPriority(event.currentTarget.value)}
                >
                  {PRIORITIES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="flexible-cadence-picker">
              <legend>How should the time add up?</legend>
              <label>
                <input
                  checked={cadence === "weekly"}
                  type="radio"
                  name="cadence"
                  onChange={() => setCadence("weekly")}
                />
                <span>
                  <strong>Hours per week</strong>
                  <small>DoNext spreads the time across available days.</small>
                </span>
              </label>
              <label>
                <input
                  checked={cadence === "selected_days"}
                  type="radio"
                  name="cadence"
                  onChange={() => setCadence("selected_days")}
                />
                <span>
                  <strong>Hours per selected weekday</strong>
                  <small>Keep the target on specific days.</small>
                </span>
              </label>
            </fieldset>
            {cadence === "selected_days" ? (
              <fieldset className="class-day-picker">
                <legend>Schedule on</legend>
                {WEEKDAYS.map((day, index) => (
                  <label key={day}>
                    <input
                      checked={flexDays.includes(index)}
                      type="checkbox"
                      onChange={() => toggleWeekday(index, flexDays, setFlexDays)}
                    />
                    <span>{day.slice(0, 3)}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <label>
              <span>{cadence === "weekly" ? "Hours each week" : "Hours on each selected day"}</span>
              <input
                type="number"
                min="0.25"
                max={cadence === "weekly" ? "40" : "12"}
                step="0.25"
                value={flexHours}
                onChange={(event) => setFlexHours(event.currentTarget.value)}
                required
              />
              <small>Use 15-minute increments.</small>
            </label>
            <div className="flexible-draft-note">
              <Sparkles size={18} />
              <span>
                <strong>Nothing is added to your calendar yet.</strong>
                <small>DoNext proposes times in your next draft. Review and accept it first.</small>
              </span>
            </div>
          </>
        )}

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}
            {editing ? "Save changes" : "Add commitment"}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}

function weekdayOf(dateValue: string): number {
  const date = new Date(`${dateValue}T12:00:00Z`);
  return (date.getUTCDay() + 6) % 7;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}
