"use client";

import { Check, Circle, Clock3, Minus, MoreHorizontal, Pause } from "lucide-react";

import { agendaSummary, capitalize, formatMinutes, formatTime, isPast, isTickable } from "@/lib/today";
import type { PlanningEntry } from "@/lib/types";

export function DayChecklist({
  busy,
  entries,
  timezone,
  nextEntryId,
  onCheckIn,
  onEdit,
  onAdd,
}: {
  busy: boolean;
  entries: PlanningEntry[];
  timezone: string;
  nextEntryId: string | null;
  onCheckIn: (entry: PlanningEntry) => void;
  onEdit: (entry: PlanningEntry) => void;
  onAdd: () => void;
}) {
  return (
    <section className="day-checklist">
      <header className="section-heading">
        <div><h2>Today’s plan</h2><p>{agendaSummary(entries)}</p></div>
        <button className="text-button" type="button" onClick={onAdd}>Add block</button>
      </header>
      {entries.length ? (
        <div className="checklist-rows">
          {entries.map((entry) => (
            <ChecklistRow
              busy={busy}
              entry={entry}
              key={entry.id}
              next={entry.id === nextEntryId}
              timezone={timezone}
              onCheckIn={() => onCheckIn(entry)}
              onEdit={() => onEdit(entry)}
            />
          ))}
        </div>
      ) : (
        <div className="planner-empty"><Clock3 size={24} /><h3>Your day is open.</h3><p>Add a block or give unfinished work a place.</p><button className="secondary-button" type="button" onClick={onAdd}>Add time block</button></div>
      )}
    </section>
  );
}

function ChecklistRow({
  busy,
  entry,
  timezone,
  next,
  onCheckIn,
  onEdit,
}: {
  busy: boolean;
  entry: PlanningEntry;
  timezone: string;
  next: boolean;
  onCheckIn: () => void;
  onEdit: () => void;
}) {
  const tickable = isTickable(entry);
  const past = isPast(entry);
  const state = checkState(entry);
  return (
    <article className={`checklist-row ${past ? "past" : ""} ${state}`}>
      <div className="checklist-control">
        {tickable ? (
          <button
            aria-label={stateLabel(entry, state)}
            className={`check-button ${past && !entry.check_in_outcome ? "needs-answer" : ""}`}
            disabled={busy}
            type="button"
            onClick={onCheckIn}
          >
            {stateIcon(state)}
          </button>
        ) : <span className="fixed-marker" aria-label={past ? "Past fixed commitment" : "Fixed commitment"} />}
      </div>
      <time dateTime={entry.start_at}>{formatTime(entry.start_at, timezone)}</time>
      <div className="checklist-copy">
        <div>
          {next ? <span className="up-next-label">Up next</span> : null}
          <h3>{entry.title}</h3>
          <p>{entryDetail(entry, state)}</p>
        </div>
        <span className="duration"><Clock3 size={14} /> {formatMinutes(entry.planned_minutes)}</span>
      </div>
      {entry.editable ? (
        <button className="checklist-more" aria-label={`Edit ${entry.title}`} type="button" onClick={onEdit}>
          <MoreHorizontal size={18} />
        </button>
      ) : <span />}
    </article>
  );
}

function checkState(entry: PlanningEntry) {
  if (entry.timer_running) return "running";
  if (entry.check_in_outcome === "finished") return "finished";
  if (entry.check_in_outcome === "still_going") return "partial";
  if (entry.check_in_outcome === "not_started") return "not-started";
  return "upcoming";
}

function stateLabel(entry: PlanningEntry, state: string) {
  if (entry.goal_id) {
    return state === "finished"
      ? `Mark ${entry.title} incomplete`
      : `Mark ${entry.title} complete`;
  }
  if (state === "running") return `Stop timer for ${entry.title}`;
  if (state === "finished") return `Edit finished check-in for ${entry.title}`;
  if (state === "partial") return `Edit partial check-in for ${entry.title}`;
  if (state === "not-started") return `Edit missed check-in for ${entry.title}`;
  return `Check in for ${entry.title}`;
}

function stateIcon(state: string) {
  if (state === "running") return <Pause size={17} />;
  if (state === "finished") return <Check size={17} />;
  if (state === "partial") return <Minus size={17} />;
  if (state === "not-started") return <Circle size={15} />;
  return <Circle size={15} />;
}

function entryDetail(entry: PlanningEntry, state: string) {
  const context = entry.course_code || entry.location || capitalize(entry.category);
  const cadence = entry.recurring ? "Weekly" : entry.locked ? "Fixed" : "Scheduled";
  if (entry.goal_id && state === "finished") return `${context} · completed`;
  if (entry.goal_id && state === "partial") return `${context} · completion not confirmed`;
  if (entry.goal_id && state === "not-started") return `${context} · not completed`;
  if (state === "running") return `${context} · timer running`;
  if (state === "finished") return `${context} · finished · ${formatMinutes(entry.logged_minutes)} logged`;
  if (state === "partial") return `${context} · ${formatMinutes(entry.logged_minutes)} logged · still going`;
  if (state === "not-started") return `${context} · marked not started`;
  return `${context} · ${cadence}`;
}
