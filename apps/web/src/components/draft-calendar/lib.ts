import type { AvailabilityWindow, PlanningEntry, ScheduleBlock } from "@/lib/types";

// Date, focus-hour, overlap, and formatting helpers for the draft calendar. These are moved
// verbatim from the calendar component so the scheduling rules stay in one place while the
// presentation is rebuilt around them.

// Building an Intl formatter costs ~30x what using one does, and the calendar formats every
// block on every render — including every frame of a drag. They are immutable, so keep them.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

export function cachedDateFormat(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = dateFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormatters.set(key, formatter);
  }
  return formatter;
}

export type UnscheduledItem = {
  id: string;
  name: string;
  remaining_minutes: number;
  reason_code?: string;
  reason: string;
};

// Unscheduled identifiers arrive as "task:<id>", "goal:<id>:<date>" or "flex:<id>…".
// Only the leading kind and id are meaningful when linking a newly placed block.
export function unscheduledLink(identifier: string) {
  const [kind, id] = identifier.split(":");
  if (!id) return null;
  if (kind === "task") return { taskId: id, goalId: null, blockType: "focus" as const };
  if (kind === "goal" || kind === "flex") return { taskId: null, goalId: id, blockType: "goal" as const };
  return null;
}

export type DragPreview = {
  blockId: string;
  startAt: string;
  endAt: string;
};

export type EventLane = {
  lane: number;
  laneCount: number;
};

export function calendarLaneLayout(
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

export function currentTimePosition(
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

export function blockPayload(block: ScheduleBlock) {
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

/** Where a drag currently points, whether or not the block may actually land there. */
export type DragTarget = {
  blockId: string;
  /** Column the block would land in, as an index into the visible days. */
  dayIndex: number;
  /** Snapped start, in minutes from midnight in the calendar's timezone. */
  minuteOfDay: number;
  durationMinutes: number;
  startAt: string;
  endAt: string;
  /** Whether a drop here would be accepted. */
  allowed: boolean;
  /** True when the landing was held back from where the pointer asked for it. */
  clamped: boolean;
  /** Why it would not be, short enough to sit on the drop shadow. */
  blockedReason: string | null;
  /** True when the target is where the block already sits, so dropping is a no-op. */
  unchanged: boolean;
};

export type DragGeometry = {
  /** Width of one day column in pixels. */
  columnWidth: number;
  /** Height of one minute of the day in pixels. */
  pixelsPerMinute: number;
};

/**
 * Resolve a pointer delta into the slot the block would land in.
 *
 * The target is always clamped into the grid rather than refused: a drag that wanders past the
 * last day, above the first hour, or over an evening with no focus time still tracks the pointer
 * and reports the nearest legal slot, with `allowed` saying whether the drop would be taken. A
 * mid-drag null — which an earlier version returned for each of those cases — reads on screen as
 * the card snapping home on every stray pixel.
 */
export function resolveDragTarget(
  block: ScheduleBlock,
  deltaX: number,
  deltaY: number,
  geometry: DragGeometry,
  days: string[],
  startHour: number,
  endHour: number,
  timezone: string,
  availability: AvailabilityWindow[],
  horizonStart: string,
  horizonEnd: string,
  lockedBlocks: ScheduleBlock[] = [],
  snapMinutes = 15,
): DragTarget | null {
  if (!days.length || geometry.columnWidth <= 0 || geometry.pixelsPerMinute <= 0) return null;
  const originalDayIndex = clamp(
    dateDifference(days[0], dateInTimezone(block.start_at, timezone)),
    0,
    days.length - 1,
  );
  const dayIndex = clamp(
    originalDayIndex + Math.round(deltaX / geometry.columnWidth),
    0,
    days.length - 1,
  );
  const targetDate = days[dayIndex];
  const durationMinutes = Math.max(
    Math.round((new Date(block.end_at).getTime() - new Date(block.start_at).getTime()) / 60_000),
    15,
  );
  const calendarMinutes = (endHour - startHour) * 60;
  const originalStart = timeParts(block.start_at, timezone);
  const originalMinutes = originalStart.hour * 60 + originalStart.minute - startHour * 60;
  const snapped = Math.round(
    (originalMinutes + deltaY / geometry.pixelsPerMinute) / snapMinutes,
  ) * snapMinutes;
  const requested = startHour * 60
    + clamp(snapped, 0, Math.max(calendarMinutes - durationMinutes, 0));

  // Rather than refuse a drop over an evening or a locked block, hold the landing at the nearest
  // slot that would take it. Paired with the shading the calendar draws over unavailable time, a
  // drag that reaches for 8am reads as being held at the start of the day, not as a rejection —
  // and the only refusals left are days that could not hold the block anywhere.
  const withinHorizon = isDraftDay(targetDate, horizonStart, horizonEnd);
  const openRuns = withinHorizon
    ? droppableRuns(
      targetDate,
      availability,
      lockedBlocks.filter((locked) => locked.id !== block.id),
      timezone,
      startHour * 60,
      endHour * 60,
    )
    : [];
  const landings = openRuns.flatMap(([from, to]) => {
    const earliest = Math.ceil(from / snapMinutes) * snapMinutes;
    const latest = Math.floor((to - durationMinutes) / snapMinutes) * snapMinutes;
    return latest >= earliest ? [clamp(requested, earliest, latest)] : [];
  });
  const landing = landings.length
    ? landings.reduce((best, candidate) => (
      Math.abs(candidate - requested) < Math.abs(best - requested) ? candidate : best
    ))
    : null;
  const minuteOfDay = landing ?? requested;
  const startAt = zonedDateTimeToIso(
    targetDate,
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60,
    timezone,
  );
  return {
    blockId: block.id,
    dayIndex,
    minuteOfDay,
    durationMinutes,
    startAt,
    endAt: new Date(new Date(startAt).getTime() + durationMinutes * 60_000).toISOString(),
    allowed: landing !== null,
    clamped: landing !== null && landing !== requested,
    blockedReason: landing === null
      ? dayBlockedReason(targetDate, withinHorizon, openRuns.length > 0)
      : null,
    unchanged: new Date(startAt).getTime() === new Date(block.start_at).getTime(),
  };
}

// Only whole days are refused now, so the reason names the day rather than the rule: a student
// reading "No focus hours on Saturday" learns something "Outside your focus hours" never told them.
function dayBlockedReason(date: string, withinHorizon: boolean, hasOpenTime: boolean) {
  if (!withinHorizon) return `${weekdayLong(date)} is outside this draft`;
  return hasOpenTime ? `No room left on ${weekdayLong(date)}` : `No focus hours on ${weekdayLong(date)}`;
}

/** Focus time on a date with the locked blocks taken out of it, clipped to the drawn calendar. */
export function droppableRuns(
  date: string,
  availability: AvailabilityWindow[],
  lockedBlocks: ScheduleBlock[],
  timezone: string,
  axisStart: number,
  axisEnd: number,
) {
  const taken = mergeMinuteIntervals(
    lockedBlocks
      .filter((locked) => dateInTimezone(locked.start_at, timezone) === date)
      .map((locked) => blockMinuteRange(locked, timezone)),
  );
  const drawn = focusIntervalsForDate(date, availability)
    .map(([from, to]) => [Math.max(from, axisStart), Math.min(to, axisEnd)])
    .filter(([from, to]) => to > from);
  return taken.reduce(
    (remaining, interval) => remaining.flatMap((run) => subtractMinuteInterval(run, interval)),
    drawn,
  );
}

function blockMinuteRange(block: ScheduleBlock, timezone: string) {
  const start = timeParts(block.start_at, timezone);
  return [
    start.hour * 60 + start.minute,
    endMinuteForBlock(block.start_at, block.end_at, timezone, timeParts(block.end_at, timezone)),
  ];
}

/** The stretches of a drawn day that no draft block may be dropped on. */
export function unavailableRuns(
  date: string,
  availability: AvailabilityWindow[],
  axisStart: number,
  axisEnd: number,
) {
  return focusIntervalsForDate(date, availability).reduce(
    (remaining, focus) => remaining.flatMap((run) => subtractMinuteInterval(run, focus)),
    [[axisStart, axisEnd]] as number[][],
  );
}

export function placementFromPointer(
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
  gutterWidth = 0,
): DragPreview | null {
  if (!grid || !days.length) return null;
  const bounds = grid.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const target = resolveDragTarget(
    block,
    clientX - originX,
    clientY - originY,
    {
      columnWidth: Math.max((bounds.width - gutterWidth) / days.length, 1),
      pixelsPerMinute: bounds.height / Math.max((endHour - startHour) * 60, 1),
    },
    days,
    startHour,
    endHour,
    timezone,
    availability,
    horizonStart,
    horizonEnd,
  );
  if (!target || !target.allowed) return null;
  return { blockId: target.blockId, startAt: target.startAt, endAt: target.endAt };
}

export function zonedDateTimeToIso(dateValue: string, hour: number, minute: number, timezone: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desiredUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = cachedDateFormat("en-CA", {
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

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function formatMoveTime(value: string, timezone: string) {
  return cachedDateFormat("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

export function calendarBounds(
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

export function focusBounds(windows: AvailabilityWindow[]) {
  const positive = windows.filter((window) => window.type !== "unavailable");
  if (!positive.length) return { startHour: 8, endHour: 18 };
  const starts = positive.map((window) => clockMinutes(window.start_time));
  const ends = positive.map((window) => endClockMinutes(window.end_time));
  return {
    startHour: Math.floor(Math.min(...starts) / 60),
    endHour: Math.ceil(Math.max(...ends) / 60),
  };
}

export function blockFitsFocusHours(
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

export function entryFitsCalendar(
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

export function focusIntervalsForDate(date: string, windows: AvailabilityWindow[]) {
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

export function mergeMinuteIntervals(intervals: number[][]) {
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

export function subtractMinuteInterval(interval: number[], exclusion: number[]) {
  const [start, end] = interval;
  const [excludedStart, excludedEnd] = exclusion;
  if (excludedEnd <= start || excludedStart >= end) return [interval];
  const remaining: number[][] = [];
  if (excludedStart > start) remaining.push([start, Math.min(excludedStart, end)]);
  if (excludedEnd < end) remaining.push([Math.max(excludedEnd, start), end]);
  return remaining;
}

// Runs of focus time on a date with nothing scheduled in them. Used to turn empty space into
// explicit "N open" targets when a column is wide enough to label them.
export function openFocusRuns(
  date: string,
  windows: AvailabilityWindow[],
  busy: number[][],
  minimumMinutes: number,
) {
  const merged = mergeMinuteIntervals(busy.map((interval) => [...interval]));
  return merged
    .reduce(
      (remaining, taken) => remaining.flatMap((interval) => subtractMinuteInterval(interval, taken)),
      focusIntervalsForDate(date, windows),
    )
    .filter(([from, to]) => to - from >= minimumMinutes);
}

export function hasFocusTime(date: string, windows: AvailabilityWindow[]) {
  return focusIntervalsForDate(date, windows).length > 0;
}

export function clockMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function endClockMinutes(value: string) {
  const minutes = clockMinutes(value);
  return minutes === 0 ? 24 * 60 : minutes;
}

export function endMinuteForBlock(
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

export function formatFocusHours(windows: AvailabilityWindow[]) {
  const positive = windows.filter((window) => window.type !== "unavailable");
  if (!positive.length) return "No focus time saved";
  const start = Math.min(...positive.map((window) => clockMinutes(window.start_time)));
  const end = Math.max(...positive.map((window) => endClockMinutes(window.end_time)));
  return `${formatClockMinutes(start)}–${formatClockMinutes(end)}`;
}

export function formatClockMinutes(value: number) {
  const hour = Math.floor(value / 60) % 24;
  const minute = value % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function dayEntryLabel(
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

export function fixedEventLabel(entry: PlanningEntry) {
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

export function fixedEventColor(entry: PlanningEntry) {
  if (entry.category === "class") return "violet";
  if (entry.category === "work") return "slate";
  if (entry.category === "appointment" || entry.category === "health") return "blue";
  if (entry.category === "gym") return "mint";
  return "amber";
}

export function blockColor(block: ScheduleBlock) {
  if (block.block_type === "goal" || block.block_type === "personal") return "coral";
  if (block.block_type === "break") return "blue";
  if (block.block_type === "commitment") return "slate";
  return "mint";
}

export function clockParts(value: string, timezone: string) {
  const parts = cachedDateFormat("en-US", {
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

export function formatTimeRange(startAt: string, endAt: string, timezone: string) {
  const start = clockParts(startAt, timezone);
  const end = clockParts(endAt, timezone);
  return start.meridiem === end.meridiem
    ? `${start.clock}–${end.clock} ${end.meridiem}`
    : `${start.clock} ${start.meridiem}–${end.clock} ${end.meridiem}`;
}

export function formatBlockTime(block: ScheduleBlock, timezone: string) {
  return formatTimeRange(block.start_at, block.end_at, timezone);
}

export function formatEntryTime(entry: PlanningEntry, timezone: string) {
  return formatTimeRange(entry.start_at, entry.end_at, timezone);
}

// Generated study titles arrive as "CSC 349A · Plan Assignment 1". Showing the course code
// as an eyebrow keeps the repeated prefix out of the title line, which is the scarcest space
// on a card. Titles without a short leading segment are left untouched.
export function splitEventTitle(title: string) {
  const separator = title.indexOf(" · ");
  if (separator <= 0 || separator > 14) return { eyebrow: null, label: title };
  return { eyebrow: title.slice(0, separator), label: title.slice(separator + 3) };
}

// Progressive disclosure by card height: a 30-minute block shows only its title, an hour adds
// the time, and 90 minutes or more also shows the eyebrow. Every card keeps its full text in a
// tooltip and in the details panel.
export function cardDensity(duration: number) {
  if (duration <= 1) return "tight" as const;
  if (duration <= 2) return "regular" as const;
  return "roomy" as const;
}

export function timeParts(value: string, timezone: string) {
  const parts = cachedDateFormat("en-CA", {
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

export function dateInTimezone(value: string, timezone: string) {
  const parts = cachedDateFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const valueOf = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`;
}

export function dateDifference(start: string, end: string) {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

export function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mondayOnOrBefore(value: string) {
  const day = new Date(`${value}T12:00:00Z`).getUTCDay();
  return addDays(value, -((day + 6) % 7));
}

export function isDraftDay(value: string, horizonStart: string, horizonEnd: string) {
  return value >= horizonStart && value <= horizonEnd;
}

export function weekdayLong(value: string) {
  return cachedDateFormat("en-CA", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

export function weekday(value: string) {
  return cachedDateFormat("en-CA", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

export function dayNumber(value: string) {
  return new Date(`${value}T12:00:00Z`).getUTCDate();
}

export function formatCalendarDate(value: string) {
  return cachedDateFormat("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function formatRange(start: string, end: string) {
  const startDate = new Date(`${start}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  const sameMonth = startDate.getUTCMonth() === endDate.getUTCMonth();
  const startFormatter = cachedDateFormat("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const endFormatter = cachedDateFormat("en-CA", {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${startFormatter.format(startDate)}–${endFormatter.format(endDate)}`;
}

export function timezoneName(timezone: string, date: string) {
  return cachedDateFormat("en-CA", {
    timeZone: timezone,
    timeZoneName: "short",
  }).formatToParts(new Date(`${date}T12:00:00Z`))
    .find((part) => part.type === "timeZoneName")?.value ?? timezone;
}

export function formatHour(hour: number) {
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12} ${suffix}`;
}
