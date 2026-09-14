import type { PlannerTask, PlanningEntry, PlanningView, WorkTimer } from "@/lib/types";

export function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

export function formatFullDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  })
    .format(new Date(value))
    .replace(/\s*a\.?m\.?/i, " AM")
    .replace(/\s*p\.?m\.?/i, " PM")
    .replace(":00", "");
}

export function formatShortDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: timezone,
  }).format(new Date(value));
}

export function dayPart(timezone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-CA", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(new Date()),
  );
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

export function isTickable(entry: PlanningEntry) {
  return entry.kind === "scheduled_block" && Boolean(entry.task_id || entry.goal_id);
}

export function isPast(entry: PlanningEntry, now = Date.now()) {
  return new Date(entry.end_at).getTime() <= now;
}

export function agendaSummary(entries: PlanningEntry[]) {
  const commitments = entries.filter(
    (entry) => entry.kind === "fixed_event" || entry.block_type === "commitment",
  ).length;
  const focus = entries.filter(
    (entry) => entry.block_type === "focus" || entry.block_type === "goal",
  ).length;
  return `${commitments} ${commitments === 1 ? "commitment" : "commitments"} · ${focus} ${focus === 1 ? "focus block" : "focus blocks"}`;
}

export function taskDetail(task: PlannerTask, timezone: string) {
  const context = task.course_code || task.goal_name || capitalize(task.intensity);
  if (!task.deadline_at) return `${context} · ${formatMinutes(task.remaining_minutes)} remaining`;
  return `${context} · ${formatMinutes(task.remaining_minutes)} left · Due ${formatShortDate(task.deadline_at, timezone)}`;
}

export function highestPriorityTask(tasks: PlannerTask[]) {
  const priority = { critical: 0, high: 1, medium: 2, low: 3, optional: 4 };
  return [...tasks].sort((left, right) =>
    priority[left.priority] - priority[right.priority] ||
    (left.deadline_at ?? "9999").localeCompare(right.deadline_at ?? "9999") ||
    left.name.localeCompare(right.name),
  )[0] ?? null;
}

export function timerCheckEntry(timer: WorkTimer, entries: PlanningEntry[], tasks: PlannerTask[]): PlanningEntry {
  const linked = entries.find((entry) =>
    (timer.block_fingerprint !== null && entry.block_fingerprint === timer.block_fingerprint) ||
    entry.task_id === timer.task_id,
  );
  if (linked) return linked;
  const task = tasks.find((item) => item.id === timer.task_id);
  return {
    id: `timer:${timer.id}`, kind: "scheduled_block", source_id: timer.scheduled_block_id ?? timer.id,
    title: task?.name ?? "Current work", start_at: timer.started_at, end_at: new Date().toISOString(),
    block_type: "focus", category: "focus", location: null, task_id: timer.task_id,
    task_status: task?.status ?? null, goal_id: null, course_code: task?.course_code ?? null,
    locked: false, recurring: false, editable: false, block_fingerprint: timer.block_fingerprint,
    planned_minutes: 0, logged_minutes: 0, check_in_outcome: null, work_session_id: null, timer_running: true,
  };
}

export function headerSummary(data: PlanningView, unbookedDeadlines: number) {
  const tickable = data.entries.filter(isTickable);
  const done = tickable.filter((entry) => entry.check_in_outcome === "finished").length;
  const progress = `${done} of ${tickable.length} done · ${formatMinutes(data.logged_minutes)} logged`;
  if (unbookedDeadlines) {
    return `${progress} · ${unbookedDeadlines} ${unbookedDeadlines === 1 ? "deadline" : "deadlines"} with no time booked`;
  }
  return `${progress} · every known deadline has an answer`;
}

export function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}
