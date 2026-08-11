"use client";

import {
  ArrowRight,
  BatteryMedium,
  Check,
  ChevronRight,
  Clock3,
  Coffee,
  LoaderCircle,
  Pencil,
  Plus,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ScheduleBlockEditor } from "@/components/schedule-block-editor";
import { useApiResource } from "@/hooks/use-api-resource";
import { apiRequest, ApiRequestError } from "@/lib/api";
import type { PlannerTask, PlanningEntry, PlanningView, Semester, User } from "@/lib/types";

export function TodayPlanner() {
  const user = useApiResource<User>("/auth/me");
  const semesters = useApiResource<Semester[]>("/semesters");
  const plan = useApiResource<PlanningView>("/planning/day");
  const currentSemester = useMemo(
    () => semesters.data?.find((semester) => semester.status === "active") ?? semesters.data?.[0] ?? null,
    [semesters.data],
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<PlanningEntry | null>(null);
  const [suggestedTask, setSuggestedTask] = useState<PlannerTask | null>(null);
  const [completingTask, setCompletingTask] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loading = user.loading || semesters.loading || plan.loading;
  if (loading && !plan.data) return <PlannerLoading label="Building today from your real plan" />;
  if (plan.error || user.error || semesters.error) {
    return <PlannerError message={plan.error || user.error || semesters.error || "DoNext could not load today."} onRetry={plan.reload} />;
  }
  if (!plan.data) return <PlannerLoading label="Loading today" />;

  const data = plan.data;
  const capacity = data.days[0]?.capacity;
  const nextEntry = data.entries.find((entry) => entry.id === data.next_entry_id) ?? null;
  const allocatedPercent = capacity?.usable_focus_minutes
    ? Math.round(capacity.planned_focus_minutes / capacity.usable_focus_minutes * 100)
    : 0;
  const firstName = user.data?.name.split(" ")[0] || "there";

  function openNew(task: PlannerTask | null = null) {
    setSelectedEntry(null);
    setSuggestedTask(task);
    setEditorOpen(true);
  }

  function openEntry(entry: PlanningEntry) {
    if (!entry.editable) return;
    setSelectedEntry(entry);
    setSuggestedTask(null);
    setEditorOpen(true);
  }

  async function completeTask(taskId: string) {
    setCompletingTask(taskId);
    setActionError(null);
    try {
      await apiRequest(`/tasks/${taskId}/complete`, { method: "POST" });
      window.dispatchEvent(new Event("donext:planning-updated"));
      await plan.reload();
    } catch (error) {
      setActionError(error instanceof ApiRequestError ? error.message : "DoNext could not complete that task.");
    } finally {
      setCompletingTask(null);
    }
  }

  return (
    <main className="page-shell today-page">
      <header className="page-heading today-heading">
        <div>
          <p className="eyebrow">{formatFullDate(data.start_date)}</p>
          <h1>Good {dayPart(data.timezone)}, {firstName}.</h1>
          <p>{todaySummary(data.entries.length, capacity?.remaining_focus_minutes ?? 0)}</p>
        </div>
        <div className="heading-actions">
          <Link className="secondary-button" href="/week"><Clock3 size={18} /> View week</Link>
          <button className="primary-button" disabled={!currentSemester} type="button" onClick={() => openNew()}>
            <Plus size={17} /> Add time block
          </button>
        </div>
      </header>

      <section className="day-overview" aria-label="Day overview">
        <div className="capacity-card">
          <div className="capacity-topline">
            <span className={`status-pill ${allocatedPercent <= 100 ? "calm" : "strained"}`}>
              <span /> {capacityStatus(capacity?.remaining_focus_minutes ?? 0, allocatedPercent)}
            </span>
            <span className="muted-label">{allocatedPercent}% of usable focus time planned</span>
          </div>
          <div className="capacity-copy">
            <div><strong>{formatMinutes(capacity?.planned_focus_minutes ?? 0)}</strong><span>planned focus</span></div>
            <div><strong>{formatMinutes(capacity?.remaining_focus_minutes ?? 0)}</strong><span>open focus capacity</span></div>
            <div><strong>{formatMinutes(capacity?.preferred_sleep_minutes ?? 0)}</strong><span>preferred sleep</span></div>
          </div>
          <CapacityTrack capacity={capacity} />
          <div className="capacity-legend">
            <span><i className="focus-dot" /> Focus</span>
            <span><i className="life-dot" /> Commitments</span>
            <span><i className="buffer-dot" /> Protected free time</span>
          </div>
        </div>

        {nextEntry ? (
          <div className="next-card">
            <div className="next-card-icon"><Sparkles size={21} /></div>
            <div>
              <p>Do next</p>
              <h2>{nextEntry.title}</h2>
              <span>{formatEntryWindow(nextEntry, data.timezone)}{nextEntry.location ? ` · ${nextEntry.location}` : ""}</span>
            </div>
            {nextEntry.editable ? (
              <button aria-label={`Edit ${nextEntry.title}`} type="button" onClick={() => openEntry(nextEntry)}><Pencil size={18} /></button>
            ) : (
              <Link aria-label="View this week" href="/week"><ArrowRight size={20} /></Link>
            )}
          </div>
        ) : (
          <div className="next-card next-card-empty">
            <div className="next-card-icon"><Sparkles size={21} /></div>
            <div><p>Open next</p><h2>No upcoming block</h2><span>Choose what deserves a place in your day.</span></div>
            <button aria-label="Add a time block" disabled={!currentSemester} type="button" onClick={() => openNew()}><Plus size={20} /></button>
          </div>
        )}
      </section>

      {actionError && <p className="planner-alert error" role="alert">{actionError}</p>}

      <div className="today-grid">
        <section className="agenda-panel">
          <div className="section-heading">
            <div><h2>Today’s plan</h2><p>{agendaSummary(data.entries)}</p></div>
            <button className="text-button" disabled={!currentSemester} type="button" onClick={() => openNew()}>Add block</button>
          </div>
          {data.entries.length ? (
            <div className="agenda-list">
              {data.entries.map((entry, index) => (
                <article className="agenda-row" key={entry.id}>
                  <div className="agenda-time"><strong>{formatTime(entry.start_at, data.timezone)}</strong><span>{formatMeridiem(entry.start_at, data.timezone)}</span></div>
                  <div className="agenda-line" aria-hidden="true"><span className={entryDot(entry)} />{index < data.entries.length - 1 && <i />}</div>
                  <div className="agenda-content">
                    <div>
                      {entry.id === data.next_entry_id && <span className="up-next-label">Up next</span>}
                      <h3>{entry.title}</h3>
                      <p>{entryDetail(entry)}</p>
                    </div>
                    <span className="duration"><Clock3 size={14} /> {entryDuration(entry)}</span>
                    {entry.editable ? (
                      <button aria-label={`Edit ${entry.title}`} type="button" onClick={() => openEntry(entry)}><Pencil size={18} /></button>
                    ) : <span />}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="planner-empty"><Clock3 size={24} /><h3>Your day is open.</h3><p>Add a block or schedule one of your unfinished tasks.</p><button className="secondary-button" disabled={!currentSemester} type="button" onClick={() => openNew()}><Plus size={16} /> Plan time</button></div>
          )}
        </section>

        <aside className="today-aside">
          <section className="focus-card">
            <div className="section-heading compact"><div><p className="eyebrow">Unscheduled work</p><h2>Give these a place</h2></div><BatteryMedium size={22} /></div>
            {data.unscheduled_tasks.length ? (
              <ul className="priority-list">
                {data.unscheduled_tasks.slice(0, 4).map((task) => (
                  <li key={task.id}>
                    <button className="check-ring task-complete-button" disabled={completingTask === task.id} aria-label={`Complete ${task.name}`} type="button" onClick={() => completeTask(task.id)}>
                      {completingTask === task.id ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />}
                    </button>
                    <button className="priority-task-copy" type="button" onClick={() => openNew(task)}>
                      <strong>{task.name}</strong><small>{taskDetail(task, data.timezone)}</small>
                    </button>
                    <button className="priority-task-open" aria-label={`Schedule ${task.name}`} type="button" onClick={() => openNew(task)}><ChevronRight size={17} /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="planner-quiet">Every unfinished task already has time in the accepted plan.</p>}
          </section>

          <section className="insight-card">
            <div className="insight-icon"><Coffee size={20} /></div>
            <div>
              <p className="eyebrow">{data.warnings.length ? "Needs input" : "Protected on purpose"}</p>
              <h3>{data.warnings.length ? "Capacity is not complete yet" : `${formatMinutes(capacity?.protected_free_minutes ?? 0)} stays unallocated`}</h3>
              <p>{data.warnings[0] ?? "Your configured buffer remains outside planned focus time."}</p>
            </div>
          </section>
        </aside>
      </div>

      {currentSemester && (
        <ScheduleBlockEditor
          open={editorOpen}
          semesterId={currentSemester.id}
          date={data.start_date}
          tasks={data.unscheduled_tasks}
          entry={selectedEntry}
          suggestedTask={suggestedTask}
          onClose={() => setEditorOpen(false)}
          onSaved={plan.reload}
        />
      )}
    </main>
  );
}

function CapacityTrack({ capacity }: { capacity: PlanningView["days"][number]["capacity"] | undefined }) {
  const total = Math.max(capacity?.available_minutes ?? 0, 1);
  const focus = Math.min((capacity?.planned_focus_minutes ?? 0) / total * 100, 100);
  const commitments = Math.min((capacity?.commitment_minutes ?? 0) / total * 100, 100 - focus);
  const protectedTime = Math.min((capacity?.protected_free_minutes ?? 0) / total * 100, 100 - focus - commitments);
  return <div className="capacity-track" aria-label={`${Math.round(focus)} percent of available time planned for focus`}><span className="capacity-focus" style={{ width: `${focus}%` }} /><span className="capacity-life" style={{ width: `${commitments}%` }} /><span className="capacity-buffer" style={{ width: `${protectedTime}%` }} /></div>;
}

function PlannerLoading({ label }: { label: string }) {
  return <main className="page-shell planner-state"><LoaderCircle className="spin" size={26} /><h1>{label}</h1><p>DoNext is reading your saved commitments and work.</p></main>;
}

function PlannerError({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  return <main className="page-shell planner-state error"><h1>Today could not load.</h1><p>{message}</p><button className="primary-button" type="button" onClick={onRetry}>Try again</button></main>;
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatFullDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { hour: "numeric", hour12: true, timeZone: timezone }).format(new Date(value)).replace(/\s?[ap]\.m\./i, "");
}

function formatMeridiem(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { hour: "numeric", hour12: true, timeZone: timezone }).formatToParts(new Date(value)).find((part) => part.type === "dayPeriod")?.value.toUpperCase().replaceAll(".", "") ?? "";
}

function formatEntryWindow(entry: PlanningEntry, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", timeZone: timezone });
  return `${formatter.format(new Date(entry.start_at))}–${formatter.format(new Date(entry.end_at))}`;
}

function dayPart(timezone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-CA", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(new Date()));
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

function capacityStatus(remaining: number, allocated: number) {
  if (allocated > 100) return "Over capacity";
  if (remaining >= 120) return "Room to breathe";
  if (remaining > 0) return "Focused day";
  return "Fully allocated";
}

function todaySummary(entries: number, remaining: number) {
  if (!entries) return "Nothing is assumed—your day is ready for you to shape.";
  return `${entries} ${entries === 1 ? "item" : "items"} planned with ${formatMinutes(remaining)} of usable focus capacity still open.`;
}

function agendaSummary(entries: PlanningEntry[]) {
  const commitments = entries.filter((entry) => entry.kind === "fixed_event" || entry.block_type === "commitment").length;
  const focus = entries.filter((entry) => entry.block_type === "focus" || entry.block_type === "goal").length;
  return `${commitments} ${commitments === 1 ? "commitment" : "commitments"} · ${focus} ${focus === 1 ? "focus block" : "focus blocks"}`;
}

function entryDot(entry: PlanningEntry) {
  if (entry.kind === "fixed_event") return "course";
  if (entry.block_type === "goal" || entry.block_type === "personal") return "goal";
  return "focus";
}

function entryDetail(entry: PlanningEntry) {
  const context = entry.course_code || entry.location || capitalize(entry.category);
  return `${context}${entry.recurring ? " · Weekly" : entry.locked ? " · Fixed" : " · Manual"}`;
}

function entryDuration(entry: PlanningEntry) {
  return formatMinutes(Math.round((new Date(entry.end_at).getTime() - new Date(entry.start_at).getTime()) / 60_000));
}

function taskDetail(task: PlannerTask, timezone: string) {
  const context = task.course_code || task.goal_name || capitalize(task.intensity);
  if (!task.deadline_at) return `${context} · ${formatMinutes(task.remaining_minutes)} remaining`;
  const due = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: timezone }).format(new Date(task.deadline_at));
  return `${context} · ${formatMinutes(task.remaining_minutes)} · Due ${due}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}
