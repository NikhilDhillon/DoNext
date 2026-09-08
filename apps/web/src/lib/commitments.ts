import { zonedDateTimeToIso } from "@/lib/date-time";
import type { AvailabilityWindow, FixedEvent, Goal } from "@/lib/types";

// Monday-first, matching the API's AvailabilityWindow.day_of_week and RRULE BYDAY handling.
export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const RRULE_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

export const COMMITMENT_CATEGORIES = [
  ["work", "Work"],
  ["gym", "Gym or fitness"],
  ["appointment", "Appointment"],
  ["club", "Club or team"],
  ["health", "Health"],
  ["career", "Career"],
  ["creative", "Creative"],
  ["learning", "Learning"],
  ["personal", "Personal"],
  ["commute", "Commute"],
  ["other", "Anything else"],
] as const;

export const GOAL_CATEGORIES = [
  ["personal", "Personal"],
  ["health", "Health"],
  ["career", "Career"],
  ["creative", "Creative"],
  ["learning", "Learning"],
] as const;

export const PRIORITIES = [
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
  ["optional", "Optional"],
] as const;

export const COMMITMENT_DURATIONS = [
  ["30", "30 min"],
  ["45", "45 min"],
  ["60", "1 hour"],
  ["75", "1h 15m"],
  ["90", "1h 30m"],
  ["120", "2 hours"],
  ["180", "3 hours"],
  ["240", "4 hours"],
  ["300", "5 hours"],
  ["480", "8 hours"],
] as const;

/** Today's date in the account timezone as YYYY-MM-DD. */
export function todayInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** The first date on or after `fromDate` (YYYY-MM-DD) that falls on Monday-first `weekday`. */
export function firstDateOnWeekday(fromDate: string, weekday: number): string {
  const date = new Date(`${fromDate}T12:00:00Z`);
  const current = (date.getUTCDay() + 6) % 7; // convert JS Sunday=0 to Monday=0
  date.setUTCDate(date.getUTCDate() + ((weekday - current + 7) % 7));
  return date.toISOString().slice(0, 10);
}

/** Build a weekly RRULE. `until` is an inclusive YYYY-MM-DD end date, or null for an ongoing routine. */
export function weeklyRecurrenceRule(weekdays: number[], until: string | null): string {
  const byday = weekdays.map((day) => RRULE_DAYS[day]).join(",");
  const rule = `FREQ=WEEKLY;BYDAY=${byday}`;
  if (!until) return rule;
  return `${rule};UNTIL=${until.replaceAll("-", "")}T235959Z`;
}

export type ParsedRecurrence = { weekdays: number[]; until: string | null };

export function parseWeeklyRecurrence(rule: string | null): ParsedRecurrence | null {
  if (!rule) return null;
  const parts = new Map(
    rule
      .split(";")
      .map((part) => part.split("=", 2))
      .filter((pair): pair is [string, string] => pair.length === 2),
  );
  if (parts.get("FREQ") !== "WEEKLY" || !parts.get("BYDAY")) return null;
  const weekdays = parts
    .get("BYDAY")!
    .split(",")
    .map((code) => RRULE_DAYS.indexOf(code as (typeof RRULE_DAYS)[number]))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  const untilText = parts.get("UNTIL");
  let until: string | null = null;
  if (untilText && /^\d{8}/.test(untilText)) {
    until = `${untilText.slice(0, 4)}-${untilText.slice(4, 6)}-${untilText.slice(6, 8)}`;
  }
  return { weekdays, until };
}

export type CommitmentBucket = "fixed" | "flexible" | "goal";

export function goalBucket(goal: Goal): CommitmentBucket {
  return goal.planning_kind === "flexible_commitment" ? "flexible" : "goal";
}

/** Fixed commitments are every fixed event that is not a class meeting. */
export function isCommitmentEvent(event: FixedEvent): boolean {
  return event.category !== "class";
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export function formatWeekdayList(weekdays: number[]): string {
  if (weekdays.length === 7) return "Every day";
  if (weekdays.length === 5 && weekdays.every((day) => day < 5)) return "Weekdays";
  return weekdays.map((day) => WEEKDAYS[day].slice(0, 3)).join(", ");
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** A single meeting of a fixed commitment, before it becomes one or more calendar events. */
export type CommitmentDayTime = { weekday: number; startTime: string; durationMinutes: number };

export type FixedCommitmentDraft = {
  title: string;
  category: string;
  priority: string;
  location: string | null;
  commuteBeforeMinutes: number;
  commuteAfterMinutes: number;
  repeats: boolean;
  /** Inclusive end date for a repeating routine, or null for ongoing. Ignored when `repeats` is false. */
  endDate: string | null;
  /** For a one-time appointment: the specific date. For a routine: the anchor week is derived. */
  oneTimeDate: string | null;
  days: CommitmentDayTime[];
};

export type FixedEventPayload = {
  title: string;
  semester_id: string | null;
  category: string;
  priority: string;
  start_at: string;
  end_at: string;
  recurrence_rule: string | null;
  location: string | null;
  commute_before_minutes: number;
  commute_after_minutes: number;
  locked: boolean;
};

/**
 * Turn a fixed-commitment draft into the calendar events it should create. Days that share a start
 * time and duration collapse into one weekly series; distinct times become separate series so each
 * keeps its own hours.
 */
export function fixedEventPayloads(
  draft: FixedCommitmentDraft,
  timezone: string,
  semesterId: string | null,
  anchorDate: string,
): FixedEventPayload[] {
  const common = {
    title: draft.title.trim(),
    semester_id: semesterId,
    category: draft.category,
    priority: draft.priority,
    location: draft.location?.trim() || null,
    commute_before_minutes: draft.commuteBeforeMinutes,
    commute_after_minutes: draft.commuteAfterMinutes,
    locked: true,
  };

  if (!draft.repeats) {
    const date = draft.oneTimeDate ?? anchorDate;
    return draft.days.map((day) => {
      const start = new Date(zonedDateTimeToIso(date, `${day.startTime}:00`, timezone));
      const end = new Date(start.getTime() + day.durationMinutes * 60_000);
      return {
        ...common,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        recurrence_rule: null,
      };
    });
  }

  const groups = new Map<string, CommitmentDayTime[]>();
  for (const day of draft.days) {
    const key = `${day.startTime}|${day.durationMinutes}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(day);
    groups.set(key, bucket);
  }

  return [...groups.values()].map((group) => {
    const weekdays = group.map((day) => day.weekday).sort((left, right) => left - right);
    const firstDate = firstDateOnWeekday(anchorDate, weekdays[0]);
    const start = new Date(zonedDateTimeToIso(firstDate, `${group[0].startTime}:00`, timezone));
    const end = new Date(start.getTime() + group[0].durationMinutes * 60_000);
    return {
      ...common,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      recurrence_rule: weeklyRecurrenceRule(weekdays, draft.endDate),
    };
  });
}

/** Describe a fixed commitment event for a compact list row. */
export function describeFixedCommitment(event: FixedEvent, timezone: string): string {
  const recurrence = parseWeeklyRecurrence(event.recurrence_rule);
  const start = new Date(event.start_at);
  const timeLabel = new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(start);
  const durationMinutes = Math.round(
    (new Date(event.end_at).getTime() - start.getTime()) / 60_000,
  );
  if (!recurrence) {
    const dateLabel = new Intl.DateTimeFormat("en-CA", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: timezone,
    }).format(start);
    return `One-time · ${dateLabel} at ${timeLabel} · ${formatMinutes(durationMinutes)}`;
  }
  const cadence = recurrence.until ? "Weekly until " + recurrence.until : "Weekly";
  return `${formatWeekdayList(recurrence.weekdays)} · ${timeLabel} · ${formatMinutes(durationMinutes)} · ${cadence}`;
}

export function describeFlexibleCommitment(goal: Goal): string {
  const rule = goal.schedule_rule;
  if (!rule) return `${formatMinutes(goal.preferred_weekly_minutes)} per week`;
  if (rule.cadence === "weekly") return `${formatMinutes(rule.target_minutes)} per week`;
  const days = rule.days_of_week.map((day) => WEEKDAYS[day].slice(0, 3)).join(", ");
  return `${formatMinutes(rule.target_minutes)} on ${days}`;
}

export function describePersonalGoal(goal: Goal): string {
  const target = goal.target_description
    ? goal.target_description
    : `${formatMinutes(goal.preferred_weekly_minutes)} preferred each week`;
  if (goal.target_date) return `${target} · by ${goal.target_date}`;
  return target;
}

// ---------------------------------------------------------------------------
// Focus hours (availability) helpers
// ---------------------------------------------------------------------------

export type FocusWindowDraft = {
  start: string;
  end: string;
  type: AvailabilityWindow["type"];
  energy: AvailabilityWindow["energy_level"];
};

export type FocusHoursDraft = Record<number, FocusWindowDraft[]>;

export function focusHoursFromWindows(windows: AvailabilityWindow[]): FocusHoursDraft {
  const draft: FocusHoursDraft = {};
  for (let day = 0; day < 7; day += 1) draft[day] = [];
  for (const window of windows) {
    if (draft[window.day_of_week] === undefined) continue;
    draft[window.day_of_week].push({
      start: window.start_time.slice(0, 5),
      end: window.end_time.slice(0, 5),
      type: window.type,
      energy: window.energy_level,
    });
  }
  for (let day = 0; day < 7; day += 1) {
    draft[day].sort((left, right) => left.start.localeCompare(right.start));
  }
  return draft;
}

export type FocusHoursValidation =
  | { ok: true; windows: Omit<AvailabilityWindow, "id" | "created_at" | "updated_at">[] }
  | { ok: false; message: string };

export function validateFocusHours(draft: FocusHoursDraft): FocusHoursValidation {
  const windows: Omit<AvailabilityWindow, "id" | "created_at" | "updated_at">[] = [];
  let anyDay = false;
  for (let day = 0; day < 7; day += 1) {
    const dayWindows = [...(draft[day] ?? [])].sort((left, right) => left.start.localeCompare(right.start));
    if (dayWindows.length) anyDay = true;
    let previousEnd = "";
    for (const window of dayWindows) {
      const endsAtMidnight = window.end === "00:00";
      if (!endsAtMidnight && window.end <= window.start) {
        return { ok: false, message: `${WEEKDAYS[day]}: each window must end after it starts.` };
      }
      if (previousEnd && window.start < previousEnd) {
        return { ok: false, message: `${WEEKDAYS[day]}: focus windows must not overlap.` };
      }
      previousEnd = endsAtMidnight ? "24:00" : window.end;
      windows.push({
        day_of_week: day,
        start_time: `${window.start}:00`,
        end_time: `${window.end}:00`,
        type: window.type,
        energy_level: window.energy,
      });
    }
  }
  if (!anyDay) {
    return { ok: false, message: "Add at least one focus window, or you will have no schedulable time." };
  }
  return { ok: true, windows };
}
