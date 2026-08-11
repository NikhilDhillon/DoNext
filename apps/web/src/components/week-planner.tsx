"use client";

import { ChevronLeft, ChevronRight, LoaderCircle, Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { ScheduleBlockEditor } from "@/components/schedule-block-editor";
import { ScheduleProposalReview } from "@/components/schedule-proposal-review";
import { useApiResource } from "@/hooks/use-api-resource";
import type { PlannerTask, PlanningEntry, PlanningView, Semester } from "@/lib/types";

export function WeekPlanner() {
  const [path, setPath] = useState("/planning/week");
  const plan = useApiResource<PlanningView>(path);
  const semesters = useApiResource<Semester[]>("/semesters");
  const currentSemester = useMemo(
    () => semesters.data?.find((semester) => semester.status === "active") ?? semesters.data?.[0] ?? null,
    [semesters.data],
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<PlanningEntry | null>(null);
  const [suggestedTask, setSuggestedTask] = useState<PlannerTask | null>(null);
  const [editorDate, setEditorDate] = useState("");

  if ((plan.loading || semesters.loading) && !plan.data) return <WeekState loading message="Building your real week" />;
  if (plan.error || semesters.error) return <WeekState message={plan.error || semesters.error || "The week could not load."} onRetry={plan.reload} />;
  if (!plan.data) return <WeekState loading message="Loading your week" />;

  const data = plan.data;
  const days = data.days;
  const commitmentMinutes = entryMinutes(data.entries.filter((entry) => entry.kind === "fixed_event" || entry.block_type === "commitment"));
  const focusMinutes = entryMinutes(data.entries.filter((entry) => entry.block_type === "focus"));
  const goalMinutes = entryMinutes(data.entries.filter((entry) => entry.block_type === "goal" || entry.block_type === "personal"));
  const openMinutes = days.reduce((total, day) => total + day.capacity.remaining_focus_minutes, 0);
  const { startHour, endHour } = calendarBounds(data.entries, data.timezone);
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const rows = (endHour - startHour) * 2;

  function moveWeek(offset: number) {
    setPath(`/planning/week?start=${addDays(data.start_date, offset * 7)}`);
  }

  function openNew(date: string, task: PlannerTask | null = null) {
    setSelectedEntry(null);
    setSuggestedTask(task);
    setEditorDate(date);
    setEditorOpen(true);
  }

  function openEntry(entry: PlanningEntry) {
    if (!entry.editable) return;
    setSelectedEntry(entry);
    setSuggestedTask(null);
    setEditorDate(dateInTimezone(entry.start_at, data.timezone));
    setEditorOpen(true);
  }

  return (
    <main className="page-shell week-page">
      <header className="page-heading week-heading">
        <div>
          <p className="eyebrow">{formatDateRange(data.start_date, data.end_date)}</p>
          <h1>Your week</h1>
          <p>{weekSummary(data.entries.length, openMinutes, data.warnings.length > 0)}</p>
        </div>
        <div className="heading-actions">
          <div className="date-controls">
            <button aria-label="Previous week" type="button" onClick={() => moveWeek(-1)}><ChevronLeft size={18} /></button>
            <button type="button" onClick={() => setPath("/planning/week")}>This week</button>
            <button aria-label="Next week" type="button" onClick={() => moveWeek(1)}><ChevronRight size={18} /></button>
          </div>
          <button className="primary-button" disabled={!currentSemester} type="button" onClick={() => openNew(defaultEditorDate(data))}><Plus size={17} /> Add block</button>
        </div>
      </header>

      {currentSemester ? (
        <ScheduleProposalReview
          semester={currentSemester}
          tasks={data.unscheduled_tasks}
          timezone={data.timezone}
          onAccepted={plan.reload}
        />
      ) : null}

      <section className="week-summary" aria-label="Weekly totals">
        <div><span className="summary-icon violet" /> <strong>{formatMinutes(commitmentMinutes)}</strong><small>Commitments</small></div>
        <div><span className="summary-icon mint" /> <strong>{formatMinutes(focusMinutes)}</strong><small>Focused work</small></div>
        <div><span className="summary-icon coral" /> <strong>{formatMinutes(goalMinutes)}</strong><small>Personal goals</small></div>
        <div><span className="summary-icon outline" /> <strong>{formatMinutes(openMinutes)}</strong><small>Open capacity</small></div>
      </section>

      {data.warnings.length > 0 && <p className="planner-alert warning">{data.warnings[0]}</p>}

      <section className="week-task-tray">
        <div><p className="eyebrow">Unscheduled work</p><h2>Give unfinished work a place</h2></div>
        <div className="week-task-list">
          {data.unscheduled_tasks.length ? data.unscheduled_tasks.slice(0, 6).map((task) => (
            <button type="button" key={task.id} onClick={() => openNew(defaultEditorDate(data), task)}>
              <span>{task.course_code || task.goal_name || "Task"}</span><strong>{task.name}</strong><small>{formatMinutes(task.remaining_minutes)} remaining</small><Plus size={15} />
            </button>
          )) : <p>Every unfinished task already has a block in the accepted plan.</p>}
        </div>
      </section>

      <section className="calendar-card" aria-label="Weekly calendar">
        <div className="calendar-header live-calendar-header">
          <div className="timezone">{timezoneName(data.timezone, data.start_date)}</div>
          {days.map((day) => (
            <div className={day.date === localToday(data.timezone) ? "today" : undefined} key={day.date}>
              <span>{weekday(day.date)}</span><strong>{dayNumber(day.date)}</strong><small>{dayLoad(day.capacity)}</small>
            </div>
          ))}
        </div>
        <div className="calendar-body live-calendar-body">
          <div className="time-axis live-time-axis" style={{ gridTemplateRows: `repeat(${hours.length}, 60px)` }}>
            {hours.map((hour) => <span key={hour}>{formatHour(hour)}</span>)}
          </div>
          <div className="calendar-grid live-calendar-grid" style={{ gridTemplateRows: `repeat(${rows}, 30px)` }}>
            {days.map((day) => <button className="day-column" aria-label={`Add a block on ${formatCalendarDate(day.date)}`} type="button" onClick={() => openNew(day.date)} key={day.date} />)}
            {data.entries.map((entry) => (
              <WeekBlock
                entry={entry}
                timezone={data.timezone}
                weekStart={data.start_date}
                startHour={startHour}
                onOpen={() => openEntry(entry)}
                key={entry.id}
              />
            ))}
          </div>
        </div>
      </section>

      {currentSemester && (
        <ScheduleBlockEditor
          open={editorOpen}
          semesterId={currentSemester.id}
          date={editorDate || data.start_date}
          tasks={data.unscheduled_tasks}
          entry={selectedEntry}
          suggestedTask={suggestedTask}
          onClose={() => setEditorOpen(false)}
          onSaved={plan.reload}
        />
      )}
    </main>
  );
}

function WeekBlock({ entry, timezone, weekStart, startHour, onOpen }: { entry: PlanningEntry; timezone: string; weekStart: string; startHour: number; onOpen: () => void }) {
  const start = timeParts(entry.start_at, timezone);
  const duration = Math.max(Math.ceil((new Date(entry.end_at).getTime() - new Date(entry.start_at).getTime()) / 1_800_000), 1);
  const row = Math.max(Math.floor((start.hour * 60 + start.minute - startHour * 60) / 30) + 1, 1);
  const column = Math.min(Math.max(dateDifference(weekStart, dateInTimezone(entry.start_at, timezone)) + 1, 1), 7);
  const className = `week-block ${entryColor(entry)}${entry.editable ? " editable" : ""}`;
  const content = <><strong>{entry.title}</strong><span>{formatEntryTime(entry, timezone)}{entry.location ? ` · ${entry.location}` : ""}</span>{entry.editable && <Pencil size={12} />}</>;
  const style = { gridColumn: column, gridRow: `${row} / span ${duration}` };
  return entry.editable
    ? <button className={className} style={style} type="button" onClick={onOpen}>{content}</button>
    : <article className={className} style={style}>{content}</article>;
}

function WeekState({ loading = false, message, onRetry }: { loading?: boolean; message: string; onRetry?: () => Promise<void> }) {
  return <main className="page-shell planner-state">{loading && <LoaderCircle className="spin" size={26} />}<h1>{message}</h1><p>{loading ? "DoNext is expanding commitments and reading your accepted schedule." : "Your saved data is unchanged."}</p>{onRetry && <button className="primary-button" type="button" onClick={onRetry}>Try again</button>}</main>;
}

function calendarBounds(entries: PlanningEntry[], timezone: string) {
  if (!entries.length) return { startHour: 8, endHour: 18 };
  const starts = entries.map((entry) => timeParts(entry.start_at, timezone).hour);
  const ends = entries.map((entry) => timeParts(entry.end_at, timezone).hour + (timeParts(entry.end_at, timezone).minute ? 1 : 0));
  return { startHour: Math.max(Math.min(8, ...starts), 0), endHour: Math.min(Math.max(18, ...ends), 24) };
}

function timeParts(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).formatToParts(new Date(value));
  return { hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0), minute: Number(parts.find((part) => part.type === "minute")?.value ?? 0) };
}

function dateInTimezone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).formatToParts(new Date(value));
  const valueOf = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`;
}

function dateDifference(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function addDays(value: string, amount: number) {
  const result = new Date(`${value}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

function defaultEditorDate(plan: PlanningView) {
  const today = localToday(plan.timezone);
  return today >= plan.start_date && today <= plan.end_date ? today : plan.start_date;
}

function localToday(timezone: string) {
  return dateInTimezone(new Date().toISOString(), timezone);
}

function formatDateRange(start: string, end: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", { month: "long", day: "numeric", timeZone: "UTC" });
  return `${formatter.format(new Date(`${start}T12:00:00Z`))}–${formatter.format(new Date(`${end}T12:00:00Z`))}`;
}

function weekday(value: string) {
  return new Intl.DateTimeFormat("en-CA", { weekday: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function dayNumber(value: string) {
  return new Date(`${value}T12:00:00Z`).getUTCDate();
}

function formatCalendarDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function dayLoad(capacity: PlanningView["days"][number]["capacity"]) {
  if (!capacity.available_minutes) return "Needs availability";
  if (!capacity.planned_focus_minutes) return "Open";
  const ratio = capacity.planned_focus_minutes / Math.max(capacity.usable_focus_minutes, 1);
  return ratio > 1 ? "Over capacity" : ratio > .75 ? "Busy" : ratio > .35 ? "Focused" : "Light";
}

function timezoneName(timezone: string, date: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, timeZoneName: "short" }).formatToParts(new Date(`${date}T12:00:00Z`)).find((part) => part.type === "timeZoneName")?.value ?? timezone;
}

function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 || 12;
  return `${display} ${suffix}`;
}

function formatEntryTime(entry: PlanningEntry, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(entry.start_at));
}

function entryColor(entry: PlanningEntry) {
  if (entry.kind === "fixed_event") return entry.category === "class" ? "violet" : "slate";
  if (entry.block_type === "goal" || entry.block_type === "personal") return "coral";
  if (entry.block_type === "break") return "blue";
  if (entry.block_type === "commitment") return "slate";
  return "mint";
}

function entryMinutes(entries: PlanningEntry[]) {
  return entries.reduce((total, entry) => total + Math.round((new Date(entry.end_at).getTime() - new Date(entry.start_at).getTime()) / 60_000), 0);
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function weekSummary(entries: number, openMinutes: number, incomplete: boolean) {
  if (incomplete) return `${entries} planned items. Add availability to complete the capacity picture.`;
  return `${entries} planned items with ${formatMinutes(openMinutes)} of usable focus capacity still open.`;
}
