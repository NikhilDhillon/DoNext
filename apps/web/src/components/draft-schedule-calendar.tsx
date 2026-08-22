"use client";

import { ChevronLeft, ChevronRight, LoaderCircle, Lock, Pencil } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { useApiResource } from "@/hooks/use-api-resource";
import { apiRequest, ApiRequestError } from "@/lib/api";
import type {
  AvailabilityWindow,
  PlanningEntry,
  PlanningView,
  ScheduleBlock,
} from "@/lib/types";

type DraftScheduleCalendarProps = {
  blocks: ScheduleBlock[];
  horizonStart: string;
  horizonEnd: string;
  timezone: string;
  proposalId: string;
  onEdit: (block: ScheduleBlock) => void;
  onAdd: (date: string) => void;
  onMoved: () => Promise<void> | void;
};

type DragSession = {
  block: ScheduleBlock;
  pointerId: number;
  originX: number;
  originY: number;
  moved: boolean;
};

type DragPreview = {
  blockId: string;
  startAt: string;
  endAt: string;
};

export function DraftScheduleCalendar({
  blocks,
  horizonStart,
  horizonEnd,
  timezone,
  proposalId,
  onEdit,
  onAdd,
  onMoved,
}: DraftScheduleCalendarProps) {
  const weekStarts = useMemo(() => {
    const firstMonday = mondayOnOrBefore(horizonStart);
    const lastMonday = mondayOnOrBefore(horizonEnd);
    return Array.from(
      { length: Math.floor(dateDifference(firstMonday, lastMonday) / 7) + 1 },
      (_, index) => addDays(firstMonday, index * 7),
    );
  }, [horizonEnd, horizonStart]);
  const [weekIndex, setWeekIndex] = useState(0);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [savingBlockId, setSavingBlockId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveStatus, setMoveStatus] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const dragPreviewRef = useRef<DragPreview | null>(null);
  const suppressClickRef = useRef<string | null>(null);

  const selectedWeek = weekStarts[Math.min(weekIndex, weekStarts.length - 1)] ?? horizonStart;
  const selectedWeekEnd = addDays(selectedWeek, 6);
  const fixedPlan = useApiResource<PlanningView>(`/planning/week?start=${selectedWeek}`);
  const availability = useApiResource<AvailabilityWindow[]>("/availability");
  const days = Array.from({ length: 7 }, (_, index) => addDays(selectedWeek, index));
  const visibleBlocks = blocks.filter((block) => {
    const date = dateInTimezone(block.start_at, timezone);
    return date >= selectedWeek
      && date <= selectedWeekEnd
      && date >= horizonStart
      && date <= horizonEnd;
  });
  const visibleFixedEvents = (fixedPlan.data?.entries ?? []).filter((entry) => (
    entry.kind === "fixed_event"
      && dateInTimezone(entry.start_at, timezone) >= selectedWeek
      && dateInTimezone(entry.start_at, timezone) <= selectedWeekEnd
      && dateInTimezone(entry.start_at, timezone) >= horizonStart
      && dateInTimezone(entry.start_at, timezone) <= horizonEnd
  ));
  const focusBoundary = availability.data?.length
    ? focusBounds(availability.data)
    : calendarBounds(blocks, timezone);
  const { startHour, endHour } = calendarBounds(
    visibleFixedEvents,
    timezone,
    focusBoundary,
  );
  const displayedBlocks = availability.data?.length
    ? visibleBlocks.filter((block) => blockFitsFocusHours(block, timezone, availability.data ?? []))
    : visibleBlocks;
  const outsideFocusBlocks = visibleBlocks.filter((block) => !displayedBlocks.includes(block));
  const displayedFixedEvents = visibleFixedEvents.filter((entry) => (
    entryFitsCalendar(entry, timezone, startHour, endHour)
  ));
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const rows = (endHour - startHour) * 2;
  const focusHours = availability.data?.length
    ? formatFocusHours(availability.data)
    : null;

  function beginDrag(block: ScheduleBlock, event: ReactPointerEvent<HTMLButtonElement>) {
    if (savingBlockId) return;
    setMoveError(null);
    setMoveStatus(null);
    dragSessionRef.current = {
      block,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      moved: false,
    };
    setDraggingBlockId(block.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - session.originX, event.clientY - session.originY);
    if (!session.moved && distance < 5) return;
    session.moved = true;
    event.preventDefault();
    const placement = placementFromPointer(
      session.block,
      event.clientX,
      event.clientY,
      session.originX,
      session.originY,
      gridRef.current,
      days,
      startHour,
      endHour,
      timezone,
      availability.data ?? [],
      horizonStart,
      horizonEnd,
    );
    if (!placement) {
      dragPreviewRef.current = null;
      setDragPreview(null);
      return;
    }
    dragPreviewRef.current = placement;
    setDragPreview(placement);
  }

  async function finishDrag(pointerId?: number) {
    const session = dragSessionRef.current;
    if (!session || (pointerId !== undefined && session.pointerId !== pointerId)) return;
    dragSessionRef.current = null;
    setDraggingBlockId(null);
    const placement = dragPreviewRef.current;
    dragPreviewRef.current = null;
    if (!session.moved || !placement) {
      setDragPreview(null);
      if (session.moved && !placement) {
        setMoveError("That block does not fit inside your saved focus hours for that day.");
      }
      return;
    }

    suppressClickRef.current = session.block.id;
    window.setTimeout(() => {
      if (suppressClickRef.current === session.block.id) suppressClickRef.current = null;
    }, 0);
    if (new Date(placement.startAt).getTime() === new Date(session.block.start_at).getTime()) {
      setDragPreview(null);
      return;
    }

    setSavingBlockId(session.block.id);
    setMoveStatus(`Saving the new time for ${session.block.title}…`);
    try {
      await apiRequest<ScheduleBlock>(
        `/schedule-proposals/${proposalId}/blocks/${session.block.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            start_at: placement.startAt,
            end_at: placement.endAt,
          }),
        },
      );
      window.dispatchEvent(new Event("donext:planning-updated"));
      await onMoved();
      setMoveStatus(`${session.block.title} moved to ${formatMoveTime(placement.startAt, timezone)}`);
    } catch (requestError) {
      setMoveError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : "DoNext could not move that block.",
      );
      setMoveStatus(null);
    } finally {
      setSavingBlockId(null);
      setDragPreview(null);
    }
  }

  function cancelDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    dragSessionRef.current = null;
    dragPreviewRef.current = null;
    setDraggingBlockId(null);
    setDragPreview(null);
  }

  function openBlock(block: ScheduleBlock) {
    if (suppressClickRef.current === block.id) {
      suppressClickRef.current = null;
      return;
    }
    onEdit(block);
  }

  return (
    <div
      className="draft-calendar-shell"
      onMouseUp={() => void finishDrag()}
      onPointerUpCapture={(event) => void finishDrag(event.pointerId)}
    >
      <div className="draft-calendar-toolbar">
        <div>
          <span>Showing week {weekIndex + 1} of {weekStarts.length}</span>
          <strong>{formatRange(selectedWeek, selectedWeekEnd)}</strong>
          {focusHours ? <small>Focus hours · {focusHours}</small> : null}
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
            const weekEnd = addDays(weekStart, 6);
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
            <div className={isDraftDay(day, horizonStart, horizonEnd) ? undefined : "outside-draft"} key={day}>
              <span>{weekday(day)}</span>
              <strong>{dayNumber(day)}</strong>
              <small>{isDraftDay(day, horizonStart, horizonEnd)
                ? dayEntryLabel(displayedBlocks, displayedFixedEvents, day, timezone)
                : "Outside draft"}</small>
            </div>
          ))}
        </div>
        <div
          className="calendar-body live-calendar-body draft-calendar-body"
          style={{ height: Math.min(Math.max(rows * 30, 120), 590) }}
        >
          <div className="time-axis live-time-axis" style={{ gridTemplateRows: `repeat(${hours.length}, 60px)` }}>
            {hours.map((hour) => <span key={hour}>{formatHour(hour)}</span>)}
          </div>
          <div
            className={`calendar-grid live-calendar-grid draft-calendar-grid${draggingBlockId ? " drag-active" : ""}`}
            ref={gridRef}
            style={{ gridTemplateRows: `repeat(${rows}, 30px)` }}
          >
            {days.map((day) => (
              <button
                aria-label={!isDraftDay(day, horizonStart, horizonEnd)
                  ? `${formatCalendarDate(day)} is outside this 14-day draft`
                  : hasFocusTime(day, availability.data ?? [])
                  ? `Add a draft block on ${formatCalendarDate(day)}`
                  : `${formatCalendarDate(day)} is outside your saved focus days`}
                className="day-column"
                disabled={!isDraftDay(day, horizonStart, horizonEnd)
                  || !hasFocusTime(day, availability.data ?? [])}
                key={day}
                type="button"
                onClick={() => onAdd(day)}
              />
            ))}
            {displayedBlocks.map((block) => (
              <DraftBlock
                block={block}
                dragging={draggingBlockId === block.id}
                key={block.id}
                preview={dragPreview?.blockId === block.id ? dragPreview : null}
                saving={savingBlockId === block.id}
                startHour={startHour}
                timezone={timezone}
                weekStart={selectedWeek}
                onClick={() => openBlock(block)}
                onPointerCancel={cancelDrag}
                onPointerDown={(event) => beginDrag(block, event)}
                onPointerMove={moveDrag}
                onPointerUp={(event) => void finishDrag(event.pointerId)}
              />
            ))}
            {displayedFixedEvents.map((entry) => (
              <DraftFixedBlock
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
      {moveError ? <p className="draft-calendar-move-message error" role="alert">{moveError}</p> : null}
      {moveStatus ? <p className="draft-calendar-move-message" aria-live="polite">{moveStatus}</p> : null}
      {outsideFocusBlocks.length ? (
        <div className="draft-calendar-outside-focus" role="alert">
          <strong>{outsideFocusBlocks.length} draft {outsideFocusBlocks.length === 1 ? "block is" : "blocks are"} outside your current focus hours.</strong>
          <span>Edit or regenerate {outsideFocusBlocks.length === 1 ? "it" : "them"} before accepting this draft.</span>
          <div>
            {outsideFocusBlocks.map((block) => (
              <button key={block.id} type="button" onClick={() => onEdit(block)}>
                {block.title} · {formatBlockTime(block, timezone)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {fixedPlan.error ? (
        <p className="draft-calendar-notice error">Saved classes and commitments could not be loaded into this preview.</p>
      ) : availability.error ? (
        <p className="draft-calendar-notice error">Focus hours could not be loaded into this preview.</p>
      ) : fixedPlan.loading ? (
        <p className="draft-calendar-notice">Loading classes and commitments into the draft calendar…</p>
      ) : availability.loading ? (
        <p className="draft-calendar-notice">Loading your focus hours…</p>
      ) : null}
      {!displayedBlocks.length && !displayedFixedEvents.length && !fixedPlan.loading ? (
        <p className="draft-calendar-empty">No saved commitments or draft blocks appear in this week. Click any day column to add a block.</p>
      ) : null}
    </div>
  );
}

function DraftFixedBlock({
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
      aria-label={`${entry.title}, fixed ${fixedEventLabel(entry).toLowerCase()}, ${formatEntryTime(entry, timezone)}`}
      className={`week-block ${fixedEventColor(entry)} draft-fixed-block`}
      style={{ gridColumn: column, gridRow: `${row} / span ${duration}` }}
    >
      <strong>{entry.title}</strong>
      <span>{formatEntryTime(entry, timezone)}{entry.location ? ` · ${entry.location}` : ""}</span>
      <small className="draft-fixed-badge">{fixedEventLabel(entry)}</small>
    </article>
  );
}

function DraftBlock({
  block,
  preview,
  dragging,
  saving,
  timezone,
  weekStart,
  startHour,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  block: ScheduleBlock;
  preview: DragPreview | null;
  dragging: boolean;
  saving: boolean;
  timezone: string;
  weekStart: string;
  startHour: number;
  onClick: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const displayedBlock = preview
    ? { ...block, start_at: preview.startAt, end_at: preview.endAt }
    : block;
  const start = timeParts(displayedBlock.start_at, timezone);
  const duration = Math.max(
    Math.ceil((new Date(displayedBlock.end_at).getTime() - new Date(displayedBlock.start_at).getTime()) / 1_800_000),
    1,
  );
  const row = Math.max(
    Math.floor((start.hour * 60 + start.minute - startHour * 60) / 30) + 1,
    1,
  );
  const column = Math.min(
    Math.max(dateDifference(weekStart, dateInTimezone(displayedBlock.start_at, timezone)) + 1, 1),
    7,
  );

  return (
    <button
      aria-label={`Move or edit ${block.title}, ${formatBlockTime(displayedBlock, timezone)}`}
      className={`week-block editable draft-block ${blockColor(block)}${dragging ? " dragging" : ""}${saving ? " saving" : ""}`}
      disabled={saving}
      style={{ gridColumn: column, gridRow: `${row} / span ${duration}` }}
      type="button"
      onClick={onClick}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <strong>{block.title}</strong>
      <span>{formatBlockTime(displayedBlock, timezone)}</span>
      {saving ? <LoaderCircle className="spin" size={12} /> : block.locked ? <Lock size={12} /> : <Pencil size={12} />}
    </button>
  );
}

function placementFromPointer(
  block: ScheduleBlock,
  clientX: number,
  clientY: number,
  originX: number,
  originY: number,
  grid: HTMLDivElement | null,
  days: string[],
  startHour: number,
  endHour: number,
  timezone: string,
  availability: AvailabilityWindow[],
  horizonStart: string,
  horizonEnd: string,
): DragPreview | null {
  if (!grid || !days.length) return null;
  const bounds = grid.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const originalDayIndex = clamp(
    dateDifference(days[0], dateInTimezone(block.start_at, timezone)),
    0,
    days.length - 1,
  );
  const dayIndex = clamp(
    originalDayIndex + Math.round((clientX - originX) / (bounds.width / 7)),
    0,
    days.length - 1,
  );
  const targetDate = days[dayIndex];
  if (!isDraftDay(targetDate, horizonStart, horizonEnd)) return null;
  const durationMinutes = Math.max(
    Math.round((new Date(block.end_at).getTime() - new Date(block.start_at).getTime()) / 60_000),
    15,
  );
  const calendarMinutes = (endHour - startHour) * 60;
  const originalStart = timeParts(block.start_at, timezone);
  const originalMinutes = originalStart.hour * 60 + originalStart.minute - startHour * 60;
  const minuteDelta = Math.round(
    ((clientY - originY) / (bounds.height / calendarMinutes)) / 15,
  ) * 15;
  const requestedMinutesFromStart = clamp(
    originalMinutes + minuteDelta,
    0,
    Math.max(calendarMinutes - durationMinutes, 0),
  );
  const requestedMinuteOfDay = startHour * 60 + requestedMinutesFromStart;
  const targetMinuteOfDay = closestAvailableStart(
    requestedMinuteOfDay,
    durationMinutes,
    focusIntervalsForDate(targetDate, availability),
  );
  if (targetMinuteOfDay === null) return null;
  const targetHour = Math.floor(targetMinuteOfDay / 60);
  const targetMinute = targetMinuteOfDay % 60;
  const startAt = zonedDateTimeToIso(targetDate, targetHour, targetMinute, timezone);
  return {
    blockId: block.id,
    startAt,
    endAt: new Date(new Date(startAt).getTime() + durationMinutes * 60_000).toISOString(),
  };
}

function zonedDateTimeToIso(dateValue: string, hour: number, minute: number, timezone: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desiredUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: timezone,
    }).formatToParts(new Date(candidate));
    const valueOf = (type: Intl.DateTimeFormatPartTypes) => Number(
      parts.find((part) => part.type === type)?.value ?? 0,
    );
    const observedAsUtc = Date.UTC(
      valueOf("year"),
      valueOf("month") - 1,
      valueOf("day"),
      valueOf("hour"),
      valueOf("minute"),
    );
    candidate += desiredUtc - observedAsUtc;
  }
  return new Date(candidate).toISOString();
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function formatMoveTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

function calendarBounds(
  entries: Array<{ start_at: string; end_at: string }>,
  timezone: string,
  baseline = { startHour: 8, endHour: 18 },
) {
  if (!entries.length) return baseline;
  const starts = entries.map((entry) => timeParts(entry.start_at, timezone).hour);
  const ends = entries.map((entry) => {
    const end = timeParts(entry.end_at, timezone);
    const endMinute = endMinuteForBlock(entry.start_at, entry.end_at, timezone, end);
    return Math.ceil(endMinute / 60);
  });
  return {
    startHour: Math.max(Math.min(baseline.startHour, ...starts), 0),
    endHour: Math.min(Math.max(baseline.endHour, ...ends), 24),
  };
}

function focusBounds(windows: AvailabilityWindow[]) {
  const positive = windows.filter((window) => window.type !== "unavailable");
  if (!positive.length) return { startHour: 8, endHour: 18 };
  const starts = positive.map((window) => clockMinutes(window.start_time));
  const ends = positive.map((window) => endClockMinutes(window.end_time));
  return {
    startHour: Math.floor(Math.min(...starts) / 60),
    endHour: Math.ceil(Math.max(...ends) / 60),
  };
}

function blockFitsFocusHours(
  block: ScheduleBlock,
  timezone: string,
  windows: AvailabilityWindow[],
) {
  const startDate = dateInTimezone(block.start_at, timezone);
  if (startDate !== dateInTimezone(block.end_at, timezone)) return false;
  const start = timeParts(block.start_at, timezone);
  const end = timeParts(block.end_at, timezone);
  const startMinute = start.hour * 60 + start.minute;
  const endMinute = endMinuteForBlock(block.start_at, block.end_at, timezone, end);
  return focusIntervalsForDate(startDate, windows).some(
    ([windowStart, windowEnd]) => windowStart <= startMinute && endMinute <= windowEnd,
  );
}

function entryFitsCalendar(
  entry: PlanningEntry,
  timezone: string,
  startHour: number,
  endHour: number,
) {
  const start = timeParts(entry.start_at, timezone);
  const end = timeParts(entry.end_at, timezone);
  return start.hour * 60 + start.minute >= startHour * 60
    && endMinuteForBlock(entry.start_at, entry.end_at, timezone, end) <= endHour * 60;
}

function focusIntervalsForDate(date: string, windows: AvailabilityWindow[]) {
  const weekdayIndex = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  const matching = windows.filter((window) => window.day_of_week === weekdayIndex);
  const positive = mergeMinuteIntervals(
    matching
      .filter((window) => window.type !== "unavailable")
      .map((window) => [clockMinutes(window.start_time), endClockMinutes(window.end_time)]),
  );
  const unavailable = mergeMinuteIntervals(
    matching
      .filter((window) => window.type === "unavailable")
      .map((window) => [clockMinutes(window.start_time), endClockMinutes(window.end_time)]),
  );
  return unavailable.reduce(
    (remaining, exclusion) => remaining.flatMap((interval) => subtractMinuteInterval(interval, exclusion)),
    positive,
  );
}

function mergeMinuteIntervals(intervals: number[][]) {
  const merged: number[][] = [];
  for (const interval of intervals.sort((first, second) => first[0] - second[0])) {
    const previous = merged[merged.length - 1];
    if (!previous || interval[0] > previous[1]) {
      merged.push([...interval]);
    } else {
      previous[1] = Math.max(previous[1], interval[1]);
    }
  }
  return merged;
}

function subtractMinuteInterval(interval: number[], exclusion: number[]) {
  const [start, end] = interval;
  const [excludedStart, excludedEnd] = exclusion;
  if (excludedEnd <= start || excludedStart >= end) return [interval];
  const remaining: number[][] = [];
  if (excludedStart > start) remaining.push([start, Math.min(excludedStart, end)]);
  if (excludedEnd < end) remaining.push([Math.max(excludedEnd, start), end]);
  return remaining;
}

function closestAvailableStart(requested: number, duration: number, intervals: number[][]) {
  const candidates = intervals
    .filter(([start, end]) => end - start >= duration)
    .map(([start, end]) => clamp(requested, start, end - duration));
  if (!candidates.length) return null;
  return candidates.reduce((closest, candidate) => (
    Math.abs(candidate - requested) < Math.abs(closest - requested) ? candidate : closest
  ));
}

function hasFocusTime(date: string, windows: AvailabilityWindow[]) {
  return focusIntervalsForDate(date, windows).length > 0;
}

function clockMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function endClockMinutes(value: string) {
  const minutes = clockMinutes(value);
  return minutes === 0 ? 24 * 60 : minutes;
}

function endMinuteForBlock(
  startAt: string,
  endAt: string,
  timezone: string,
  end: { hour: number; minute: number },
) {
  return dateInTimezone(startAt, timezone) !== dateInTimezone(endAt, timezone)
    && end.hour === 0
    && end.minute === 0
    ? 24 * 60
    : end.hour * 60 + end.minute;
}

function formatFocusHours(windows: AvailabilityWindow[]) {
  const positive = windows.filter((window) => window.type !== "unavailable");
  if (!positive.length) return "No focus time saved";
  const start = Math.min(...positive.map((window) => clockMinutes(window.start_time)));
  const end = Math.max(...positive.map((window) => endClockMinutes(window.end_time)));
  return `${formatClockMinutes(start)}–${formatClockMinutes(end)}`;
}

function formatClockMinutes(value: number) {
  const hour = Math.floor(value / 60) % 24;
  const minute = value % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function dayEntryLabel(
  blocks: ScheduleBlock[],
  fixedEvents: PlanningEntry[],
  date: string,
  timezone: string,
) {
  const draftCount = blocks.filter((block) => dateInTimezone(block.start_at, timezone) === date).length;
  const fixedCount = fixedEvents.filter((entry) => dateInTimezone(entry.start_at, timezone) === date).length;
  const labels = [];
  if (draftCount) labels.push(`${draftCount} draft${draftCount === 1 ? "" : "s"}`);
  if (fixedCount) labels.push(`${fixedCount} fixed item${fixedCount === 1 ? "" : "s"}`);
  return labels.length ? labels.join(" · ") : "Open";
}

function fixedEventLabel(entry: PlanningEntry) {
  const labels: Record<string, string> = {
    appointment: "Appointment",
    career: "Career",
    class: "Class",
    club: "Club",
    commute: "Commute",
    creative: "Creative",
    gym: "Gym",
    health: "Health",
    learning: "Learning",
    personal: "Personal",
    work: "Work",
  };
  return labels[entry.category] ?? "Commitment";
}

function fixedEventColor(entry: PlanningEntry) {
  if (entry.category === "class") return "violet";
  if (entry.category === "work") return "slate";
  if (entry.category === "appointment" || entry.category === "health") return "blue";
  if (entry.category === "gym") return "mint";
  return "amber";
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

function mondayOnOrBefore(value: string) {
  const day = new Date(`${value}T12:00:00Z`).getUTCDay();
  return addDays(value, -((day + 6) % 7));
}

function isDraftDay(value: string, horizonStart: string, horizonEnd: string) {
  return value >= horizonStart && value <= horizonEnd;
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
