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

type DragPreview = {
  blockId: string;
  startAt: string;
  endAt: string;
};

type EventLane = {
  lane: number;
  laneCount: number;
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

function calendarLaneLayout(
  blocks: ScheduleBlock[],
  fixedEvents: PlanningEntry[],
  timezone: string,
) {
  const result: Record<string, EventLane> = {};
  const events = [
    ...blocks.map((block) => ({
      id: `draft:${block.id}`,
      date: dateInTimezone(block.start_at, timezone),
      start: new Date(block.start_at).getTime(),
      end: new Date(block.end_at).getTime(),
    })),
    ...fixedEvents.map((entry) => ({
      id: `fixed:${entry.id}`,
      date: dateInTimezone(entry.start_at, timezone),
      start: new Date(entry.start_at).getTime(),
      end: new Date(entry.end_at).getTime(),
    })),
  ];
  for (const date of new Set(events.map((event) => event.date))) {
    const dayEvents = events
      .filter((event) => event.date === date)
      .sort((first, second) => first.start - second.start || first.end - second.end);
    let cluster: typeof dayEvents = [];
    let clusterEnd = 0;
    const placeCluster = () => {
      if (!cluster.length) return;
      const laneEnds: number[] = [];
      const placements = cluster.map((event) => {
        const availableLane = laneEnds.findIndex((end) => end <= event.start);
        const lane = availableLane >= 0 ? availableLane : laneEnds.length;
        laneEnds[lane] = event.end;
        return { event, lane };
      });
      const laneCount = Math.max(laneEnds.length, 1);
      for (const placement of placements) {
        result[placement.event.id] = { lane: placement.lane, laneCount };
      }
    };
    for (const event of dayEvents) {
      if (cluster.length && event.start >= clusterEnd) {
        placeCluster();
        cluster = [];
        clusterEnd = 0;
      }
      cluster.push(event);
      clusterEnd = Math.max(clusterEnd, event.end);
    }
    placeCluster();
  }
  return result;
}

function currentTimePosition(
  today: string,
  days: string[],
  startHour: number,
  endHour: number,
  timezone: string,
) {
  const dayIndex = days.indexOf(today);
  if (dayIndex < 0) return null;
  const now = timeParts(new Date().toISOString(), timezone);
  const minutes = now.hour * 60 + now.minute;
  const start = startHour * 60;
  const end = endHour * 60;
  if (minutes < start || minutes > end) return null;
  return {
    left: dayIndex * (100 / 7),
    top: ((minutes - start) / Math.max(end - start, 1)) * 100,
  };
}

function blockPayload(block: ScheduleBlock) {
  return {
    title: block.title,
    task_id: block.task_id,
    fixed_event_id: block.fixed_event_id,
    goal_id: block.goal_id,
    start_at: block.start_at,
    end_at: block.end_at,
    block_type: block.block_type,
    locked: block.locked,
  };
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
  const dayIndex = originalDayIndex + Math.round((clientX - originX) / (bounds.width / 7));
  if (dayIndex < 0 || dayIndex >= days.length) return null;
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
  const requestedMinutesFromStart = originalMinutes + minuteDelta;
  if (requestedMinutesFromStart < 0
    || requestedMinutesFromStart > calendarMinutes - durationMinutes) return null;
  const requestedMinuteOfDay = startHour * 60 + requestedMinutesFromStart;
  const fitsFocusHours = focusIntervalsForDate(targetDate, availability).some(
    ([windowStart, windowEnd]) => (
      windowStart <= requestedMinuteOfDay
      && requestedMinuteOfDay + durationMinutes <= windowEnd
    ),
  );
  if (!fitsFocusHours) return null;
  const targetMinuteOfDay = requestedMinuteOfDay;
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
  const start = timeParts(block.start_at, timezone);
  const end = timeParts(block.end_at, timezone);
  const endDate = dateInTimezone(block.end_at, timezone);
  const endsAtMidnight = endDate === addDays(startDate, 1)
    && end.hour === 0
    && end.minute === 0;
  if (startDate !== endDate && !endsAtMidnight) return false;
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

function fixedEventIcon(entry: PlanningEntry) {
  if (entry.category === "class") return <GraduationCap size={13} />;
  if (entry.category === "work") return <BriefcaseBusiness size={13} />;
  return <Pin size={13} />;
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

function clockParts(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    clock: `${valueOf("hour")}:${valueOf("minute")}`,
    meridiem: valueOf("dayPeriod").replace(/\./g, "").toUpperCase(),
  };
}

function formatTimeRange(startAt: string, endAt: string, timezone: string) {
  const start = clockParts(startAt, timezone);
  const end = clockParts(endAt, timezone);
  return start.meridiem === end.meridiem
    ? `${start.clock}–${end.clock} ${end.meridiem}`
    : `${start.clock} ${start.meridiem}–${end.clock} ${end.meridiem}`;
}

function formatBlockTime(block: ScheduleBlock, timezone: string) {
  return formatTimeRange(block.start_at, block.end_at, timezone);
}

function formatEntryTime(entry: PlanningEntry, timezone: string) {
  return formatTimeRange(entry.start_at, entry.end_at, timezone);
}

// Generated study titles arrive as "CSC 349A · Plan Assignment 1". Showing the course code
// as an eyebrow keeps the repeated prefix out of the title line, which is the scarcest space
// on a card. Titles without a short leading segment are left untouched.
function splitEventTitle(title: string) {
  const separator = title.indexOf(" · ");
  if (separator <= 0 || separator > 14) return { eyebrow: null, label: title };
  return { eyebrow: title.slice(0, separator), label: title.slice(separator + 3) };
}

// Progressive disclosure by card height: a 30-minute block shows only its title, an hour adds
// the time, and 90 minutes or more also shows the eyebrow. Every card keeps its full text in a
// tooltip and in the details panel.
function cardDensity(duration: number) {
  if (duration <= 1) return "tight" as const;
  if (duration <= 2) return "regular" as const;
  return "roomy" as const;
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
