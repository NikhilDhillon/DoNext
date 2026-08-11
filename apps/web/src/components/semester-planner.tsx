"use client";

import { AlertTriangle, CalendarRange, CheckCircle2, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { useApiResource } from "@/hooks/use-api-resource";
import type { Semester, SemesterPlanning } from "@/lib/types";

export function SemesterPlanner() {
  const semesters = useApiResource<Semester[]>("/semesters");
  const currentSemester = useMemo(
    () => semesters.data?.find((semester) => semester.status === "active") ?? semesters.data?.[0] ?? null,
    [semesters.data],
  );
  const planning = useApiResource<SemesterPlanning>(
    currentSemester ? `/planning/semesters/${currentSemester.id}` : null,
  );

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
        <section className="deadline-card">
          <div className="section-heading"><div><h2>Important dates</h2><p>Confirmed milestones shaping remaining demand</p></div><span className="muted-label">{data.deadlines.length} total</span></div>
          {data.deadlines.length ? (
            <div className="deadline-list">
              {data.deadlines.slice(0, 8).map((deadline) => {
                return (
                  <article key={deadline.id}>
                    <time dateTime={deadline.due_at}><strong>{datePart(deadline.due_at, "day")}</strong><span>{datePart(deadline.due_at, "month")}</span></time>
                    <div><h3>{deadline.name}</h3><p>{deadlineContext(deadline)}</p></div>
                    <span className={`risk-badge ${deadline.remaining_minutes == null ? "medium" : "low"}`}>{deadline.remaining_minutes == null ? "Estimate missing" : `${formatMinutes(deadline.remaining_minutes)} left`}</span>
                  </article>
                );
              })}
            </div>
          ) : <div className="planner-empty compact"><CalendarRange size={23} /><h3>No confirmed deadlines yet.</h3><p>Import an outline or add dated course work to build this view.</p></div>}
        </section>
        <aside className={`risk-card ${health.className}`}>
          <div className="risk-card-icon">{attentionWeek ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}</div>
          <p className="eyebrow">{data.incomplete_data ? "Needs input" : attentionWeek ? "Look ahead" : "Capacity check"}</p>
          <h2>{riskTitle(data, attentionWeek)}</h2>
          <p>{riskExplanation(data, attentionWeek)}</p>
          {attentionWeek && <small className="risk-calculation">{formatMinutes(attentionWeek.demand_minutes)} demand · {formatMinutes(attentionWeek.capacity_minutes)} capacity</small>}
        </aside>
      </div>
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

function deadlineContext(deadline: SemesterPlanning["deadlines"][number]) {
  const pieces = [deadline.course_code || "Course work"];
  if (deadline.weight_percent != null) pieces.push(`${deadline.weight_percent}% of course grade`);
  return pieces.join(" · ");
}

function datePart(value: string, part: "day" | "month") {
  const calendarDate = value.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", part === "day" ? { day: "2-digit", timeZone: "UTC" } : { month: "short", timeZone: "UTC" }).format(new Date(`${calendarDate}T12:00:00Z`)).toUpperCase();
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
