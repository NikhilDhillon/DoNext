import { AlertTriangle, Check } from "lucide-react";

import { formatMinutes, formatShortDate } from "@/lib/today";
import type { PlannerTask } from "@/lib/types";

export function ProgressPanel({
  tasks,
  timezone,
  onPlan,
}: {
  tasks: PlannerTask[];
  timezone: string;
  onPlan: (task: PlannerTask) => void;
}) {
  const unique = Array.from(new Map(tasks.map((task) => [task.id, task])).values());
  return (
    <section className="progress-panel">
      <header className="section-heading"><div><p className="eyebrow">Work in progress</p><h2>Effort you can see</h2></div></header>
      {unique.length ? (
        <ul>
          {unique.map((task) => {
            const percent = task.estimated_minutes
              ? Math.min(Math.round((task.logged_minutes / task.estimated_minutes) * 100), 100)
              : 0;
            return (
              <li key={task.id}>
                <button disabled={task.status === "completed"} type="button" onClick={() => onPlan(task)}>
                  <span className="progress-title"><strong>{task.course_code ? `${task.course_code} · ` : ""}{task.name}</strong>{task.status === "completed" ? <em><Check size={12} /> Done</em> : task.estimate_exceeded ? <em className="warning"><AlertTriangle size={12} /> Estimate passed</em> : null}</span>
                  <span className="progress-track"><i style={{ width: `${percent}%` }} /></span>
                  <small>
                    {formatMinutes(task.logged_minutes)} of {formatMinutes(task.estimated_minutes)} logged
                    {task.status !== "completed" ? ` · ${formatMinutes(task.remaining_minutes)} left` : ""}
                    {task.deadline_at ? ` · ${formatShortDate(task.deadline_at, timezone)}` : ""}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="planner-quiet">Logged academic work will build a progress history here.</p>}
    </section>
  );
}
