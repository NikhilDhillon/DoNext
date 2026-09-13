"use client";

import { ArrowRight, CalendarRange, ChevronDown, LoaderCircle, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DeadlineEditor } from "@/components/deadline-editor";
import { useApiResource } from "@/hooks/use-api-resource";
import type { Course, Semester, SemesterDeadline, SemesterPlanning } from "@/lib/types";

type DateScope = "upcoming" | "all";

export function SemesterPlanner() {
  const semesters = useApiResource<Semester[]>("/semesters");
  const currentSemester = useMemo(
    () => semesters.data?.find((semester) => semester.status === "active") ?? semesters.data?.[0] ?? null,
    [semesters.data],
  );
  const planning = useApiResource<SemesterPlanning>(
    currentSemester ? `/planning/semesters/${currentSemester.id}` : null,
  );
  const courses = useApiResource<Course[]>(
    currentSemester ? `/semesters/${currentSemester.id}/courses` : null,
  );
  const [editing, setEditing] = useState<{ deadline: SemesterDeadline | null } | null>(null);
  const [scope, setScope] = useState<DateScope>("upcoming");
  const [courseId, setCourseId] = useState("all");
  const [month, setMonth] = useState("all");
  const [now, setNow] = useState(() => Date.now());

  // Keep the upcoming view accurate when the page stays open across a deadline.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if ((semesters.loading || planning.loading) && !planning.data) {
    return <SemesterState loading message="Loading your semester dates" />;
  }
  if (semesters.error || planning.error) {
    return <SemesterState message={semesters.error || planning.error || "The semester could not load."} onRetry={async () => { await semesters.reload(); await planning.reload(); }} />;
  }
  if (!currentSemester) {
    return <main className="page-shell planner-state"><CalendarRange size={28} /><h1>Start with a semester.</h1><p>Add semester dates to keep your deadlines and milestones together.</p><Link className="primary-button" href="/onboarding">Set up semester</Link></main>;
  }
  if (!planning.data) return <SemesterState loading message="Loading your semester dates" />;

  const data = planning.data;
  const deadlines = [...data.deadlines].sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  const courseDates = deadlines.filter((deadline) => courseId === "all" || deadline.course_id === courseId);
  const upcoming = courseDates.filter((deadline) => Date.parse(deadline.due_at) >= now);
  const scopedDates = scope === "upcoming" ? upcoming : courseDates;
  const groups = groupDeadlines(scopedDates);
  // An edited date can move out of the selected month; keep the result reachable.
  const activeMonth = groups.some((group) => group.key === month) ? month : "all";
  const visibleGroups = groups.filter((group) => activeMonth === "all" || group.key === activeMonth);
  const visibleCount = visibleGroups.reduce((count, group) => count + group.items.length, 0);
  const nextId = upcoming[0]?.id;
  const canAdd = Boolean(courses.data?.length);

  function resetFilters() {
    setScope("all");
    setCourseId("all");
    setMonth("all");
  }

  return (
    <main className="page-shell semester-page">
      <header className="page-heading semester-heading">
        <div>
          <p className="eyebrow">{data.semester.name}</p>
          <h1>Important dates.</h1>
          <p>Your deadlines, exams, and milestones. All in one place.</p>
        </div>
        <div className="semester-heading-actions">
          <Link className="secondary-button" href="/courses">Review courses</Link>
          <button className="primary-button" disabled={!canAdd} title={canAdd ? undefined : "Add a course before adding dates."} type="button" onClick={() => setEditing({ deadline: null })}>
            <Plus size={17} aria-hidden="true" /> Add date
          </button>
        </div>
      </header>

      {courses.error && (
        <p className="planner-alert warning">Courses could not load. <button className="text-button" type="button" onClick={() => void courses.reload()}>Try again</button></p>
      )}

      <div className="semester-toolbar">
        <div className="semester-scope" role="group" aria-label="Dates to show">
          <button type="button" aria-pressed={scope === "upcoming"} onClick={() => { setScope("upcoming"); setMonth("all"); }}>
            Upcoming <span>{upcoming.length}</span>
          </button>
          <button type="button" aria-pressed={scope === "all"} onClick={() => { setScope("all"); setMonth("all"); }}>
            All dates <span>{courseDates.length}</span>
          </button>
        </div>
        <label className={`semester-course-filter${courseId === "all" ? "" : " filtered"}`}>
          <span>Course</span>
          <select value={courseId} onChange={(event) => { setCourseId(event.target.value); setMonth("all"); }}>
            <option value="all">All courses</option>
            {(courses.data ?? []).map((course) => <option key={course.id} value={course.id}>{course.code}</option>)}
          </select>
          <ChevronDown size={18} aria-hidden="true" />
        </label>
      </div>

      <div className="semester-timeline-layout">
        <aside className="semester-months">
          <p className="eyebrow">Browse semester</p>
          <nav aria-label="Filter dates by month">
            <button type="button" aria-pressed={activeMonth === "all"} onClick={() => setMonth("all")}>
              <span>All months</span><span>{scopedDates.length}</span>
            </button>
            {groups.map((group) => (
              <button key={group.key} type="button" aria-pressed={activeMonth === group.key} onClick={() => setMonth(group.key)}>
                <span>{group.month} <small>{group.year}</small></span><span>{group.items.length}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="semester-timeline" aria-label="Important dates timeline">
          <div className="semester-list-heading">
            <p role="status">{visibleCount} {visibleCount === 1 ? "date" : "dates"}{scope === "upcoming" ? " ahead" : " in view"}</p>
            <span>Select a date to edit</span>
          </div>
          {visibleGroups.length ? visibleGroups.map((group) => (
            <section className="deadline-group" key={group.key} aria-labelledby={`month-${group.key}`}>
              <h2 className="deadline-month" id={`month-${group.key}`}>{group.month} <span>{group.year}</span></h2>
              <ul>
                {group.items.map((deadline) => {
                  const due = new Date(deadline.due_at);
                  const urgency = deadlineUrgency(due, now);
                  return (
                    <li className={`deadline-row ${urgency.tone}`} key={`${deadline.kind}-${deadline.id}`}>
                      <button type="button" aria-label={`Edit ${deadline.name}, ${deadline.course_code ?? "Personal work"}, ${due.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}`} onClick={() => setEditing({ deadline })}>
                        <time dateTime={deadline.due_at}>
                          <span>{due.toLocaleDateString("en-CA", { weekday: "short" })}</span>
                          <strong>{due.getDate()}</strong>
                        </time>
                        <div className="deadline-copy">
                          <div className="deadline-title"><h3>{deadline.name}</h3>{deadline.id === nextId && <span className="deadline-next">Next up</span>}</div>
                          <p>
                            <span className="deadline-course">{deadline.course_code || "Personal work"}</span>
                            {deadline.item_type && <span>{itemLabel(deadline.item_type)}</span>}
                            {deadline.weight_percent != null && <span className={`deadline-weight${deadline.weight_percent >= 15 ? " heavy" : ""}`}>{deadline.weight_percent}% of grade</span>}
                          </p>
                        </div>
                        <div className="deadline-meta">
                          <strong>{urgency.label}</strong>
                          <span>{due.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}{deadline.remaining_minutes != null ? ` · ${formatMinutes(deadline.remaining_minutes)} left` : ""}</span>
                        </div>
                        <Pencil className="deadline-edit-icon" size={15} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )) : (
            <div className="semester-empty">
              <CalendarRange size={28} aria-hidden="true" />
              <h2>{!deadlines.length ? "Your semester starts here." : courseId !== "all" ? "No dates match this view." : "No upcoming dates."}</h2>
              <p>{!deadlines.length ? "Add an important date, or import a course outline to bring in its deadlines." : courseId !== "all" ? "Try another course, or view all semester dates." : "Your saved dates are in the past. You can still review and edit them."}</p>
              {deadlines.length ? <button className="secondary-button" type="button" onClick={resetFilters}>View all dates</button> : <Link className="secondary-button" href="/courses">Review courses <ArrowRight size={16} aria-hidden="true" /></Link>}
            </div>
          )}
        </section>
      </div>

      <DeadlineEditor courses={courses.data ?? []} deadline={editing?.deadline ?? null} open={editing !== null} onClose={() => setEditing(null)} onSaved={async () => { await planning.reload(); }} />
    </main>
  );
}

function SemesterState({ loading = false, message, onRetry }: { loading?: boolean; message: string; onRetry?: () => Promise<void> }) {
  return <main className="page-shell planner-state">{loading && <LoaderCircle className="spin" size={26} />}<h1>{message}</h1><p>{loading ? "Gathering your saved deadlines and milestones." : "Your saved dates are unchanged."}</p>{onRetry && <button className="primary-button" type="button" onClick={onRetry}>Try again</button>}</main>;
}

function groupDeadlines(deadlines: SemesterDeadline[]) {
  const groups: { key: string; month: string; year: number; items: SemesterDeadline[] }[] = [];
  for (const deadline of deadlines) {
    const due = new Date(deadline.due_at);
    const key = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}`;
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(deadline);
    else groups.push({ key, month: due.toLocaleDateString("en-CA", { month: "long" }), year: due.getFullYear(), items: [deadline] });
  }
  return groups;
}

function deadlineUrgency(due: Date, now: number) {
  const today = new Date(now);
  const days = Math.round((Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
  if (due.getTime() < now) return { tone: "past", label: days === 0 ? "Earlier today" : days === -1 ? "Yesterday" : `${Math.abs(days)} days ago` };
  if (days === 0) return { tone: "now", label: "Today" };
  if (days === 1) return { tone: "now", label: "Tomorrow" };
  return { tone: days <= 7 ? "soon" : "later", label: days <= 13 ? `In ${days} days` : `In ${Math.round(days / 7)} weeks` };
}

function itemLabel(value: string) {
  return value === "final_exam" ? "Final exam" : value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}
