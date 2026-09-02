"use client";

import {
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  GraduationCap,
  GripVertical,
  LoaderCircle,
  Lock,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import {
  addDays,
  blockColor,
  blockFitsFocusHours,
  blockPayload,
  calendarBounds,
  calendarLaneLayout,
  cardDensity,
  currentTimePosition,
  dateDifference,
  dateInTimezone,
  dayEntryLabel,
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
  hasFocusTime,
  isDraftDay,
  mondayOnOrBefore,
  placementFromPointer,
  splitEventTitle,
  timeParts,
  timezoneName,
  weekday,
} from "@/components/draft-calendar/lib";
import type { DragPreview, EventLane } from "@/components/draft-calendar/lib";
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
  const [revertingBlockId, setRevertingBlockId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveStatus, setMoveStatus] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [confirmDeleteBlockId, setConfirmDeleteBlockId] = useState<string | null>(null);
  const [deletedBlock, setDeletedBlock] = useState<ScheduleBlock | null>(null);
  const [deletingBlockId, setDeletingBlockId] = useState<string | null>(null);
  const [mobileDayIndex, setMobileDayIndex] = useState(0);
  const [menuBlock, setMenuBlock] = useState<ScheduleBlock | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuAnchorRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const dragPreviewRef = useRef<DragPreview | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const revertTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (revertTimerRef.current) window.clearTimeout(revertTimerRef.current);
  }, []);

  // The action menu is fixed-positioned at shell level: the calendar body is its own scroll
  // container, so a popover rendered inside a block would be clipped at the container edge.
  useEffect(() => {
    if (!menuBlock) return undefined;
    function place() {
      const anchor = menuAnchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const width = 176;
      const height = 148;
      const top = rect.bottom + height + 8 > window.innerHeight
        ? Math.max(8, rect.top - height - 6)
        : rect.bottom + 6;
      const left = Math.min(
        Math.max(8, rect.left),
        Math.max(8, window.innerWidth - width - 8),
      );
      setMenuPosition({ top, left });
    }
    function dismiss(event: Event) {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || menuAnchorRef.current?.contains(target)) return;
      closeMenu();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
        menuAnchorRef.current?.focus();
      }
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuBlock]);

  function openMenu(block: ScheduleBlock, anchor: HTMLElement) {
    menuAnchorRef.current = anchor;
    setMenuBlock(block);
    setSelectedBlockId(block.id);
    setConfirmDeleteBlockId(null);
  }

  function closeMenu() {
    setMenuBlock(null);
    setMenuPosition(null);
    setSelectedBlockId(null);
    setConfirmDeleteBlockId(null);
  }

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
  const today = dateInTimezone(new Date().toISOString(), timezone);
  const todayWeekIndex = weekStarts.findIndex(
    (weekStart) => today >= weekStart && today <= addDays(weekStart, 6),
  );
  const laneLayout = calendarLaneLayout(displayedBlocks, displayedFixedEvents, timezone);
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const rows = (endHour - startHour) * 2;
  const focusHours = availability.data?.length
    ? formatFocusHours(availability.data)
    : null;
  const currentTimeMarker = currentTimePosition(
    today,
    days,
    startHour,
    endHour,
    timezone,
  );
  const mobileDay = days[Math.min(mobileDayIndex, days.length - 1)] ?? selectedWeek;
  const mobileEntries = [
    ...displayedBlocks.map((block) => ({ kind: "draft" as const, block })),
    ...displayedFixedEvents.map((entry) => ({ kind: "fixed" as const, entry })),
  ]
    .filter((item) => dateInTimezone(
      item.kind === "draft" ? item.block.start_at : item.entry.start_at,
      timezone,
    ) === mobileDay)
    .sort((first, second) => new Date(
      first.kind === "draft" ? first.block.start_at : first.entry.start_at,
    ).getTime() - new Date(
      second.kind === "draft" ? second.block.start_at : second.entry.start_at,
    ).getTime());

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
    onEdit(block);
  }

  function goToToday() {
    if (todayWeekIndex < 0) return;
    setWeekIndex(todayWeekIndex);
    setMobileDayIndex(dateDifference(weekStarts[todayWeekIndex], today));
  }

  async function deleteBlock(block: ScheduleBlock) {
    setDeletingBlockId(block.id);
    setMoveError(null);
    setMoveStatus(`Deleting ${block.title}…`);
    try {
      await apiRequest<void>(
        `/schedule-proposals/${proposalId}/blocks/${block.id}`,
        { method: "DELETE" },
      );
      setDeletedBlock(block);
      setSelectedBlockId(null);
      setConfirmDeleteBlockId(null);
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
      setDeletingBlockId(null);
    }
  }

  async function undoDelete() {
    if (!deletedBlock) return;
    const block = deletedBlock;
    setMoveError(null);
    setMoveStatus(`Restoring ${block.title}…`);
    try {
      await apiRequest<ScheduleBlock>(
        `/schedule-proposals/${proposalId}/blocks`,
        {
          method: "POST",
          body: JSON.stringify(blockPayload(block)),
        },
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
    <div
      className="draft-calendar-shell"
      onMouseUp={() => void finishDrag()}
      onPointerUpCapture={(event) => void finishDrag(event.pointerId)}
    >
      <div className="draft-calendar-toolbar">
        <div className="draft-calendar-range">
          <span>Week {weekIndex + 1} of {weekStarts.length}</span>
          {focusHours ? <small><Clock3 size={13} /> Focus hours {focusHours}</small> : null}
        </div>
        <div className="draft-calendar-navigation">
          <button
            className="draft-today-button"
            disabled={todayWeekIndex < 0}
            type="button"
            onClick={goToToday}
          >
            <CalendarDays size={15} /> Today
          </button>
          <div className="draft-week-controls" aria-label="Choose a draft week">
            <button
              aria-label="Previous draft week"
              disabled={weekIndex === 0}
              type="button"
              onClick={() => {
                setWeekIndex((current) => Math.max(current - 1, 0));
                setMobileDayIndex(0);
              }}
            >
              <ChevronLeft size={17} />
            </button>
            <span aria-live="polite">{formatRange(selectedWeek, selectedWeekEnd)}</span>
            <button
              aria-label="Next draft week"
              disabled={weekIndex === weekStarts.length - 1}
              type="button"
              onClick={() => {
                setWeekIndex((current) => Math.min(current + 1, weekStarts.length - 1));
                setMobileDayIndex(0);
              }}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </div>

      <div className="draft-calendar-legend" aria-label="Calendar event types">
        <span><GraduationCap size={14} /> Class</span>
        <span><BriefcaseBusiness size={14} /> Fixed commitment</span>
        <span><GripVertical size={14} /> Editable draft</span>
      </div>

      <div className="draft-mobile-days" aria-label="Choose a day">
        {days.map((day, index) => (
          <button
            aria-pressed={mobileDayIndex === index}
            className={`${mobileDayIndex === index ? "active" : ""}${day === today ? " today" : ""}`}
            key={day}
            type="button"
            onClick={() => setMobileDayIndex(index)}
          >
            <span>{weekday(day)}</span>
            <strong>{dayNumber(day)}</strong>
          </button>
        ))}
      </div>

      <section className="calendar-card draft-calendar" aria-label={`Draft calendar for ${formatRange(selectedWeek, selectedWeekEnd)}`}>
        <div className="calendar-header live-calendar-header">
          <div className="timezone">{timezoneName(timezone, selectedWeek)}</div>
          {days.map((day) => (
            <div
              className={`${isDraftDay(day, horizonStart, horizonEnd) ? "" : "outside-draft"}${day === today ? " today" : ""}`}
              key={day}
            >
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
                layout={laneLayout[`draft:${block.id}`]}
                preview={dragPreview?.blockId === block.id ? dragPreview : null}
                reverting={revertingBlockId === block.id}
                saving={savingBlockId === block.id}
                selected={selectedBlockId === block.id}
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
                layout={laneLayout[`fixed:${entry.id}`]}
                startHour={startHour}
                timezone={timezone}
                weekStart={selectedWeek}
              />
            ))}
            {currentTimeMarker ? (
              <div
                aria-label="Current time"
                className="draft-current-time"
                style={{
                  left: `${currentTimeMarker.left}%`,
                  top: `${currentTimeMarker.top}%`,
                  width: `${100 / 7}%`,
                }}
              />
            ) : null}
          </div>
        </div>
      </section>

      <section className="draft-mobile-agenda" aria-label={`Agenda for ${formatCalendarDate(mobileDay)}`}>
        <header>
          <div><span>{weekday(mobileDay)}</span><strong>{formatCalendarDate(mobileDay)}</strong></div>
          <button
            disabled={!isDraftDay(mobileDay, horizonStart, horizonEnd)
              || !hasFocusTime(mobileDay, availability.data ?? [])}
            type="button"
            onClick={() => onAdd(mobileDay)}
          >
            <Plus size={16} /> Add block
          </button>
        </header>
        {mobileEntries.length ? mobileEntries.map((item) => item.kind === "draft" ? (
          <div className={`draft-agenda-event editable ${blockColor(item.block)}`} key={`draft:${item.block.id}`}>
            <button type="button" onClick={() => openBlock(item.block)}>
              <span><GripVertical size={16} /></span>
              <div>
                <strong>{splitEventTitle(item.block.title).label}</strong>
                <small>{splitEventTitle(item.block.title).eyebrow ? `${splitEventTitle(item.block.title).eyebrow} · ` : ""}{formatBlockTime(item.block, timezone)}</small>
              </div>
            </button>
            <button
              aria-label={`Actions for ${item.block.title}`}
              title="Event actions"
              type="button"
              onClick={(event) => openMenu(item.block, event.currentTarget)}
            >
              <MoreHorizontal size={18} />
            </button>
          </div>
        ) : (
          <div className={`draft-agenda-event fixed ${fixedEventColor(item.entry)}`} key={`fixed:${item.entry.id}`}>
            <span>{fixedEventIcon(item.entry)}</span>
            <div><strong>{item.entry.title}</strong><small>{formatEntryTime(item.entry, timezone)}{item.entry.location ? ` · ${item.entry.location}` : ""} · {fixedEventLabel(item.entry)}</small></div>
          </div>
        )) : (
          <p>No events on this day. Add a block when you are ready.</p>
        )}
      </section>

      {menuBlock && menuPosition ? (
        <div
          aria-label={`Actions for ${menuBlock.title}`}
          className="draft-block-actions"
          ref={menuRef}
          role="menu"
          style={{ top: menuPosition.top, left: menuPosition.left }}
        >
          <p className="draft-block-actions-title">
            <strong>{splitEventTitle(menuBlock.title).label}</strong>
            <small>{formatBlockTime(menuBlock, timezone)}</small>
          </p>
          <button
            role="menuitem"
            type="button"
            onClick={() => { const block = menuBlock; closeMenu(); onEdit(block); }}
          >
            <Pencil size={15} /> Edit
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => { const block = menuBlock; closeMenu(); onDuplicate(block); }}
          >
            <Copy size={15} /> Duplicate
          </button>
          {confirmDeleteBlockId === menuBlock.id ? (
            <>
              <button
                className="danger"
                disabled={deletingBlockId === menuBlock.id}
                role="menuitem"
                type="button"
                onClick={() => void deleteBlock(menuBlock)}
              >
                {deletingBlockId === menuBlock.id
                  ? <LoaderCircle className="spin" size={15} />
                  : <Trash2 size={15} />} Confirm delete
              </button>
              <button role="menuitem" type="button" onClick={() => setConfirmDeleteBlockId(null)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              className="danger"
              role="menuitem"
              type="button"
              onClick={() => setConfirmDeleteBlockId(menuBlock.id)}
            >
              <Trash2 size={15} /> Delete
            </button>
          )}
        </div>
      ) : null}

      {moveError ? <p className="draft-calendar-move-message error" role="alert">{moveError}</p> : null}
      {moveStatus ? (
        <div className="draft-calendar-move-message" aria-live="polite">
          <span>{moveStatus}</span>
          {deletedBlock ? <button type="button" onClick={() => void undoDelete()}>Undo</button> : null}
        </div>
      ) : null}
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
  layout,
  timezone,
  weekStart,
  startHour,
}: {
  entry: PlanningEntry;
  layout?: EventLane;
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
      className={`week-block ${fixedEventColor(entry)} draft-fixed-block density-${cardDensity(duration)}`}
      style={eventGridStyle(column, row, duration, layout)}
      title={`${entry.title} · ${formatEntryTime(entry, timezone)}${entry.location ? ` · ${entry.location}` : ""}`}
    >
      <p className="draft-event-meta-row">
        <span className="draft-event-kind">
          <span>{fixedEventIcon(entry)}</span>
          {/* A class card is already a violet block with a graduation cap and a course code. */}
          {entry.category === "class" ? null : fixedEventLabel(entry)}
        </span>
        <span className="draft-event-time">{formatEntryTime(entry, timezone)}</span>
      </p>
      <strong className="draft-event-label">{entry.title}</strong>
      {entry.location ? <span className="draft-event-location">{entry.location}</span> : null}
    </article>
  );
}

function DraftBlock({
  block,
  layout,
  preview,
  dragging,
  reverting,
  saving,
  selected,
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
  layout?: EventLane;
  preview: DragPreview | null;
  dragging: boolean;
  reverting: boolean;
  saving: boolean;
  selected: boolean;
  timezone: string;
  weekStart: string;
  startHour: number;
  onClick: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
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
  const title = splitEventTitle(block.title);

  return (
    <div
      className={`week-block editable draft-block ${blockColor(block)} density-${cardDensity(duration)}${dragging ? " dragging" : ""}${reverting ? " reverting" : ""}${saving ? " saving" : ""}${selected ? " selected" : ""}`}
      style={eventGridStyle(column, row, duration, layout)}
      title={`${block.title} · ${formatBlockTime(displayedBlock, timezone)}`}
    >
      <button
        aria-label={`Drag ${block.title}`}
        className="draft-drag-button"
        disabled={saving}
        title="Drag to move"
        type="button"
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <GripVertical size={14} />
      </button>
      <button
        aria-label={`Move or edit ${block.title}, ${formatBlockTime(displayedBlock, timezone)}`}
        className="draft-block-main"
        disabled={saving}
        type="button"
        onClick={onClick}
      >
        <p className="draft-event-meta-row">
          {title.eyebrow ? <span className="draft-event-kind">{title.eyebrow}</span> : null}
          <span className="draft-event-time">{formatBlockTime(displayedBlock, timezone)}</span>
        </p>
        <strong className="draft-event-label">{title.label}</strong>
        {saving ? <LoaderCircle className="spin draft-block-state" size={13} /> : block.locked ? <Lock className="draft-block-state" size={13} /> : null}
      </button>
    </div>
  );
}

function eventGridStyle(
  column: number,
  row: number,
  duration: number,
  layout: EventLane | undefined,
): CSSProperties {
  if (!layout || layout.laneCount <= 1) {
    return { gridColumn: column, gridRow: `${row} / span ${duration}` };
  }
  const width = 100 / layout.laneCount;
  return {
    gridColumn: column,
    gridRow: `${row} / span ${duration}`,
    justifySelf: "start",
    marginLeft: `calc(${width * layout.lane}% + 3px)`,
    width: `calc(${width}% - 6px)`,
  };
}

function fixedEventIcon(entry: PlanningEntry) {
  if (entry.category === "class") return <GraduationCap size={13} />;
  if (entry.category === "work") return <BriefcaseBusiness size={13} />;
  return <Pin size={13} />;
}
