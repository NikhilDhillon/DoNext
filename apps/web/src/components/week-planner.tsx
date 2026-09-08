"use client";

import {
  ArrowRight,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Copy,
  GripVertical,
  LoaderCircle,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";

import {
  cachedDateFormat,
  calendarLaneLayout,
  clamp,
  fixedEventLabel,
  isDraftDay,
  resolveDragTarget,
  unavailableRuns,
} from "@/components/draft-calendar/lib";
import type { DragTarget } from "@/components/draft-calendar/lib";
import { FormDialog } from "@/components/form-dialog";
import { ScheduleBlockEditor } from "@/components/schedule-block-editor";
import { ScheduleProposalReview } from "@/components/schedule-proposal-review";
import { useApiResource } from "@/hooks/use-api-resource";
import { apiRequest } from "@/lib/api";
import type {
  AvailabilityWindow,
  PlanningEntry,
  PlanningView,
  ScheduleBlock,
  ScheduleProposal,
  Semester,
} from "@/lib/types";

/** One block on the week grid, whether it is already accepted or only proposed. */
type CalendarItem = {
  key: string;
  title: string;
  startAt: string;
  endAt: string;
  tone: string;
  location: string | null;
  draft: boolean;
  entry: PlanningEntry;
  sourceEntry: PlanningEntry | null;
  block: ScheduleBlock | null;
};

type DragSession = {
  block: ScheduleBlock;
  node: HTMLElement;
  pointerId: number;
  /** Where the pointer went down, and where the grid was under it at that moment. */
  originX: number;
  originY: number;
  gridLeft: number;
  gridTop: number;
  /** How far the card may travel before it would leave the grid, as [least, most] per axis. */
  travelX: [number, number];
  travelY: [number, number];
  /** Latest pointer position, read by the animation frame rather than by the move handler. */
  pointerX: number;
  pointerY: number;
  /** A press only becomes a drag once it clears the slop threshold. */
  active: boolean;
  /** The tooltip, taken off the card while it is in the air and handed back afterwards. */
  titleText: string;
  target: DragTarget | null;
};

/** How far a press must travel before it is a drag rather than a click. */
const DRAG_SLOP = { mouse: 4, touch: 8 };
/** How close to the edge of the scroller a drag has to get before the grid follows it. */
const EDGE_SCROLL_ZONE = 72;
const EDGE_SCROLL_SPEED = 17;
/** Minutes per grid row. The row is the finest position a block can be drawn at. */
const ROW_MINUTES = 15;

/** Every tone the calendar can paint, in the order the legend reads. */
const CALENDAR_KEYS = [
  { tone: "violet", label: "Class" },
  { tone: "mint", label: "Focus" },
  { tone: "slate", label: "Commitment" },
  { tone: "coral", label: "Personal" },
  { tone: "blue", label: "Break" },
];

export function WeekPlanner() {
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [autoOpened, setAutoOpened] = useState(false);
  const plan = useApiResource<PlanningView>(weekStart ? `/planning/week?start=${weekStart}` : "/planning/week");
  const semesters = useApiResource<Semester[]>("/semesters");
  const currentSemester = useMemo(
    () => semesters.data?.find((semester) => semester.status === "active") ?? semesters.data?.[0] ?? null,
    [semesters.data],
  );
  const proposal = useApiResource<ScheduleProposal>(
    currentSemester ? `/semesters/${currentSemester.id}/schedule/proposal` : null,
  );
  const availability = useApiResource<AvailabilityWindow[]>("/availability");
  // Today's week is guaranteed empty outside the semester, so the page opens on the nearest week
  // that can hold something. Only on arrival: navigating back here afterwards is deliberate.
  const openOn = !autoOpened && weekStart === null && plan.data && currentSemester
    ? plan.data.end_date < currentSemester.start_date
      ? weekStartFor(currentSemester.start_date)
      : plan.data.start_date > currentSemester.end_date
        ? weekStartFor(currentSemester.end_date)
        : null
    : null;
  if (openOn) {
    // Adjusting state during render rather than in an effect: React re-renders with the new week
    // before committing, so the empty week is never painted. The flag makes it happen once, so
    // navigating back here afterwards is respected.
    setAutoOpened(true);
    setWeekStart(openOn);
  }
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<PlanningEntry | null>(null);
  const [detailsEntry, setDetailsEntry] = useState<PlanningEntry | null>(null);
  const [duplicateEntry, setDuplicateEntry] = useState<PlanningEntry | null>(null);
  const [editorDate, setEditorDate] = useState("");
  const [editingDraft, setEditingDraft] = useState(false);
  const [selectedDay, setSelectedDay] = useState("");
  // Only the landing slot is state: the card itself is moved by writing a transform in the frame
  // loop, so following the pointer costs no render at all and the tree re-renders at most once
  // per fifteen-minute step rather than once per frame.
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [moveStatus, setMoveStatus] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dragSessionRef = useRef<DragSession | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const releaseDragRef = useRef<(() => void) | null>(null);
  // A drag ends with a click on whatever sits under the pointer. Without this the drop would also
  // open the block editor, or punch a "new block" dialog through the empty column behind it.
  const swallowClickRef = useRef(false);
  const pendingSaveRef = useRef(new Map<string, {
    timer: ReturnType<typeof setTimeout>;
    run: () => void;
    origin: ScheduleBlock;
  }>());
  // The now-line is read from the clock at render, so without a tick it freezes wherever the page
  // was last drawn — a page left open overnight still points at last night.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);
  // Keyboard nudges are saved on a short delay so holding an arrow key writes once, not once a
  // repeat. Leaving the page has to send whatever is still waiting.
  const flushPendingSaves = useCallback(() => {
    const pending = [...pendingSaveRef.current.values()];
    pendingSaveRef.current.clear();
    for (const entry of pending) {
      clearTimeout(entry.timer);
      entry.run();
    }
  }, []);
  useEffect(() => () => {
    if (dragFrameRef.current !== null) cancelAnimationFrame(dragFrameRef.current);
    releaseDragRef.current?.();
    flushPendingSaves();
    document.body.classList.remove("dragging-block");
  }, [flushPendingSaves]);
  // A move toast is a passing remark, not something to leave parked on screen: it clears itself,
  // and a fresh one restarts the clock rather than inheriting whatever was left of the last one.
  useEffect(() => {
    if (!moveStatus && !moveError) return;
    const timer = setTimeout(() => {
      setMoveStatus(null);
      setMoveError(null);
    }, moveError ? 5000 : 3200);
    return () => clearTimeout(timer);
  }, [moveStatus, moveError]);

  if ((plan.loading || semesters.loading) && !plan.data) return <WeekState loading message="Building your real week" />;
  if (openOn) return <WeekState loading message={`Opening the ${openOn < (plan.data?.start_date ?? "") ? "last" : "first"} week of your semester`} />;
  if (plan.error || semesters.error) return <WeekState message={plan.error || semesters.error || "The week could not load."} onRetry={plan.reload} />;
  if (!plan.data) return <WeekState loading message="Loading your week" />;

  const data = plan.data;
  const draft = proposal.data;
  const items = mergeWeek(data, draft);
  // Only key the colours actually drawn, so nothing on screen is left without an explanation.
  const legend = CALENDAR_KEYS.filter((key) => items.some((item) => item.tone === key.tone));
  // A week outside the semester cannot hold anything, so an empty grid there is not information.
  const outside = currentSemester && items.length === 0
    ? data.end_date < currentSemester.start_date
      ? "before" as const
      : data.start_date > currentSemester.end_date
        ? "after" as const
        : null
    : null;
  const { startHour, endHour } = calendarBounds(items, data.timezone);
  // Every label sits at the top of its own hour, so the closing hour needs a band to label. One
  // trailing hour gives it that, and leaves the last block room to breathe.
  const axisEnd = Math.min(endHour + 1, 24);
  const hours = Array.from({ length: axisEnd - startHour }, (_, index) => startHour + index);
  // Rows are quarter hours. The grid can only draw a block where a row starts, and a drag that
  // snaps to :15 has to have somewhere to land — on half-hour rows it silently rounded to :00.
  const rows = ((axisEnd - startHour) * 60) / ROW_MINUTES;
  const today = localToday(data.timezone);
  // The arrows sit far from the heading, so the control between them names the week they moved
  // to rather than repeating a label that never changes.
  const weekLabel = formatWeekLabel(data.start_date, data.end_date);
  const showingThisWeek = today >= data.start_date && today <= data.end_date;
  // A pending draft is what the Week page is for while it exists, and it only covers a fortnight.
  // Walking past that shows weeks the draft says nothing about, which reads as an empty plan.
  const draftWeeks = draft
    ? { first: weekStartFor(draft.horizon_start), last: weekStartFor(draft.horizon_end) }
    : null;
  const canGoBack = !draftWeeks || data.start_date > draftWeeks.first;
  const canGoForward = !draftWeeks || data.start_date < draftWeeks.last;
  // Returning "home" means today's week, unless the draft does not reach it.
  const homeWeek = !draftWeeks || showingThisWeek || (
    weekStartFor(today) >= draftWeeks.first && weekStartFor(today) <= draftWeeks.last
  )
    ? null
    : weekStartFor(today) < draftWeeks.first ? draftWeeks.first : draftWeeks.last;
  const nowOffset = nowRowOffset(data, startHour, axisEnd, now);
  const laneLayout = calendarLaneLayout(
    items.flatMap((item) => item.block ? [item.block] : []),
    items.flatMap((item) => item.sourceEntry && !item.draft ? [item.sourceEntry] : []),
    data.timezone,
  );
  // Time no draft block can be dropped on, drawn once and revealed by CSS while a drag is in the
  // air. Showing the rule beats reporting it: the shading is what makes a held landing legible.
  const deadZones = draft
    ? data.days.flatMap((day, index) => (
      isDraftDay(day.date, draft.horizon_start, draft.horizon_end)
        ? unavailableRuns(day.date, availability.data ?? [], startHour * 60, axisEnd * 60)
          .map((run) => ({ column: index + 1, from: run[0], to: run[1], key: `${day.date}:${run[0]}` }))
        : [{ column: index + 1, from: startHour * 60, to: axisEnd * 60, key: `${day.date}:all` }]
    ))
    : [];
  const activeDay = selectedDay && data.days.some((day) => day.date === selectedDay)
    ? selectedDay
    : data.days.some((day) => day.date === today)
      ? today
      : data.start_date;
  const agendaItems = items
    .filter((item) => dateInTimezone(item.startAt, data.timezone) === activeDay)
    .sort((first, second) => first.startAt.localeCompare(second.startAt));

  function openNew(date: string) {
    setSelectedEntry(null);
    setDuplicateEntry(null);
    setEditingDraft(Boolean(draft));
    setEditorDate(date);
    setEditorOpen(true);
  }

  function openItem(item: CalendarItem) {
    if (!item.entry.editable) {
      setDetailsEntry(item.entry);
      return;
    }
    setDuplicateEntry(null);
    setSelectedEntry(item.entry);
    setEditingDraft(item.draft);
    setEditorDate(dateInTimezone(item.startAt, data.timezone));
    setEditorOpen(true);
  }

  function duplicateItem(item: CalendarItem) {
    if (!item.entry || !item.draft) return;
    setSelectedEntry(null);
    setDuplicateEntry(item.entry);
    setEditingDraft(true);
    setEditorDate(dateInTimezone(item.startAt, data.timezone));
    setEditorOpen(true);
  }

  /** The days, geometry and rules a drag is resolved against. Read fresh on every frame. */
  function dragContext() {
    const grid = gridRef.current;
    if (!grid || !draft) return null;
    const bounds = grid.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return {
      bounds,
      geometry: {
        columnWidth: bounds.width / data.days.length,
        pixelsPerMinute: bounds.height / Math.max((axisEnd - startHour) * 60, 1),
      },
    };
  }

  function targetFor(
    block: ScheduleBlock,
    deltaX: number,
    deltaY: number,
    context: NonNullable<ReturnType<typeof dragContext>>,
  ) {
    if (!draft) return null;
    return resolveDragTarget(
      block,
      deltaX,
      deltaY,
      context.geometry,
      data.days.map((day) => day.date),
      startHour,
      axisEnd,
      data.timezone,
      availability.data ?? [],
      draft.horizon_start,
      draft.horizon_end,
      draft.blocks.filter((candidate) => candidate.locked),
    );
  }

  function beginDrag(block: ScheduleBlock, event: ReactPointerEvent<HTMLElement>) {
    // The grip is the only drag target, leaving the rest of every card as one reliable open action.
    if (!draft || event.button !== 0) return;
    const grid = gridRef.current;
    if (!grid) return;
    releaseDragRef.current?.();
    const bounds = grid.getBoundingClientRect();
    const node = event.currentTarget.closest<HTMLElement>(".week-block");
    if (!node) return;
    // A card still walking home from the last drag carries a transform, which would be measured
    // into this drag's travel limits. Put it back on its slot before taking the measurement.
    node.classList.remove("returning");
    node.style.transform = "";
    const card = node.getBoundingClientRect();
    dragSessionRef.current = {
      block,
      node,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      gridLeft: bounds.left,
      gridTop: bounds.top,
      travelX: [bounds.left - card.left, bounds.right - card.right],
      travelY: [bounds.top - card.top, bounds.bottom - card.bottom],
      pointerX: event.clientX,
      pointerY: event.clientY,
      active: false,
      titleText: node.title,
      target: null,
    };
    const slop = event.pointerType === "touch" ? DRAG_SLOP.touch : DRAG_SLOP.mouse;

    // Window listeners rather than pointer capture: capture retargets the click that ends a press,
    // which would cost the block its plain "open the editor" click. These see every move, even the
    // ones that leave the card, and nothing is captured until the press is known to be a drag.
    const onMove = (moveEvent: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || moveEvent.pointerId !== session.pointerId) return;
      session.pointerX = moveEvent.clientX;
      session.pointerY = moveEvent.clientY;
      if (session.active) return;
      if (Math.abs(moveEvent.clientX - session.originX) < slop
        && Math.abs(moveEvent.clientY - session.originY) < slop) return;
      session.active = true;
      session.node.classList.add("lifted");
      // The press has already started a text selection and the browser tooltip is on its way.
      // Neither belongs on a card being dragged.
      session.node.removeAttribute("title");
      window.getSelection()?.removeAllRanges();
      document.body.classList.add("dragging-block");
      setMoveStatus(null);
      setMoveError(null);
      runDragFrames();
    };
    const onUp = (upEvent: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || upEvent.pointerId !== session.pointerId) return;
      finishDrag();
    };
    const onCancel = (cancelEvent: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || cancelEvent.pointerId !== session.pointerId) return;
      cancelDrag();
    };
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      cancelDrag();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    releaseDragRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      releaseDragRef.current = null;
    };
  }

  // One loop for the whole drag rather than a frame per move event: a pointer held still at the
  // edge of the grid still needs the calendar to keep scrolling under it.
  function runDragFrames() {
    if (dragFrameRef.current !== null) return;
    const step = () => {
      const session = dragSessionRef.current;
      if (!session || !session.active) {
        dragFrameRef.current = null;
        return;
      }
      dragFrameRef.current = requestAnimationFrame(step);
      edgeScroll(session);
      paintDrag(session);
    };
    dragFrameRef.current = requestAnimationFrame(step);
  }

  function stopDragFrames() {
    if (dragFrameRef.current === null) return;
    cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = null;
  }

  /** Walk the card to the pointer, and work out which slot that lands it in. */
  function paintDrag(session: DragSession) {
    const context = dragContext();
    if (!context) return;
    // Measured against the grid rather than the viewport, so a calendar that scrolls under the
    // drag — by the wheel, or by the edge scrolling below — does not drift away from the pointer.
    // Held inside the grid. A card carried past the edge would still be laid out where it was
    // dragged to, which grows the scroller's scrollable area — and the edge scrolling below would
    // then chase that growth, running the card off the end of the calendar for as long as the
    // pointer kept pushing.
    const deltaX = clamp(
      session.pointerX - session.originX - (context.bounds.left - session.gridLeft),
      session.travelX[0],
      session.travelX[1],
    );
    const deltaY = clamp(
      session.pointerY - session.originY - (context.bounds.top - session.gridTop),
      session.travelY[0],
      session.travelY[1],
    );
    session.node.style.transform = `translate3d(${Math.round(deltaX)}px, ${Math.round(deltaY)}px, 0)`;
    const target = targetFor(session.block, deltaX, deltaY, context);
    if (!target) return;
    const previous = session.target;
    session.target = target;
    if (previous
      && previous.startAt === target.startAt
      && previous.allowed === target.allowed
      && previous.blockedReason === target.blockedReason) return;
    // The refusal rides on the card under the pointer, where the eye already is, rather than in a
    // red panel somewhere else on the grid.
    session.node.classList.toggle("blocked", !target.allowed);
    document.body.classList.toggle("no-drop", !target.allowed);
    setDragTarget(target);
  }

  /** Near the top or bottom of the calendar, keep scrolling in that direction. */
  function edgeScroll(session: DragSession) {
    const scroller = scrollerRef.current;
    const grid = gridRef.current;
    if (!scroller || !grid) return;
    const bounds = scroller.getBoundingClientRect();
    const speed = (distance: number) => Math.ceil(
      Math.min(Math.max(EDGE_SCROLL_ZONE - distance, 0), EDGE_SCROLL_ZONE) / EDGE_SCROLL_ZONE
        * EDGE_SCROLL_SPEED,
    );
    // Measured off the grid's own layout box rather than the scroller's scrollHeight, which a
    // dragged card can inflate. Scrolling has to stop where the calendar actually ends.
    const limit = Math.max(grid.offsetHeight - scroller.clientHeight, 0);
    const down = speed(bounds.bottom - session.pointerY) - speed(session.pointerY - bounds.top);
    if (down) scroller.scrollTop = clamp(scroller.scrollTop + down, 0, limit);
    const across = speed(bounds.right - session.pointerX) - speed(session.pointerX - bounds.left);
    if (across) {
      const reach = Math.max(scroller.scrollWidth - scroller.clientWidth, 0);
      scroller.scrollLeft = clamp(scroller.scrollLeft + across, 0, reach);
    }
  }

  /** Give the card back to the grid, whether it moved or not. */
  function endDragSession(session: DragSession | null, landed: boolean) {
    stopDragFrames();
    releaseDragRef.current?.();
    dragSessionRef.current = null;
    document.body.classList.remove("dragging-block", "no-drop");
    if (!session) return;
    session.node.classList.remove("blocked");
    if (session.active) {
      swallowClickRef.current = true;
      setTimeout(() => { swallowClickRef.current = false; }, 0);
    }
    session.node.classList.remove("lifted");
    if (!session.active || landed) {
      session.node.style.transform = "";
      return;
    }
    // Nothing came of the drag, so walk the card home instead of teleporting it.
    const node = session.node;
    node.classList.add("returning");
    node.style.transform = "translate3d(0, 0, 0)";
    setTimeout(() => {
      node.classList.remove("returning");
      node.style.transform = "";
    }, 190);
  }

  // Put the tooltip back before anything commits: a landed move changes the time it names, and
  // React only rewrites the attribute when that string actually differs from the last one it set.
  function restoreTitle(session: DragSession | null) {
    if (session?.active) session.node.title = session.titleText;
  }

  function cancelDrag() {
    const session = dragSessionRef.current;
    restoreTitle(session);
    setDragTarget(null);
    endDragSession(session, false);
  }

  function finishDrag() {
    const session = dragSessionRef.current;
    if (!session || !session.active) {
      endDragSession(session, true);
      return;
    }
    restoreTitle(session);
    const target = session.target;
    if (!target || target.unchanged) {
      setDragTarget(null);
      endDragSession(session, false);
      return;
    }
    if (!target.allowed) {
      setDragTarget(null);
      endDragSession(session, false);
      setMoveError(`${target.blockedReason ?? "That slot is not free"} — ${session.block.title} stayed put.`);
      return;
    }
    // The card is sitting on the drop shadow already. Moving the block and dropping the transform
    // in one commit swaps one for the other with nothing drawn in between; without flushSync the
    // card would flick back to the old slot for a frame first.
    flushSync(() => {
      setDragTarget(null);
      applyMove(session.block.id, target.startAt, target.endAt);
    });
    endDragSession(session, true);
    void saveMove(session.block, target.startAt, target.endAt);
  }

  /** Move a block in the draft we are holding, so the grid redraws without waiting for the API. */
  function applyMove(blockId: string, startAt: string, endAt: string) {
    proposal.setData((current) => current && ({
      ...current,
      blocks: current.blocks.map((block) => (
        block.id === blockId ? { ...block, start_at: startAt, end_at: endAt } : block
      )),
    }));
  }

  async function saveMove(block: ScheduleBlock, startAt: string, endAt: string) {
    if (!draft) return;
    setMoveError(null);
    setMoveStatus(`Moved ${block.title} to ${formatMoveTime(startAt, data.timezone)}.`);
    try {
      const saved = await apiRequest<ScheduleBlock>(
        `/schedule-proposals/${draft.id}/blocks/${block.id}`,
        { method: "PATCH", body: JSON.stringify({ start_at: startAt, end_at: endAt }) },
      );
      applyMove(saved.id, saved.start_at, saved.end_at);
    } catch (error) {
      // The move was drawn before it was saved, so a refusal has to take it back off the grid.
      applyMove(block.id, block.start_at, block.end_at);
      setMoveStatus(null);
      setMoveError(error instanceof Error ? error.message : "DoNext could not move that draft block.");
    }
  }

  /** Arrow keys on the grip: the same move, for anyone who is not holding a pointer. */
  function nudgeBlock(block: ScheduleBlock, event: ReactKeyboardEvent<HTMLElement>) {
    const steps: Record<string, [number, number]> = {
      ArrowUp: [0, -ROW_MINUTES],
      ArrowDown: [0, ROW_MINUTES],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const step = steps[event.key];
    if (!step || event.metaKey || event.ctrlKey || event.altKey) return;
    const context = dragContext();
    if (!context) return;
    event.preventDefault();
    const [days, minutes] = step;
    const target = targetFor(
      block,
      days * context.geometry.columnWidth,
      minutes * context.geometry.pixelsPerMinute,
      context,
    );
    if (!target) return;
    if (!target.allowed) {
      setMoveStatus(null);
      setMoveError(`${target.blockedReason ?? "That slot is not free"} — ${block.title} stayed put.`);
      return;
    }
    if (target.unchanged) return;
    applyMove(block.id, target.startAt, target.endAt);
    setMoveError(null);
    setMoveStatus(`Moved ${block.title} to ${formatMoveTime(target.startAt, data.timezone)}.`);
    scheduleSave(block, target.startAt, target.endAt);
  }

  // Held arrow keys repeat several times a second. Saving on a trailing delay sends the slot the
  // student stopped on, and one request rather than a dozen.
  function scheduleSave(block: ScheduleBlock, startAt: string, endAt: string) {
    const pending = pendingSaveRef.current;
    const existing = pending.get(block.id);
    if (existing) clearTimeout(existing.timer);
    // A refusal has to undo the whole burst, so the rollback keeps the slot it started from.
    const origin = existing?.origin ?? block;
    const run = () => {
      pending.delete(block.id);
      void saveMove(origin, startAt, endAt);
    };
    pending.set(block.id, { timer: setTimeout(run, 320), run, origin });
  }

  async function refresh() {
    await Promise.all([plan.reload(), proposal.reload()]);
  }

  return (
    <main className="page-shell week-page">
      <header className="page-heading week-heading">
        <div>
          <p className="eyebrow">{formatDateRange(data.start_date, data.end_date)}</p>
          <h1>Your week</h1>
        </div>
        <div className="heading-actions">
          <div className="week-nav">
            <button
              type="button"
              aria-label="Previous week"
              disabled={!canGoBack}
              onClick={() => setWeekStart(addDays(data.start_date, -7))}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className={`today${showingThisWeek ? " current" : ""}`}
              type="button"
              title={showingThisWeek ? undefined : homeWeek ? "Back to the draft" : "Back to this week"}
              aria-label={showingThisWeek
                ? `Showing ${weekLabel}, the current week`
                : `Showing ${weekLabel}. Back to ${homeWeek ? "the draft" : "this week"}`}
              onClick={() => setWeekStart(homeWeek)}
            >
              {weekLabel}
            </button>
            <button
              type="button"
              aria-label="Next week"
              disabled={!canGoForward}
              onClick={() => setWeekStart(addDays(data.start_date, 7))}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <button className="secondary-button" type="button" onClick={() => openNew(activeDay)}>
            <Plus size={17} /> New block
          </button>
        </div>
      </header>

      {currentSemester ? (
        <ScheduleProposalReview
          semester={currentSemester}
          proposal={proposal}
          onAccepted={refresh}
        />
      ) : null}

      {data.warnings.length > 0 && <p className="planner-alert warning">{data.warnings[0]}</p>}

      <section className="calendar-card" aria-label="Weekly calendar">
        <div className="calendar-header live-calendar-header">
          <div className="timezone">{timezoneName(data.timezone, data.start_date)}</div>
          {data.days.map((day) => (
            <div className={dayHeadClass(day.date, today)} key={day.date}>
              <span>{weekday(day.date)}</span><strong>{dayNumber(day.date)}</strong>
            </div>
          ))}
        </div>
        {outside && currentSemester ? (
          <div className="calendar-outside">
            <span><CalendarRange size={21} /></span>
            <strong>
              {outside === "before"
                ? `${currentSemester.name} starts ${formatCalendarDate(currentSemester.start_date)}.`
                : `${currentSemester.name} ended ${formatCalendarDate(currentSemester.end_date)}.`}
            </strong>
            <p>
              {outside === "before"
                ? "This week comes before it, so there is nothing planned here yet."
                : "This week comes after it, so nothing is planned here."}
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setWeekStart(weekStartFor(
                outside === "before" ? currentSemester.start_date : currentSemester.end_date,
              ))}
            >
              {outside === "before" ? "Go to the first week" : "Go to the last week"}
              <ArrowRight size={15} />
            </button>
          </div>
        ) : (
        <div className="calendar-body live-calendar-body" ref={scrollerRef}>
          <div className="time-axis live-time-axis" style={{ gridTemplateRows: `repeat(${hours.length}, 60px)` }}>
            {hours.map((hour) => <span key={hour}>{formatHour(hour)}</span>)}
          </div>
          <div
            className="calendar-grid live-calendar-grid"
            ref={gridRef}
            style={{ gridTemplateRows: `repeat(${rows}, ${ROW_MINUTES}px)` }}
            onClickCapture={(event) => {
              if (!swallowClickRef.current) return;
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            {Array.from({ length: rows / 2 }, (_, index) => (
              <span
                className="calendar-row-line"
                style={{ gridColumn: "1 / -1", gridRow: `${index * 2 + 1} / span 2` }}
                aria-hidden
                key={`row:${index}`}
              />
            ))}
            {data.days.map((day, index) => (
              // Placed rather than flowed: the row lines above cover every column of every row, so
              // an auto-placed column finds no free track and lands in an implicit one off the end
              // of the week — which widens the grid and skews every horizontal drag with it.
              <button
                className={`day-column${day.date < today ? " past" : ""}`}
                style={{ gridColumn: index + 1, gridRow: "1 / -1" }}
                aria-label={`Add a block on ${formatCalendarDate(day.date)}`}
                type="button"
                onClick={() => openNew(day.date)}
                key={day.date}
              />
            ))}
            {deadZones.map((zone) => (
              <div
                className="week-dead-zone"
                style={{
                  gridColumn: zone.column,
                  gridRow: `${rowForMinute(zone.from, startHour)} / span ${
                    Math.max(Math.round((zone.to - zone.from) / ROW_MINUTES), 1)
                  }`,
                }}
                aria-hidden
                key={zone.key}
              />
            ))}
            {dragTarget?.allowed ? (
              <div
                className="week-drop-shadow"
                style={{
                  gridColumn: dragTarget.dayIndex + 1,
                  gridRow: `${rowForMinute(dragTarget.minuteOfDay, startHour)} / span ${
                    Math.max(Math.round(dragTarget.durationMinutes / ROW_MINUTES), 1)
                  }`,
                }}
                aria-hidden
              >
                <span>{formatTime(dragTarget.startAt, data.timezone)}</span>
              </div>
            ) : null}
            {items.map((item) => (
              <WeekBlock
                item={item}
                timezone={data.timezone}
                weekStart={data.start_date}
                startHour={startHour}
                onOpen={() => openItem(item)}
                onDuplicate={() => duplicateItem(item)}
                lane={laneLayout[item.block ? `draft:${item.block.id}` : `fixed:${item.sourceEntry?.id}`]}
                onDragStart={item.block ? (event) => beginDrag(item.block!, event) : undefined}
                onNudge={item.block ? (event) => nudgeBlock(item.block!, event) : undefined}
                key={item.key}
              />
            ))}
            {nowOffset !== null ? (
              <div
                className="calendar-now"
                style={{ gridColumn: nowOffset.column, gridRow: "1 / -1", top: `${nowOffset.top}px` }}
                aria-hidden
              />
            ) : null}
          </div>
        </div>
        )}
        {outside ? null : (
        <div className="calendar-foot">
          <div className="calendar-keys">
            {legend.map((key) => <span key={key.tone}><i className={key.tone} /> {key.label}</span>)}
            {draft ? <span><i className="dash" /> Draft</span> : null}
          </div>
          <span>{draft ? "Solid blocks are accepted · dashed blocks are this draft" : "Every block here is accepted"}</span>
        </div>
        )}
      </section>

      <section className="mobile-week-agenda" aria-label="Weekly agenda">
        <div className="mobile-week-days" aria-label="Choose a day">
          {data.days.map((day) => (
            <button
              className={`${day.date === activeDay ? "active" : ""}${day.date === today ? " today" : ""}`}
              type="button"
              aria-pressed={day.date === activeDay}
              onClick={() => setSelectedDay(day.date)}
              key={day.date}
            >
              <span>{weekday(day.date)}</span>
              <strong>{dayNumber(day.date)}</strong>
            </button>
          ))}
        </div>
        <div className="mobile-week-list">
          <header>
            <div>
              <p className="eyebrow">{formatCalendarDate(activeDay)}</p>
              <h2>{agendaItems.length ? `${agendaItems.length} planned ${agendaItems.length === 1 ? "block" : "blocks"}` : "Open day"}</h2>
            </div>
            <button type="button" aria-label={`Add a block on ${formatCalendarDate(activeDay)}`} onClick={() => openNew(activeDay)}>
              <Plus size={18} />
            </button>
          </header>
          {agendaItems.length ? agendaItems.map((item) => (
            <MobileAgendaItem
              item={item}
              timezone={data.timezone}
              onOpen={() => openItem(item)}
              onDuplicate={() => duplicateItem(item)}
              key={item.key}
            />
          )) : outside && currentSemester ? (
            <p className="mobile-week-outside">
              {outside === "before"
                ? `${currentSemester.name} starts ${formatCalendarDate(currentSemester.start_date)}, after this week.`
                : `${currentSemester.name} ended ${formatCalendarDate(currentSemester.end_date)}, before this week.`}
              <button
                type="button"
                onClick={() => setWeekStart(weekStartFor(
                  outside === "before" ? currentSemester.start_date : currentSemester.end_date,
                ))}
              >
                {outside === "before" ? "Go to the first week" : "Go to the last week"}
                <ArrowRight size={13} />
              </button>
            </p>
          ) : (
            <button className="mobile-week-empty" type="button" onClick={() => openNew(activeDay)}>
              <Plus size={17} /> Add focused work or a commitment
            </button>
          )}
        </div>
      </section>

      <div className="week-status" aria-live="polite">
        {dragTarget ? (
          <span>
            {!dragTarget.allowed
              ? dragTarget.blockedReason
              : dragTarget.clamped
                ? `${formatMoveTime(dragTarget.startAt, data.timezone)} · nearest open slot`
                : formatMoveTime(dragTarget.startAt, data.timezone)}
          </span>
        ) : null}
        {!dragTarget && moveStatus ? <span>{moveStatus}</span> : null}
        {!dragTarget && moveError ? <span className="error">{moveError}</span> : null}
      </div>

      {currentSemester && (
        <ScheduleBlockEditor
          open={editorOpen}
          semesterId={currentSemester.id}
          proposalId={editingDraft && draft ? draft.id : undefined}
          date={editorDate || data.start_date}
          tasks={data.unscheduled_tasks}
          entry={selectedEntry}
          duplicateOf={duplicateEntry}
          suggestedTask={null}
          onClose={() => setEditorOpen(false)}
          onSaved={refresh}
        />
      )}
      {detailsEntry ? (
        <FormDialog
          open
          title={detailsEntry.title}
          description="This is a fixed event that DoNext plans around."
          onClose={() => setDetailsEntry(null)}
        >
          <dl className="calendar-block-details">
            <div><dt>When</dt><dd>{formatEventRange(detailsEntry, data.timezone)}</dd></div>
            <div><dt>Type</dt><dd>{fixedEventLabel(detailsEntry)}</dd></div>
            {detailsEntry.location ? <div><dt>Location</dt><dd>{detailsEntry.location}</dd></div> : null}
            <div><dt>Schedule</dt><dd>{detailsEntry.recurring ? "Recurring" : "One time"}</dd></div>
          </dl>
          <div className="dialog-actions">
            <button className="primary-button" type="button" onClick={() => setDetailsEntry(null)}>Done</button>
          </div>
        </FormDialog>
      ) : null}
    </main>
  );
}

/**
 * One calendar, one truth. Fixed events always show. Before the draft's horizon the accepted plan
 * is what the student has, so it shows; from the horizon onward the draft is the proposal for that
 * time, so showing both would double-book every day on screen.
 */
function mergeWeek(data: PlanningView, draft: ScheduleProposal | null): CalendarItem[] {
  const accepted = data.entries
    .filter((entry) => {
      if (!draft) return true;
      if (entry.kind === "fixed_event") return true;
      return dateInTimezone(entry.start_at, data.timezone) < draft.horizon_start;
    })
    .map((entry) => ({
      key: entry.id,
      title: entry.title,
      startAt: entry.start_at,
      endAt: entry.end_at,
      tone: entryColor(entry),
      location: entry.location,
      draft: false,
      entry,
      sourceEntry: entry,
      block: null,
    }));
  if (!draft) return accepted;
  const drafted = draft.blocks
    .filter((block) => {
      const date = dateInTimezone(block.start_at, data.timezone);
      return date >= data.start_date
        && date <= data.end_date
        && date >= draft.horizon_start
        && date <= draft.horizon_end;
    })
    .map((block) => ({
      key: `proposal:${block.id}`,
      title: block.title,
      startAt: block.start_at,
      endAt: block.end_at,
      tone: blockColor(block.block_type),
      location: null,
      draft: true,
      entry: blockEntry(block),
      sourceEntry: null,
      block,
    }));
  return [...accepted, ...drafted];
}

/** The first row of the grid a minute of the day falls on. Rows are quarter hours. */
function rowForMinute(minuteOfDay: number, startHour: number) {
  return Math.max(Math.floor((minuteOfDay - startHour * 60) / ROW_MINUTES) + 1, 1);
}

function WeekBlock({
  item,
  timezone,
  weekStart,
  startHour,
  lane,
  onOpen,
  onDuplicate,
  onDragStart,
  onNudge,
}: {
  item: CalendarItem;
  timezone: string;
  weekStart: string;
  startHour: number;
  lane?: { lane: number; laneCount: number };
  onOpen: () => void;
  onDuplicate: () => void;
  onDragStart?: (event: ReactPointerEvent<HTMLElement>) => void;
  onNudge?: (event: ReactKeyboardEvent<HTMLElement>) => void;
}) {
  const start = timeParts(item.startAt, timezone);
  const duration = Math.max(
    Math.round((new Date(item.endAt).getTime() - new Date(item.startAt).getTime()) / 60_000 / ROW_MINUTES),
    1,
  );
  const row = rowForMinute(start.hour * 60 + start.minute, startHour);
  const column = Math.min(Math.max(dateDifference(weekStart, dateInTimezone(item.startAt, timezone)) + 1, 1), 7);
  // The class list is held still for the length of a drag: React rewrites the attribute whole, so
  // a change here would wipe the "lifted" class the drag adds to this same node by hand.
  const className = `week-block ${item.tone}${item.draft ? " draft" : ""}${item.entry.editable ? " editable" : ""}${onDragStart ? " draggable" : ""}`;
  const style = {
    gridColumn: column,
    gridRow: `${row} / span ${duration}`,
    width: lane && lane.laneCount > 1 ? `calc(${100 / lane.laneCount}% - 7px)` : undefined,
    marginLeft: lane && lane.laneCount > 1 ? `calc(${lane.lane * (100 / lane.laneCount)}% + 4px)` : undefined,
  };
  const copy = (
    <>
      <strong>{item.title}</strong>
      <span>{formatTime(item.startAt, timezone)}{item.location ? ` · ${item.location}` : ""}</span>
    </>
  );
  return (
    <article
      className={className}
      style={style}
      title={`${item.title}, ${formatTime(item.startAt, timezone)}`}
    >
      <button
        className="week-block-open"
        type="button"
        aria-label={`${item.entry.editable ? "Edit" : "Open"} ${item.title}`}
        onClick={onOpen}
      >
        {copy}
      </button>
      {item.draft ? (
        <div className="week-block-tools">
          <button
            className="week-block-duplicate"
            type="button"
            aria-label={`Duplicate ${item.title}`}
            onClick={onDuplicate}
          >
            <Copy size={12} />
          </button>
          <button
            className="week-block-grab"
            type="button"
            aria-label={`Move ${item.title}. Drag it, or use the arrow keys.`}
            onPointerDown={onDragStart}
            onKeyDown={onNudge}
          >
            <GripVertical size={13} />
          </button>
        </div>
      ) : null}
    </article>
  );
}


function MobileAgendaItem({
  item,
  timezone,
  onOpen,
  onDuplicate,
}: {
  item: CalendarItem;
  timezone: string;
  onOpen: () => void;
  onDuplicate: () => void;
}) {
  const content = (
    <>
      <time>{formatTime(item.startAt, timezone)}</time>
      <span><strong>{item.title}</strong>{item.location ? <small>{item.location}</small> : null}</span>
    </>
  );
  return (
    <article className={`mobile-week-item ${item.tone}${item.draft ? " draft" : ""}`}>
      <button
        type="button"
        aria-label={`${item.entry.editable ? "Edit" : "Open"} ${item.title}`}
        onClick={onOpen}
      >
        {content}
      </button>
      {item.draft ? (
        <button className="mobile-week-copy" type="button" aria-label={`Duplicate ${item.title}`} onClick={onDuplicate}>
          <Copy size={15} />
        </button>
      ) : null}
    </article>
  );
}

function WeekState({ loading = false, message, onRetry }: { loading?: boolean; message: string; onRetry?: () => Promise<void> }) {
  return <main className="page-shell planner-state">{loading && <LoaderCircle className="spin" size={26} />}<h1>{message}</h1><p>{loading ? "DoNext is expanding commitments and reading your accepted schedule." : "Your saved data is unchanged."}</p>{onRetry && <button className="primary-button" type="button" onClick={onRetry}>Try again</button>}</main>;
}

function blockEntry(block: ScheduleBlock): PlanningEntry {
  return {
    id: `proposal:${block.id}`,
    kind: "scheduled_block",
    source_id: block.id,
    title: block.title,
    start_at: block.start_at,
    end_at: block.end_at,
    block_type: block.block_type,
    category: block.block_type,
    location: null,
    task_id: block.task_id,
    task_status: null,
    goal_id: block.goal_id,
    course_code: null,
    locked: block.locked,
    recurring: false,
    editable: true,
  };
}

function dayHeadClass(date: string, today: string) {
  if (date === today) return "today";
  return date < today ? "past" : undefined;
}

/** Where the red now-line sits, or null when today is not in the visible week. */
function nowRowOffset(data: PlanningView, startHour: number, endHour: number, at: number) {
  const today = localToday(data.timezone);
  const index = dateDifference(data.start_date, today);
  if (index < 0 || index > 6) return null;
  const now = timeParts(new Date(at).toISOString(), data.timezone);
  const minutes = now.hour * 60 + now.minute - startHour * 60;
  if (minutes < 0 || minutes > (endHour - startHour) * 60) return null;
  return { column: index + 1, top: (minutes / 60) * 60 };
}

function calendarBounds(items: CalendarItem[], timezone: string) {
  if (!items.length) return { startHour: 8, endHour: 18 };
  const starts = items.map((item) => timeParts(item.startAt, timezone).hour);
  const ends = items.map((item) => {
    const end = timeParts(item.endAt, timezone);
    return end.hour + (end.minute ? 1 : 0);
  });
  return { startHour: Math.max(Math.min(8, ...starts), 0), endHour: Math.min(Math.max(18, ...ends), 24) };
}

function timeParts(value: string, timezone: string) {
  const parts = cachedDateFormat("en-CA", { hour: "numeric", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).formatToParts(new Date(value));
  return { hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0), minute: Number(parts.find((part) => part.type === "minute")?.value ?? 0) };
}

function dateInTimezone(value: string, timezone: string) {
  const parts = cachedDateFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).formatToParts(new Date(value));
  const valueOf = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`;
}

function dateDifference(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The Monday of the week holding `date`, matching how the week endpoint picks today's week. */
function weekStartFor(date: string) {
  const weekdayIndex = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -weekdayIndex);
}

function localToday(timezone: string) {
  return dateInTimezone(new Date().toISOString(), timezone);
}

/** The week in the smallest form that still reads as a date: "Sep 7–13", "Sep 28–Oct 4". */
function formatWeekLabel(start: string, end: string) {
  const month = cachedDateFormat("en-CA", { month: "short", timeZone: "UTC" });
  const day = cachedDateFormat("en-CA", { day: "numeric", timeZone: "UTC" });
  const from = new Date(`${start}T12:00:00Z`);
  const to = new Date(`${end}T12:00:00Z`);
  const tail = month.format(from) === month.format(to)
    ? day.format(to)
    : `${month.format(to)} ${day.format(to)}`;
  return `${month.format(from)} ${day.format(from)}–${tail}`;
}

function formatDateRange(start: string, end: string) {
  const formatter = cachedDateFormat("en-CA", { month: "long", day: "numeric", timeZone: "UTC" });
  return `${formatter.format(new Date(`${start}T12:00:00Z`))} – ${formatter.format(new Date(`${end}T12:00:00Z`))}`;
}

function weekday(value: string) {
  return cachedDateFormat("en-CA", { weekday: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function dayNumber(value: string) {
  return new Date(`${value}T12:00:00Z`).getUTCDate();
}

function formatCalendarDate(value: string) {
  return cachedDateFormat("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function timezoneName(timezone: string, date: string) {
  return cachedDateFormat("en-CA", { timeZone: timezone, timeZoneName: "short" }).formatToParts(new Date(`${date}T12:00:00Z`)).find((part) => part.type === "timeZoneName")?.value ?? timezone;
}

function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 || 12;
  return `${display} ${suffix}`;
}

function formatTime(value: string, timezone: string) {
  return cachedDateFormat("en-CA", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}

function formatEventRange(entry: PlanningEntry, timezone: string) {
  const day = cachedDateFormat("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  }).format(new Date(entry.start_at));
  return `${day}, ${formatTime(entry.start_at, timezone)}–${formatTime(entry.end_at, timezone)}`;
}

function formatMoveTime(value: string, timezone: string) {
  return cachedDateFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

function blockColor(blockType: ScheduleBlock["block_type"]) {
  if (blockType === "goal" || blockType === "personal") return "coral";
  if (blockType === "break") return "blue";
  if (blockType === "commitment") return "slate";
  return "mint";
}

function entryColor(entry: PlanningEntry) {
  if (entry.kind === "fixed_event") return entry.category === "class" ? "violet" : "slate";
  if (entry.block_type === "goal" || entry.block_type === "personal") return "coral";
  if (entry.block_type === "break") return "blue";
  if (entry.block_type === "commitment") return "slate";
  return "mint";
}
