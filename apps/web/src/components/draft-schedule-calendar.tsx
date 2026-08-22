"use client";

import { ChevronLeft, ChevronRight, Lock, Pencil } from "lucide-react";
import { useMemo, useState } from "react";

import { useApiResource } from "@/hooks/use-api-resource";
import type { PlanningEntry, PlanningView, ScheduleBlock } from "@/lib/types";

type DraftScheduleCalendarProps = {
  blocks: ScheduleBlock[];
  horizonStart: string;
  horizonEnd: string;
  timezone: string;
  onEdit: (block: ScheduleBlock) => void;
  onAdd: (date: string) => void;
};

export function DraftScheduleCalendar({
  blocks,
  horizonStart,
  horizonEnd,
  timezone,
  onEdit,
  onAdd,
}: DraftScheduleCalendarProps) {
  const weekStarts = useMemo(() => {
    const dayCount = Math.max(dateDifference(horizonStart, horizonEnd) + 1, 1);
    return Array.from(
      { length: Math.ceil(dayCount / 7) },
      (_, index) => addDays(horizonStart, index * 7),
    );
  }, [horizonEnd, horizonStart]);
  const [weekIndex, setWeekIndex] = useState(0);

  const selectedWeek = weekStarts[Math.min(weekIndex, weekStarts.length - 1)] ?? horizonStart;
  const selectedWeekEnd = earlierDate(addDays(selectedWeek, 6), horizonEnd);
  const classPlan = useApiResource<PlanningView>(`/planning/week?start=${selectedWeek}`);
  const days = Array.from(
    { length: dateDifference(selectedWeek, selectedWeekEnd) + 1 },
    (_, index) => addDays(selectedWeek, index),
  );
  const visibleBlocks = blocks.filter((block) => {
    const date = dateInTimezone(block.start_at, timezone);
    return date >= selectedWeek && date <= selectedWeekEnd;
  });
  const visibleClasses = (classPlan.data?.entries ?? []).filter((entry) => (
    entry.kind === "fixed_event"
      && entry.category === "class"
      && dateInTimezone(entry.start_at, timezone) >= selectedWeek
      && dateInTimezone(entry.start_at, timezone) <= selectedWeekEnd
  ));
  const { startHour, endHour } = calendarBounds([...blocks, ...visibleClasses], timezone);
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const rows = (endHour - startHour) * 2;

  return (
    <div className="draft-calendar-shell">
      <div className="draft-calendar-toolbar">
        <div>
          <span>Showing week {weekIndex + 1} of {weekStarts.length}</span>
          <strong>{formatRange(selectedWeek, selectedWeekEnd)}</strong>
        </div>
        <div className="draft-week-controls" aria-label="Choose a draft week">
          <button
            aria-label="Previous draft week"
            disabled={weekIndex === 0}
            type="button"
            onClick={() => setWeekIndex((current) => Math.max(current - 1, 0))}
          >
            <ChevronLeft size={16} />
          </button>
          {weekStarts.map((weekStart, index) => {
            const weekEnd = earlierDate(addDays(weekStart, 6), horizonEnd);
            return (
              <button
                aria-pressed={weekIndex === index}
                className={weekIndex === index ? "active" : undefined}
                key={weekStart}
                type="button"
                onClick={() => setWeekIndex(index)}
              >
                {formatRange(weekStart, weekEnd)}
              </button>
            );
          })}
          <button
            aria-label="Next draft week"
            disabled={weekIndex === weekStarts.length - 1}
            type="button"
            onClick={() => setWeekIndex((current) => Math.min(current + 1, weekStarts.length - 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <section className="calendar-card draft-calendar" aria-label={`Draft calendar for ${formatRange(selectedWeek, selectedWeekEnd)}`}>
        <div className="calendar-header live-calendar-header">
          <div className="timezone">{timezoneName(timezone, selectedWeek)}</div>
          {days.map((day) => (
            <div key={day}>
              <span>{weekday(day)}</span>
              <strong>{dayNumber(day)}</strong>
              <small>{dayEntryLabel(visibleBlocks, visibleClasses, day, timezone)}</small>
            </div>
          ))}
        </div>
        <div className="calendar-body live-calendar-body draft-calendar-body">
          <div className="time-axis live-time-axis" style={{ gridTemplateRows: `repeat(${hours.length}, 60px)` }}>
            {hours.map((hour) => <span key={hour}>{formatHour(hour)}</span>)}
          </div>
          <div className="calendar-grid live-calendar-grid draft-calendar-grid" style={{ gridTemplateRows: `repeat(${rows}, 30px)` }}>
            {days.map((day) => (
              <button
                aria-label={`Add a draft block on ${formatCalendarDate(day)}`}
                className="day-column"
                key={day}
                type="button"
                onClick={() => onAdd(day)}
              />
            ))}
            {visibleBlocks.map((block) => (
              <DraftBlock
                block={block}
                key={block.id}
                onEdit={() => onEdit(block)}
                startHour={startHour}
                timezone={timezone}
                weekStart={selectedWeek}
              />
            ))}
            {visibleClasses.map((entry) => (
              <DraftClassBlock
                entry={entry}
                key={entry.id}
                startHour={startHour}
                timezone={timezone}
                weekStart={selectedWeek}
              />
            ))}
          </div>
        </div>
      </section>
      {classPlan.error ? (
        <p className="draft-calendar-notice error">Classes could not be loaded into this preview.</p>
      ) : classPlan.loading ? (
        <p className="draft-calendar-notice">Loading classes into the draft calendar…</p>
      ) : null}
      {!visibleBlocks.length && !visibleClasses.length && !classPlan.loading ? (
        <p className="draft-calendar-empty">No classes or draft blocks appear in this week. Click any day column to add a block.</p>
      ) : null}
    </div>
  );
}

function DraftClassBlock({
  entry,
  timezone,
  weekStart,
  startHour,
}: {
  entry: PlanningEntry;
  timezone: string;
  weekStart: string;
  startHour: number;
}) {
  const start = timeParts(entry.start_at, timezone);
  const duration = Math.max(
    Math.ceil((new Date(entry.end_at).getTime() - new Date(entry.start_at).getTime()) / 1_800_000),
    1,
  );
  const row = Math.max(
    Math.floor((start.hour * 60 + start.minute - startHour * 60) / 30) + 1,
    1,
  );
  const column = Math.min(
    Math.max(dateDifference(weekStart, dateInTimezone(entry.start_at, timezone)) + 1, 1),
    7,
  );

  return (
    <article
      aria-label={`${entry.title}, fixed class, ${formatEntryTime(entry, timezone)}`}
      className="week-block violet draft-class-block"
      style={{ gridColumn: column, gridRow: `${row} / span ${duration}` }}
    >
      <strong>{entry.title}</strong>
      <span>{formatEntryTime(entry, timezone)}{entry.location ? ` · ${entry.location}` : ""}</span>
    </article>
  );
}

function DraftBlock({
  block,
  timezone,
  weekStart,
  startHour,
  onEdit,
}: {
  block: ScheduleBlock;
  timezone: string;
  weekStart: string;
  startHour: number;
  onEdit: () => void;
}) {
  const start = timeParts(block.start_at, timezone);
  const duration = Math.max(
    Math.ceil((new Date(block.end_at).getTime() - new Date(block.start_at).getTime()) / 1_800_000),
    1,
  );
  const row = Math.max(
    Math.floor((start.hour * 60 + start.minute - startHour * 60) / 30) + 1,
    1,
  );
  const column = Math.min(
    Math.max(dateDifference(weekStart, dateInTimezone(block.start_at, timezone)) + 1, 1),
    7,
  );

  return (
    <button
      aria-label={`Edit ${block.title}, ${formatBlockTime(block, timezone)}`}
      className={`week-block editable draft-block ${blockColor(block)}`}
      style={{ gridColumn: column, gridRow: `${row} / span ${duration}` }}
      type="button"
      onClick={onEdit}
    >
      <strong>{block.title}</strong>
      <span>{formatBlockTime(block, timezone)}</span>
      {block.locked ? <Lock size={12} /> : <Pencil size={12} />}
    </button>
  );
}

function calendarBounds(entries: Array<{ start_at: string; end_at: string }>, timezone: string) {
  if (!entries.length) return { startHour: 8, endHour: 18 };
  const starts = entries.map((entry) => timeParts(entry.start_at, timezone).hour);
  const ends = entries.map((entry) => {
    const end = timeParts(entry.end_at, timezone);
    return end.hour + (end.minute ? 1 : 0);
  });
  return {
    startHour: Math.max(Math.min(8, ...starts), 0),
    endHour: Math.min(Math.max(18, ...ends), 24),
  };
}

function dayEntryLabel(
  blocks: ScheduleBlock[],
  classes: PlanningEntry[],
  date: string,
  timezone: string,
) {
  const draftCount = blocks.filter((block) => dateInTimezone(block.start_at, timezone) === date).length;
  const classCount = classes.filter((entry) => dateInTimezone(entry.start_at, timezone) === date).length;
  const labels = [];
  if (draftCount) labels.push(`${draftCount} draft${draftCount === 1 ? "" : "s"}`);
  if (classCount) labels.push(`${classCount} class${classCount === 1 ? "" : "es"}`);
  return labels.length ? labels.join(" · ") : "Open";
}

function blockColor(block: ScheduleBlock) {
  if (block.block_type === "goal" || block.block_type === "personal") return "coral";
  if (block.block_type === "break") return "blue";
  if (block.block_type === "commitment") return "slate";
  return "mint";
}

function formatBlockTime(block: ScheduleBlock, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
  return `${formatter.format(new Date(block.start_at))}–${formatter.format(new Date(block.end_at))}`;
}

function formatEntryTime(entry: PlanningEntry, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
  return `${formatter.format(new Date(entry.start_at))}–${formatter.format(new Date(entry.end_at))}`;
}

function timeParts(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).formatToParts(new Date(value));
  return {
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
    minute: Number(parts.find((part) => part.type === "minute")?.value ?? 0),
  };
}

function dateInTimezone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const valueOf = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`;
}

function dateDifference(start: string, end: string) {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function earlierDate(first: string, second: string) {
  return first < second ? first : second;
}

function weekday(value: string) {
  return new Intl.DateTimeFormat("en-CA", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

function dayNumber(value: string) {
  return new Date(`${value}T12:00:00Z`).getUTCDate();
}

function formatCalendarDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatRange(start: string, end: string) {
  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  const sameMonth = startDate.getUTCMonth() === endDate.getUTCMonth();
  const startFormatter = new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const endFormatter = new Intl.DateTimeFormat("en-CA", {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${startFormatter.format(startDate)}–${endFormatter.format(endDate)}`;
}

function timezoneName(timezone: string, date: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    timeZoneName: "short",
  }).formatToParts(new Date(`${date}T12:00:00Z`))
    .find((part) => part.type === "timeZoneName")?.value ?? timezone;
}

function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12} ${suffix}`;
}
