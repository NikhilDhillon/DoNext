"use client";

import {
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GraduationCap,
  GripVertical,
  LoaderCircle,
  Lock,
  Pin,
  Plus,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

import {
  addDays,
  blockColor,
  blockFitsFocusHours,
  blockPayload,
  calendarBounds,
  calendarLaneLayout,
  cardDensity,
  dateDifference,
  dateInTimezone,
  dayNumber,
  entryFitsCalendar,
  fixedEventColor,
  fixedEventLabel,
  focusBounds,
  formatBlockTime,
  formatCalendarDate,
  formatEntryTime,
  formatFocusHours,
  formatHour,
  formatMoveTime,
  formatRange,
  focusIntervalsForDate,
  hasFocusTime,
  isDraftDay,
  mondayOnOrBefore,
  placementFromPointer,
  splitEventTitle,
  timeParts,
  timezoneName,
  weekday,
  zonedDateTimeToIso,
} from "@/components/draft-calendar/lib";
import type { DragPreview, EventLane } from "@/components/draft-calendar/lib";
import { BlockInspector } from "@/components/draft-calendar/block-inspector";
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
  onDuplicate: (block: ScheduleBlock) => void;
  onAdd: (date?: string) => void;
  onMoved: () => Promise<void> | void;
};

type DragSession = {
  block: ScheduleBlock;
  pointerId: number;
  originX: number;
  originY: number;
  moved: boolean;
};

const COLUMN_CHOICES = [
  { columns: 7, label: "Week" },
  { columns: 3, label: "3 days" },
  { columns: 1, label: "Day" },
] as const;

const GUTTER_WIDTH = 56;

export function DraftScheduleCalendar({
  blocks,
  horizonStart,
  horizonEnd,
  timezone,
  proposalId,
  onEdit,
  onDuplicate,
  onAdd,
  onMoved,
}: DraftScheduleCalendarProps) {
  const firstMonday = useMemo(() => mondayOnOrBefore(horizonStart), [horizonStart]);
  const totalDays = useMemo(
    () => (Math.floor(dateDifference(firstMonday, mondayOnOrBefore(horizonEnd)) / 7) + 1) * 7,
    [firstMonday, horizonEnd],
  );
  const [columns, setColumns] = useState(7);
  const [dayOffset, setDayOffset] = useState(0);
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [savingBlockId, setSavingBlockId] = useState<string | null>(null);
  const [revertingBlockId, setRevertingBlockId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveStatus, setMoveStatus] = useState<string | null>(null);
  const [deletedBlock, setDeletedBlock] = useState<ScheduleBlock | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busyBlockId, setBusyBlockId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const dragPreviewRef = useRef<DragPreview | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const revertTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (revertTimerRef.current) window.clearTimeout(revertTimerRef.current);
  }, []);

  const maxOffset = Math.max(totalDays - columns, 0);
  const offset = Math.min(dayOffset, maxOffset);
  const days = Array.from({ length: columns }, (_, index) => addDays(firstMonday, offset + index));
  const rangeStart = days[0];
  const rangeEnd = days[days.length - 1];

  // The planning feed is week-keyed, so a window that straddles a Monday needs both weeks.
  const firstWeek = mondayOnOrBefore(rangeStart);
  const lastWeek = mondayOnOrBefore(rangeEnd);
  const primaryPlan = useApiResource<PlanningView>(`/planning/week?start=${firstWeek}`);
  const secondaryPlan = useApiResource<PlanningView>(
    lastWeek === firstWeek ? null : `/planning/week?start=${lastWeek}`,
  );
  const availability = useApiResource<AvailabilityWindow[]>("/availability");

  const planEntries = useMemo(() => {
    const merged = new Map<string, PlanningEntry>();
    for (const entry of primaryPlan.data?.entries ?? []) merged.set(entry.id, entry);
    for (const entry of secondaryPlan.data?.entries ?? []) merged.set(entry.id, entry);
    return [...merged.values()];
  }, [primaryPlan.data, secondaryPlan.data]);

  const visibleBlocks = blocks.filter((block) => {
    const date = dateInTimezone(block.start_at, timezone);
    return date >= rangeStart
      && date <= rangeEnd
      && date >= horizonStart
      && date <= horizonEnd;
  });
  const visibleFixedEvents = planEntries.filter((entry) => {
    const date = dateInTimezone(entry.start_at, timezone);
    return entry.kind === "fixed_event"
      && date >= rangeStart
      && date <= rangeEnd
      && date >= horizonStart
      && date <= horizonEnd;
  });
  const focusBoundary = availability.data?.length
    ? focusBounds(availability.data)
    : calendarBounds(blocks, timezone);
  const { startHour, endHour } = calendarBounds(visibleFixedEvents, timezone, focusBoundary);
  const displayedBlocks = availability.data?.length
    ? visibleBlocks.filter((block) => blockFitsFocusHours(block, timezone, availability.data ?? []))
    : visibleBlocks;
  const outsideFocusBlocks = visibleBlocks.filter((block) => !displayedBlocks.includes(block));
  const displayedFixedEvents = visibleFixedEvents.filter((entry) => (
    entryFitsCalendar(entry, timezone, startHour, endHour)
  ));
  const today = dateInTimezone(new Date().toISOString(), timezone);
  const todayOffset = dateDifference(firstMonday, today);
  const todayVisible = days.includes(today);
  const laneLayout = calendarLaneLayout(displayedBlocks, displayedFixedEvents, timezone);
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const dayMinutes = Math.max((endHour - startHour) * 60, 1);
  const focusHours = availability.data?.length ? formatFocusHours(availability.data) : null;
  const currentTimeTop = todayVisible ? currentTimeOffset(startHour, endHour, timezone) : null;
  const columnTemplate = `${GUTTER_WIDTH}px repeat(${columns}, minmax(0, 1fr))`;
  const selectedBlock = displayedBlocks.find((block) => block.id === selectedBlockId) ?? null;
  const selectedColumn = selectedBlock
    ? days.indexOf(dateInTimezone(selectedBlock.start_at, timezone))
    : -1;
  const loading = primaryPlan.loading || secondaryPlan.loading || availability.loading;
  const feedError = primaryPlan.error || secondaryPlan.error;

  function beginDrag(block: ScheduleBlock, event: ReactPointerEvent<HTMLElement>) {
    if (savingBlockId) return;
    if (revertTimerRef.current) window.clearTimeout(revertTimerRef.current);
    setRevertingBlockId(null);
    setMoveError(null);
    setMoveStatus(null);
    dragSessionRef.current = {
      block,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - session.originX, event.clientY - session.originY);
    if (!session.moved && distance < 5) return;
    session.moved = true;
    setDraggingBlockId(session.block.id);
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
      GUTTER_WIDTH,
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
        revertBlock(
          session.block,
          `${session.block.title} returned to its previous time because the new time is outside your focus hours.`,
        );
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
          body: JSON.stringify({ start_at: placement.startAt, end_at: placement.endAt }),
        },
      );
      window.dispatchEvent(new Event("donext:planning-updated"));
      await onMoved();
      setMoveStatus(`${session.block.title} moved to ${formatMoveTime(placement.startAt, timezone)}`);
    } catch (requestError) {
      revertBlock(
        session.block,
        requestError instanceof ApiRequestError
          ? `${requestError.message} ${session.block.title} returned to its previous time.`
          : `${session.block.title} returned to its previous time because DoNext could not save the move.`,
      );
      setMoveStatus(null);
    } finally {
      setSavingBlockId(null);
      setDragPreview(null);
    }
  }

  function cancelDrag(event: ReactPointerEvent<HTMLElement>) {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    dragSessionRef.current = null;
    dragPreviewRef.current = null;
    setDraggingBlockId(null);
    setDragPreview(null);
  }

  function revertBlock(block: ScheduleBlock, message: string) {
    setDragPreview(null);
    setRevertingBlockId(block.id);
    setMoveError(message);
    if (revertTimerRef.current) window.clearTimeout(revertTimerRef.current);
    revertTimerRef.current = window.setTimeout(() => {
      setRevertingBlockId((current) => current === block.id ? null : current);
      revertTimerRef.current = null;
    }, 420);
  }

  function openBlock(block: ScheduleBlock) {
    if (suppressClickRef.current === block.id) {
      suppressClickRef.current = null;
      return;
    }
    setConfirmingDelete(false);
    setSelectedBlockId((current) => current === block.id ? null : block.id);
  }

  function closeInspector() {
    setSelectedBlockId(null);
    setConfirmingDelete(false);
  }

  function fitsFocusWindow(date: string, startMinute: number, minutes: number) {
    const intervals = focusIntervalsForDate(date, availability.data ?? []);
    if (!intervals.length) return false;
    return intervals.some(([from, to]) => from <= startMinute && startMinute + minutes <= to);
  }

  // Every keyboard and stepper adjustment goes through the same PATCH the drag uses, so the
  // API stays the single validator for focus hours and overlaps.
  async function moveBlockTo(block: ScheduleBlock, date: string, startMinute: number, minutes: number) {
    if (!isDraftDay(date, horizonStart, horizonEnd)) {
      setMoveStatus(null);
      setMoveError(`${formatCalendarDate(date)} is outside this 14-day draft.`);
      return;
    }
    if (!fitsFocusWindow(date, startMinute, minutes)) {
      setMoveStatus(null);
      setMoveError(`${block.title} was left where it was: that time is outside your focus hours.`);
      return;
    }
    const startAt = zonedDateTimeToIso(date, Math.floor(startMinute / 60), startMinute % 60, timezone);
    const endAt = new Date(new Date(startAt).getTime() + minutes * 60_000).toISOString();
    setBusyBlockId(block.id);
    setMoveError(null);
    setMoveStatus(`Saving ${block.title}…`);
    try {
      await apiRequest<ScheduleBlock>(
        `/schedule-proposals/${proposalId}/blocks/${block.id}`,
        { method: "PATCH", body: JSON.stringify({ start_at: startAt, end_at: endAt }) },
      );
      window.dispatchEvent(new Event("donext:planning-updated"));
      await onMoved();
      setMoveStatus(`${block.title} is now ${formatMoveTime(startAt, timezone)}`);
    } catch (requestError) {
      setMoveStatus(null);
      setMoveError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : `DoNext could not update ${block.title}.`,
      );
    } finally {
      setBusyBlockId(null);
    }
  }

  function blockMinutes(block: ScheduleBlock) {
    return Math.round(
      (new Date(block.end_at).getTime() - new Date(block.start_at).getTime()) / 60_000,
    );
  }

  function shiftStart(block: ScheduleBlock, delta: number) {
    const date = dateInTimezone(block.start_at, timezone);
    const start = timeParts(block.start_at, timezone);
    void moveBlockTo(block, date, start.hour * 60 + start.minute + delta, blockMinutes(block));
  }

  function shiftLength(block: ScheduleBlock, delta: number) {
    const date = dateInTimezone(block.start_at, timezone);
    const start = timeParts(block.start_at, timezone);
    const minutes = Math.max(blockMinutes(block) + delta, 15);
    void moveBlockTo(block, date, start.hour * 60 + start.minute, minutes);
  }

  function shiftDay(block: ScheduleBlock, delta: number) {
    const date = dateInTimezone(block.start_at, timezone);
    const start = timeParts(block.start_at, timezone);
    void moveBlockTo(block, addDays(date, delta), start.hour * 60 + start.minute, blockMinutes(block));
  }

  async function deleteBlock(block: ScheduleBlock) {
    setBusyBlockId(block.id);
    setMoveError(null);
    setMoveStatus(`Deleting ${block.title}…`);
    try {
      await apiRequest<void>(
        `/schedule-proposals/${proposalId}/blocks/${block.id}`,
        { method: "DELETE" },
      );
      setDeletedBlock(block);
      closeInspector();
      window.dispatchEvent(new Event("donext:planning-updated"));
      await onMoved();
      setMoveStatus(`${block.title} deleted.`);
    } catch (requestError) {
      setMoveStatus(null);
      setMoveError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : `DoNext could not delete ${block.title}.`,
      );
    } finally {
      setBusyBlockId(null);
    }
  }

  function handleBlockKey(block: ScheduleBlock, event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") { closeInspector(); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); shiftStart(block, -15); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); shiftStart(block, 15); return; }
    if (event.key === "ArrowLeft") { event.preventDefault(); shiftDay(block, -1); return; }
    if (event.key === "ArrowRight") { event.preventDefault(); shiftDay(block, 1); return; }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      setSelectedBlockId(block.id);
      setConfirmingDelete(true);
    }
  }

  function goToToday() {
    closeInspector();
    if (todayOffset < 0 || todayOffset >= totalDays) return;
    setDayOffset(columns === 7 ? Math.floor(todayOffset / 7) * 7 : Math.min(todayOffset, maxOffset));
  }

  function changeColumns(next: number) {
    closeInspector();
    const anchor = columns === 7 && next !== 7 && todayOffset >= offset && todayOffset < offset + 7
      ? todayOffset
      : offset;
    setColumns(next);
    setDayOffset(Math.min(next === 7 ? Math.floor(anchor / 7) * 7 : anchor, Math.max(totalDays - next, 0)));
  }

  async function undoDelete() {
    if (!deletedBlock) return;
    const block = deletedBlock;
    setMoveError(null);
    setMoveStatus(`Restoring ${block.title}…`);
    try {
      await apiRequest<ScheduleBlock>(
        `/schedule-proposals/${proposalId}/blocks`,
        { method: "POST", body: JSON.stringify(blockPayload(block)) },
      );
      setDeletedBlock(null);
      window.dispatchEvent(new Event("donext:planning-updated"));
      await onMoved();
      setMoveStatus(`${block.title} restored.`);
    } catch (requestError) {
      setMoveStatus(null);
      setMoveError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : `DoNext could not restore ${block.title}.`,
      );
    }
  }

  return (
    <section
      aria-label={`Draft calendar for ${formatRange(rangeStart, rangeEnd)}`}
      className="draft-console"
      onMouseUp={() => void finishDrag()}
      onPointerUpCapture={(event) => void finishDrag(event.pointerId)}
    >
      <header className="console-bar">
        <h3>Draft calendar</h3>
        <span className="console-chip">{formatRange(horizonStart, horizonEnd)}</span>
        <span className="console-spacer" />
        <button
          className="console-btn"
          disabled={todayVisible || todayOffset < 0 || todayOffset >= totalDays}
          type="button"
          onClick={goToToday}
        >
          <CalendarDays size={15} /> Today
        </button>
        <button
          aria-label="Earlier days"
          className="console-btn icon"
          disabled={offset <= 0}
          type="button"
          onClick={() => setDayOffset(Math.max(offset - columns, 0))}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          aria-label="Later days"
          className="console-btn icon"
          disabled={offset >= maxOffset}
          type="button"
          onClick={() => setDayOffset(Math.min(offset + columns, maxOffset))}
        >
          <ChevronRight size={16} />
        </button>
        <div className="console-seg" role="tablist" aria-label="Calendar span">
          {COLUMN_CHOICES.map((choice) => (
            <button
              aria-selected={columns === choice.columns}
              className={columns === choice.columns ? "on" : undefined}
              key={choice.columns}
              role="tab"
              type="button"
              onClick={() => changeColumns(choice.columns)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        <button className="console-cta" type="button" onClick={() => onAdd()}>
          <Plus size={16} /> New block
        </button>
      </header>

      <div className="console-body">
        <div className="console-cal">
          <div className="console-head" style={{ gridTemplateColumns: columnTemplate }}>
            <div className="console-head-gutter">{timezoneName(timezone, rangeStart)}</div>
            {days.map((day) => (
              <div
                className={`console-dayhead${day === today ? " today" : ""}${isDraftDay(day, horizonStart, horizonEnd) ? "" : " outside"}`}
                key={day}
              >
                <span>{weekday(day)}</span>
                <strong>{dayNumber(day)}</strong>
                {isDraftDay(day, horizonStart, horizonEnd)
                  ? null
                  : <small>Outside draft</small>}
              </div>
            ))}
          </div>

          <div className="console-scroll">
            <div
              className="console-grid"
              ref={gridRef}
              style={{
                gridTemplateColumns: columnTemplate,
                height: `calc(var(--hour) * ${hours.length})`,
              }}
            >
              <div className="console-gutter">
                {hours.map((hour) => (
                  <b key={hour} style={{ top: `${percentOf(hour * 60, startHour, dayMinutes)}%` }}>
                    {formatHour(hour)}
                  </b>
                ))}
              </div>

              {days.map((day) => {
                const draftDay = isDraftDay(day, horizonStart, horizonEnd);
                const openForBlocks = draftDay && hasFocusTime(day, availability.data ?? []);
                return (
                  <div
                    className={`console-col${day === today ? " today" : ""}${draftDay ? "" : " outside"}`}
                    key={day}
                  >
                    <div className="console-rules">
                      {hours.map((hour) => (
                        <i key={hour} style={{ top: `${percentOf(hour * 60, startHour, dayMinutes)}%` }} />
                      ))}
                    </div>
                    <button
                      aria-label={!draftDay
                        ? `${formatCalendarDate(day)} is outside this 14-day draft`
                        : openForBlocks
                        ? `Add a draft block on ${formatCalendarDate(day)}`
                        : `${formatCalendarDate(day)} is outside your saved focus days`}
                      className="console-hit"
                      disabled={!openForBlocks}
                      type="button"
                      onClick={() => onAdd(day)}
                    />
                    {draftDay ? null : <span className="console-outside-label">Outside the draft</span>}

                    {displayedFixedEvents
                      .filter((entry) => dateInTimezone(entry.start_at, timezone) === day)
                      .map((entry) => (
                        <ConsoleFixedEvent
                          entry={entry}
                          key={entry.id}
                          layout={laneLayout[`fixed:${entry.id}`]}
                          startHour={startHour}
                          dayMinutes={dayMinutes}
                          timezone={timezone}
                        />
                      ))}

                    {displayedBlocks
                      .filter((block) => {
                        const preview = dragPreview?.blockId === block.id ? dragPreview : null;
                        const start = preview ? preview.startAt : block.start_at;
                        return dateInTimezone(start, timezone) === day;
                      })
                      .map((block) => (
                        <ConsoleDraftBlock
                          block={block}
                          dragging={draggingBlockId === block.id}
                          key={block.id}
                          layout={laneLayout[`draft:${block.id}`]}
                          preview={dragPreview?.blockId === block.id ? dragPreview : null}
                          reverting={revertingBlockId === block.id}
                          saving={savingBlockId === block.id || busyBlockId === block.id}
                          selected={selectedBlockId === block.id}
                          startHour={startHour}
                          dayMinutes={dayMinutes}
                          timezone={timezone}
                          onClick={() => openBlock(block)}
                          onKeyDown={(event) => handleBlockKey(block, event)}
                          onPointerCancel={cancelDrag}
                          onPointerDown={(event) => beginDrag(block, event)}
                          onPointerMove={moveDrag}
                          onPointerUp={(event) => void finishDrag(event.pointerId)}
                        />
                      ))}
                  </div>
                );
              })}

              {currentTimeTop === null ? null : (
                <>
                  <div
                    aria-hidden="true"
                    className="console-now"
                    style={{
                      top: `${currentTimeTop}%`,
                      left: `calc(${GUTTER_WIDTH}px + (100% - ${GUTTER_WIDTH}px) * ${days.indexOf(today) / columns})`,
                      width: `calc((100% - ${GUTTER_WIDTH}px) / ${columns})`,
                    }}
                  />
                  <div
                    className="console-now-time"
                    style={{ top: `${currentTimeTop}%`, width: `${GUTTER_WIDTH}px` }}
                  >
                    {currentClock(timezone)}
                  </div>
                </>
              )}
            </div>
          </div>

          {!displayedBlocks.length && !displayedFixedEvents.length && !loading ? (
            <p className="console-empty">
              Nothing scheduled in this range. Click any open time to add a draft block.
            </p>
          ) : null}

          {outsideFocusBlocks.length ? (
            <div className="console-outside-focus" role="alert">
              <strong>
                {outsideFocusBlocks.length} draft {outsideFocusBlocks.length === 1 ? "block sits" : "blocks sit"} outside your focus hours.
              </strong>
              {outsideFocusBlocks.map((block) => (
                <button key={block.id} type="button" onClick={() => onEdit(block)}>
                  {block.title} · {formatBlockTime(block, timezone)}
                </button>
              ))}
            </div>
          ) : null}

          {feedError ? (
            <p className="console-notice error">Saved classes and commitments could not be loaded into this preview.</p>
          ) : availability.error ? (
            <p className="console-notice error">Focus hours could not be loaded into this preview.</p>
          ) : loading ? (
            <p className="console-notice">Loading classes, commitments, and focus hours…</p>
          ) : null}

          {selectedBlock ? (
            <BlockInspector
              block={selectedBlock}
              busy={busyBlockId === selectedBlock.id}
              columnIndex={Math.max(selectedColumn, 0)}
              columns={columns}
              confirmingDelete={confirmingDelete}
              gutterWidth={GUTTER_WIDTH}
              timezone={timezone}
              onCancelDelete={() => setConfirmingDelete(false)}
              onClose={closeInspector}
              onDelete={() => {
                if (!confirmingDelete) { setConfirmingDelete(true); return; }
                void deleteBlock(selectedBlock);
              }}
              onDuplicate={() => { closeInspector(); onDuplicate(selectedBlock); }}
              onEdit={() => { closeInspector(); onEdit(selectedBlock); }}
              onShiftLength={(minutes) => shiftLength(selectedBlock, minutes)}
              onShiftStart={(minutes) => shiftStart(selectedBlock, minutes)}
            />
          ) : null}

          <footer className="console-foot">
            <span><GripVertical size={13} /> Drag a block to move it</span>
            {focusHours ? <span><Clock3 size={13} /> Focus hours {focusHours}</span> : null}
            <span className="legend"><i /> dashed = editable draft</span>
          </footer>
        </div>
      </div>

      {moveError ? (
        <p className="console-status error" role="alert"><span>{moveError}</span></p>
      ) : moveStatus ? (
        <div className="console-status" aria-live="polite">
          <span>{moveStatus}</span>
          {deletedBlock ? <button type="button" onClick={() => void undoDelete()}>Undo</button> : null}
        </div>
      ) : null}
    </section>
  );
}

function ConsoleFixedEvent({
  entry,
  layout,
  startHour,
  dayMinutes,
  timezone,
}: {
  entry: PlanningEntry;
  layout?: EventLane;
  startHour: number;
  dayMinutes: number;
  timezone: string;
}) {
  const start = timeParts(entry.start_at, timezone);
  const duration = Math.max(
    Math.ceil((new Date(entry.end_at).getTime() - new Date(entry.start_at).getTime()) / 1_800_000),
    1,
  );
  const label = fixedEventLabel(entry);

  return (
    <article
      aria-label={`${entry.title}, fixed ${label.toLowerCase()}, ${formatEntryTime(entry, timezone)}`}
      className={`console-event ${fixedEventColor(entry)} density-${cardDensity(duration)}`}
      style={eventStyle(start.hour * 60 + start.minute, duration * 30, startHour, dayMinutes, layout)}
      title={`${entry.title} · ${formatEntryTime(entry, timezone)}${entry.location ? ` · ${entry.location}` : ""}`}
    >
      <p className="console-event-meta">
        <span className="console-event-kind">
          {fixedEventIcon(entry)}
          {entry.course_code ?? label}
        </span>
        <span className="console-event-time">{formatEntryTime(entry, timezone)}</span>
      </p>
      <strong className="console-event-title">{entry.title}</strong>
      {entry.location ? <span className="console-event-sub">{entry.location}</span> : null}
    </article>
  );
}

function ConsoleDraftBlock({
  block,
  layout,
  preview,
  dragging,
  reverting,
  saving,
  selected,
  startHour,
  dayMinutes,
  timezone,
  onClick,
  onKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  block: ScheduleBlock;
  layout?: EventLane;
  preview: DragPreview | null;
  dragging: boolean;
  reverting: boolean;
  saving: boolean;
  selected: boolean;
  startHour: number;
  dayMinutes: number;
  timezone: string;
  onClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const shown = preview ? { ...block, start_at: preview.startAt, end_at: preview.endAt } : block;
  const start = timeParts(shown.start_at, timezone);
  const minutes = Math.max(
    Math.round((new Date(shown.end_at).getTime() - new Date(shown.start_at).getTime()) / 60_000),
    15,
  );
  const title = splitEventTitle(block.title);

  return (
    <button
      aria-label={`Edit ${block.title}, editable draft block, ${formatBlockTime(shown, timezone)}`}
      className={`console-event editable ${blockColor(block)} density-${cardDensity(Math.ceil(minutes / 30))}${dragging ? " dragging" : ""}${reverting ? " reverting" : ""}${saving ? " saving" : ""}${selected ? " selected" : ""}`}
      disabled={saving}
      style={eventStyle(start.hour * 60 + start.minute, minutes, startHour, dayMinutes, layout)}
      title={`${block.title} · ${formatBlockTime(shown, timezone)}`}
      type="button"
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerCancel={onPointerCancel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <p className="console-event-meta">
        <span className="console-event-kind">{title.eyebrow ?? "Draft"}</span>
        <span className="console-event-time">{formatBlockTime(shown, timezone)}</span>
      </p>
      <strong className="console-event-title">{title.label}</strong>
      <span className="console-grab" aria-hidden="true">
        {saving
          ? <LoaderCircle className="spin" size={12} />
          : block.locked ? <Lock size={12} /> : <GripVertical size={12} />}
      </span>
    </button>
  );
}

function fixedEventIcon(entry: PlanningEntry) {
  if (entry.category === "class") return <GraduationCap size={11} />;
  if (entry.category === "work") return <BriefcaseBusiness size={11} />;
  return <Pin size={11} />;
}

function percentOf(minuteOfDay: number, startHour: number, dayMinutes: number) {
  return ((minuteOfDay - startHour * 60) / dayMinutes) * 100;
}

function eventStyle(
  startMinute: number,
  minutes: number,
  startHour: number,
  dayMinutes: number,
  layout: EventLane | undefined,
): CSSProperties {
  const lanes = layout && layout.laneCount > 1 ? layout.laneCount : 1;
  const lane = layout ? layout.lane : 0;
  const width = 100 / lanes;
  return {
    top: `calc(${percentOf(startMinute, startHour, dayMinutes)}% + 2px)`,
    height: `calc(${(minutes / dayMinutes) * 100}% - 4px)`,
    left: `calc(${width * lane}% + 4px)`,
    width: `calc(${width}% - 8px)`,
  };
}

function currentTimeOffset(startHour: number, endHour: number, timezone: string) {
  const now = timeParts(new Date().toISOString(), timezone);
  const minutes = now.hour * 60 + now.minute;
  if (minutes < startHour * 60 || minutes > endHour * 60) return null;
  return ((minutes - startHour * 60) / Math.max((endHour - startHour) * 60, 1)) * 100;
}

function currentClock(timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).format(new Date()).replace(/\s/g, " ");
}
