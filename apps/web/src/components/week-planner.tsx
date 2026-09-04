"use client";

import { LoaderCircle, Pencil } from "lucide-react";
import { useMemo, useState } from "react";

import { ScheduleBlockEditor } from "@/components/schedule-block-editor";
import { ScheduleProposalReview } from "@/components/schedule-proposal-review";
import { useApiResource } from "@/hooks/use-api-resource";
import type { PlanningEntry, PlanningView, Semester } from "@/lib/types";

export function WeekPlanner() {
  const plan = useApiResource<PlanningView>("/planning/week");
  const semesters = useApiResource<Semester[]>("/semesters");
  const currentSemester = useMemo(
    () => semesters.data?.find((semester) => semester.status === "active") ?? semesters.data?.[0] ?? null,
    [semesters.data],
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<PlanningEntry | null>(null);
  const [editorDate, setEditorDate] = useState("");

  if ((plan.loading || semesters.loading) && !plan.data) return <WeekState loading message="Building your real week" />;
  if (plan.error || semesters.error) return <WeekState message={plan.error || semesters.error || "The week could not load."} onRetry={plan.reload} />;
  if (!plan.data) return <WeekState loading message="Loading your week" />;

  const data = plan.data;
  const days = data.days;
  const { startHour, endHour } = calendarBounds(data.entries, data.timezone);
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const rows = (endHour - startHour) * 2;

  function openNew(date: string) {
    setSelectedEntry(null);
    setEditorDate(date);
    setEditorOpen(true);
  }

  function openEntry(entry: PlanningEntry) {
    if (!entry.editable) return;
    setSelectedEntry(entry);
    setEditorDate(dateInTimezone(entry.start_at, data.timezone));
    setEditorOpen(true);
  }

  return (
    <main className="page-shell week-page">
      <header className="page-heading week-heading">
        <div>
          <p className="eyebrow">{formatDateRange(data.start_date, data.end_date)}</p>
          <h1>Your week</h1>
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

      {data.warnings.length > 0 && <p className="planner-alert warning">{data.warnings[0]}</p>}

      {data.entries.length > 0 ? (
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
      ) : null}

      {currentSemester && (
        <ScheduleBlockEditor
          open={editorOpen}
          semesterId={currentSemester.id}
          date={editorDate || data.start_date}
          tasks={data.unscheduled_tasks}
          entry={selectedEntry}
          suggestedTask={null}
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

