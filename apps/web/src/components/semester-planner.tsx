"use client";

import { AlertTriangle, CalendarRange, CheckCircle2, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { DeadlineEditor } from "@/components/deadline-editor";
import { useApiResource } from "@/hooks/use-api-resource";
import type {
  Course,
  ScheduleProposal,
  Semester,
  SemesterDeadline,
  SemesterPlanning,
} from "@/lib/types";

export function SemesterPlanner() {
  const semesters = useApiResource<Semester[]>("/semesters");
  const currentSemester = useMemo(
    () => semesters.data?.find((semester) => semester.status === "active") ?? semesters.data?.[0] ?? null,
    [semesters.data],
  );
  const planning = useApiResource<SemesterPlanning>(
    currentSemester ? `/planning/semesters/${currentSemester.id}` : null,
  );
  const proposal = useApiResource<ScheduleProposal>(
    currentSemester ? `/semesters/${currentSemester.id}/schedule/proposal` : null,
  );
  const courses = useApiResource<Course[]>(
    currentSemester ? `/semesters/${currentSemester.id}/courses` : null,
  );
  const deadlineScroll = useRef<HTMLDivElement | null>(null);
  // Null while the editor is closed; a wrapped deadline (or a null one, to add) while it is open.
  const [editing, setEditing] = useState<{ deadline: SemesterDeadline | null } | null>(null);

  // Mid-semester the list opens on dates that have already passed, so start it at the next one.
  useEffect(() => {
    const container = deadlineScroll.current;
    const next = container?.querySelector(".deadline-row:not(.past)");
    if (!container || !next) return;
    const offset = next.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop = Math.max(container.scrollTop + offset - 42, 0);
  }, [planning.data]);

  if ((semesters.loading || planning.loading) && !planning.data) {
    return <SemesterState loading message="Calculating your semester from saved work" />;
  }
  if (semesters.error || planning.error) {
    return <SemesterState message={semesters.error || planning.error || "The semester could not load."} onRetry={async () => { await semesters.reload(); await planning.reload(); }} />;
  }
  if (!currentSemester) {
    return <main className="page-shell planner-state"><CalendarRange size={28} /><h1>Start with a semester.</h1><p>Add semester dates in onboarding before reviewing long-range capacity.</p><Link className="primary-button" href="/onboarding">Set up semester</Link></main>;
  }
  if (!planning.data) return <SemesterState loading message="Loading your semester" />;

  const data = planning.data;
  const health = semesterHealth(data);
  const attentionWeek = data.weeks.find((week) => week.risk === "high")
    ?? data.weeks.find((week) => week.risk === "medium")
    ?? null;

  return (
    <main className="page-shell semester-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{data.semester.name} · {data.weeks.length} weeks</p>
          <h1>See the semester before it gets busy.</h1>
          <p>{semesterSummary(data, health.label)}</p>
        </div>
        <Link className="secondary-button" href="/courses"><CalendarRange size={18} /> Review courses</Link>
      </header>

      {proposal.data ? (
        <Link className="proposal-pending-banner" href="/week"><CalendarRange size={17} /><span><strong>Draft projection available</strong><small>{formatMinutes(proposal.data.generation_summary.scheduled_minutes)} is proposed, not yet accepted.</small></span></Link>
      ) : null}

      <section className="semester-metrics">
        <article><span>Remaining work</span><strong>{formatMinutes(data.total_demand_minutes)}</strong><small>From unfinished task estimates</small></article>
        <article><span>Open capacity</span><strong>{formatMinutes(data.open_capacity_minutes)}</strong><small>After commitments and protected buffer</small></article>
        <article><span>Upcoming deadlines</span><strong>{data.upcoming_deadlines}</strong><small>Across confirmed course dates</small></article>
        <article className={health.className}><span>Plan health</span><strong>{health.label}</strong><small>{health.icon}{health.detail}</small></article>
      </section>

      {data.incomplete_data && <p className="planner-alert warning">This forecast is intentionally incomplete: add weekly availability and deadlines for every unfinished task to improve it.</p>}

      <section className="load-card">
        <div className="section-heading">
          <div><h2>Weekly workload</h2><p>Remaining task demand as a share of usable focus capacity</p></div>
          <div className="load-legend"><span><i /> Demand</span><span><i /> Capacity limit</span></div>
        </div>
        <div className="load-chart live-load-chart" style={{ gridTemplateColumns: `repeat(${data.weeks.length}, minmax(28px, 1fr))`, minWidth: `${Math.max(data.weeks.length * 44, 620)}px` }} aria-label="Semester weekly workload chart">
          <div className="risk-line"><span>100% capacity</span></div>
          {data.weeks.map((week) => (
            <div className="load-week" key={week.week_number} title={weekTooltip(week)}>
              <span className={week.risk === "high" ? "risk" : week.risk === "unknown" ? "unknown" : undefined} style={{ height: `${barHeight(week.load_percent)}%` }} />
              <small>W{week.week_number}</small>
            </div>
          ))}
        </div>
      </section>

      <div className="semester-grid">
        <section className="deadline-panel">
          <div className="section-heading">
            <div><h2>Important dates</h2><p>Confirmed milestones shaping remaining demand</p></div>
            <div className="deadline-panel-actions">
              <span className="muted-label">{data.deadlines.length} total</span>
              <button
                className="text-button"
                disabled={!courses.data?.length}
                title={courses.data?.length ? undefined : "Add a course before adding dates."}
                type="button"
                onClick={() => setEditing({ deadline: null })}
              >
                Add date
              </button>
            </div>
          </div>
          {data.deadlines.length ? (
            <div className="deadline-scroll" ref={deadlineScroll}>
              {groupDeadlines(data.deadlines).map((group) => (
                <section className="deadline-group" key={group.key}>
                  <h3 className="deadline-month">{group.month}{group.year && <em>{group.year}</em>}</h3>
                  <ul>
                    {group.items.map((deadline) => {
                      const urgency = deadlineUrgency(deadline.due_at);
                      const heavy = (deadline.weight_percent ?? 0) >= 15;
                      return (
                        <li className={`deadline-row ${urgency.tone}`} key={deadline.id}>
                          <button
                            aria-label={`Edit ${deadline.name}`}
                            type="button"
                            onClick={() => setEditing({ deadline })}
                          >
                            <time dateTime={deadline.due_at}>
                              <span>{datePart(deadline.due_at, "weekday")}</span>
                              <strong>{datePart(deadline.due_at, "day")}</strong>
                            </time>
                            <div className="deadline-copy">
                              <h4>{deadline.name}</h4>
                              <p>
                                <span className="deadline-course">{deadline.course_code || "Course work"}</span>
                                {deadline.weight_percent != null && (
                                  <span className={`deadline-weight${heavy ? " heavy" : ""}`}>{deadline.weight_percent}% of grade</span>
                                )}
                              </p>
                            </div>
                            <div className="deadline-meta">
                              <span className={`deadline-effort${deadline.remaining_minutes == null ? " missing" : ""}`}>
                                {deadline.remaining_minutes == null ? "Estimate missing" : `${formatMinutes(deadline.remaining_minutes)} left`}
                              </span>
                              <small>{urgency.label}</small>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="planner-empty compact">
              <CalendarRange size={23} />
              <h3>No confirmed deadlines yet.</h3>
              <p>Import an outline, or add a dated milestone to build this view.</p>
              {courses.data?.length ? (
                <button className="secondary-button" type="button" onClick={() => setEditing({ deadline: null })}>
                  Add a date
                </button>
              ) : null}
            </div>
          )}
        </section>
        <aside className={`risk-card ${health.className}`}>
          <div className="risk-card-icon">{attentionWeek ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}</div>
          <p className="eyebrow">{data.incomplete_data ? "Needs input" : attentionWeek ? "Look ahead" : "Capacity check"}</p>
          <h2>{riskTitle(data, attentionWeek)}</h2>
          <p>{riskExplanation(data, attentionWeek)}</p>
          {attentionWeek && <small className="risk-calculation">{formatMinutes(attentionWeek.demand_minutes)} demand · {formatMinutes(attentionWeek.capacity_minutes)} capacity</small>}
        </aside>
      </div>

      <DeadlineEditor
        courses={courses.data ?? []}
        deadline={editing?.deadline ?? null}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          await planning.reload();
        }}
      />
    </main>
  );
}

function SemesterState({ loading = false, message, onRetry }: { loading?: boolean; message: string; onRetry?: () => Promise<void> }) {
  return <main className="page-shell planner-state">{loading && <LoaderCircle className="spin" size={26} />}<h1>{message}</h1><p>{loading ? "DoNext is comparing task estimates with real availability." : "Your saved data is unchanged."}</p>{onRetry && <button className="primary-button" type="button" onClick={onRetry}>Try again</button>}</main>;
}

function semesterHealth(data: SemesterPlanning) {
  if (data.incomplete_data) return { label: "Needs input", detail: "Some capacity or dates are unknown", className: "unknown", icon: <AlertTriangle size={14} /> };
  if (data.weeks.some((week) => week.risk === "high")) return { label: "At risk", detail: "At least one week exceeds capacity", className: "risk", icon: <AlertTriangle size={14} /> };
  if (data.weeks.some((week) => week.risk === "medium")) return { label: "Watch", detail: "At least one week is above 75%", className: "watch", icon: <AlertTriangle size={14} /> };
  return { label: "Good", detail: "No calculated weekly overload", className: "good", icon: <CheckCircle2 size={14} /> };
}

function semesterSummary(data: SemesterPlanning, health: string) {
  if (data.incomplete_data) return "The current forecast uses only confirmed availability, estimates, and deadlines.";
  if (health === "At risk") return "At least one week has more estimated work than usable focus capacity.";
  if (health === "Watch") return "The semester is feasible from current inputs, with a week approaching capacity.";
  return "Current task estimates fit within the usable capacity you configured.";
}

function riskTitle(data: SemesterPlanning, week: SemesterPlanning["weeks"][number] | null) {
  if (data.incomplete_data) return "Complete the capacity picture";
  if (!week) return "No weekly overload detected";
  return `Week ${week.week_number} ${week.risk === "high" ? "exceeds" : "approaches"} capacity`;
}

function riskExplanation(data: SemesterPlanning, week: SemesterPlanning["weeks"][number] | null) {
  if (data.incomplete_data) return "Undated work or missing availability prevents DoNext from making a complete semester claim.";
  if (!week) return "Every dated task currently fits within that week’s calculated usable focus time.";
  return week.risk === "high"
    ? "Remaining task estimates due that week are greater than the focus time available after commitments and buffer."
    : "Remaining task estimates use more than three quarters of that week’s focus capacity.";
}

function barHeight(load: number | null) {
  if (load == null) return 4;
  return Math.max(Math.min(load / 1.2, 100), 4);
}

function weekTooltip(week: SemesterPlanning["weeks"][number]) {
  if (week.load_percent == null) return `Week ${week.week_number}: capacity unavailable`;
  return `Week ${week.week_number}: ${week.load_percent}% load, ${formatMinutes(week.demand_minutes)} remaining work`;
}

function groupDeadlines(deadlines: SemesterDeadline[]) {
  const groups: { key: string; month: string; year: string | null; items: SemesterDeadline[] }[] = [];
  let previousYear: string | null = null;
  for (const deadline of deadlines) {
    const key = deadline.due_at.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.items.push(deadline);
      continue;
    }
    const year = deadline.due_at.slice(0, 4);
    groups.push({ key, month: datePart(deadline.due_at, "month"), year: year === previousYear ? null : year, items: [deadline] });
    previousYear = year;
  }
  return groups;
}

function deadlineUrgency(dueAt: string) {
  const days = daysUntil(dueAt);
  if (days < 0) return { tone: "past", label: days === -1 ? "Yesterday" : `${Math.abs(days)} days ago` };
  if (days === 0) return { tone: "now", label: "Today" };
  if (days === 1) return { tone: "now", label: "Tomorrow" };
  if (days <= 7) return { tone: "soon", label: `In ${days} days` };
  if (days <= 13) return { tone: "near", label: `In ${days} days` };
  return { tone: days <= 28 ? "near" : "later", label: `In ${Math.round(days / 7)} weeks` };
}

function daysUntil(dueAt: string) {
  const now = new Date();
  const due = Date.parse(`${dueAt.slice(0, 10)}T00:00:00Z`);
  return Math.round((due - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
}

const dateParts: Record<"day" | "month" | "weekday", Intl.DateTimeFormatOptions> = {
  day: { day: "numeric", timeZone: "UTC" },
  month: { month: "long", timeZone: "UTC" },
  weekday: { weekday: "short", timeZone: "UTC" },
};

function datePart(value: string, part: "day" | "month" | "weekday") {
  return new Intl.DateTimeFormat("en-CA", dateParts[part]).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
