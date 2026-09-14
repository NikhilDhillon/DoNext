import { CalendarClock } from "lucide-react";

import { WorkIntake } from "@/components/work-intake";
import { formatMinutes } from "@/lib/today";
import type { ActivationPrompt, PlannerTask, Semester } from "@/lib/types";

export function AttentionPanel({
  semester,
  prompts,
  onChanged,
  unscheduledTasks,
  onPlan,
}: {
  semester: Semester;
  prompts: ActivationPrompt[];
  onChanged: () => Promise<void>;
  unscheduledTasks: PlannerTask[];
  onPlan: (task: PlannerTask) => void;
}) {
  const waiting = prompts.filter((prompt) => !prompt.activated);
  return (
    <section className="attention-panel">
      <header>
        <span><CalendarClock size={19} /></span>
        <div><p className="eyebrow">Needs your call</p><h2>{waiting.length ? `${waiting.length} ${waiting.length === 1 ? "deadline needs" : "deadlines need"} an answer` : "Your known deadlines are covered"}</h2></div>
      </header>
      <WorkIntake collapsed semester={semester} onChanged={onChanged} />
      {unscheduledTasks.length ? (
        <div className="today-unplaced">
          <h3>Active work without a place</h3>
          <p>This work is activated, but your accepted plan does not cover it.</p>
          <ul>{unscheduledTasks.map((task) => <li key={task.id}><button type="button" onClick={() => onPlan(task)}><strong>{task.name}</strong><span>{formatMinutes(task.remaining_minutes)} left · Plan work</span></button></li>)}</ul>
        </div>
      ) : null}
    </section>
  );
}
