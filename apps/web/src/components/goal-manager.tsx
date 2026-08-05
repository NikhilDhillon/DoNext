"use client";

import { Flame, LoaderCircle, Pause, Play, Plus, Sprout, Trash2 } from "lucide-react";
import { useState } from "react";
import type { CSSProperties, FormEvent } from "react";

import { FormDialog } from "@/components/form-dialog";
import { useApiResource } from "@/hooks/use-api-resource";
import { apiRequest, ApiRequestError } from "@/lib/api";
import type { Goal } from "@/lib/types";

const goalColors = ["mint", "violet", "coral"];

export function GoalManager() {
  const goals = useApiResource<Goal[]>("/goals");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function createGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setActionError(null);
    const form = new FormData(event.currentTarget);
    const preferred = Number(form.get("preferred_weekly_minutes"));
    try {
      await apiRequest<Goal>("/goals", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          category: form.get("category"),
          priority: form.get("priority"),
          start_date: new Date().toISOString().slice(0, 10),
          target_date: form.get("target_date") || null,
          target_description: form.get("target_description") || null,
          minimum_weekly_minutes: Math.min(30, preferred),
          preferred_weekly_minutes: preferred,
          maximum_weekly_minutes: Math.max(preferred, preferred * 2),
          maintenance_weekly_minutes: Math.min(25, preferred),
          reducible_during_busy_weeks: form.get("reducible") === "on",
        }),
      });
      setDialogOpen(false);
      await goals.reload();
    } catch (error) {
      setActionError(error instanceof ApiRequestError ? error.message : "Could not save the goal.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleGoal(goal: Goal) {
    setActionError(null);
    const action = goal.status === "paused" ? "resume" : "pause";
    try {
      await apiRequest<Goal>(`/goals/${goal.id}/${action}`, { method: "POST" });
      await goals.reload();
    } catch (error) {
      setActionError(error instanceof ApiRequestError ? error.message : "Could not update the goal.");
    }
  }

  async function deleteGoal(goal: Goal) {
    if (!window.confirm(`Remove “${goal.name}” from your goals?`)) return;
    setActionError(null);
    try {
      await apiRequest<void>(`/goals/${goal.id}`, { method: "DELETE" });
      await goals.reload();
    } catch (error) {
      setActionError(error instanceof ApiRequestError ? error.message : "Could not remove the goal.");
    }
  }

  const activeGoals = goals.data?.filter((goal) => goal.status === "active") ?? [];
  const plannedMinutes = activeGoals.reduce((sum, goal) => sum + goal.preferred_weekly_minutes, 0);

  return (
    <main className="page-shell">
      <header className="page-heading">
        <div><p className="eyebrow">Beyond the syllabus</p><h1>Goals that still fit your life.</h1><p>DoNext protects steady progress, then shifts flexible goals to maintenance when school gets heavy.</p></div>
        <button className="primary-button" type="button" onClick={() => setDialogOpen(true)}><Plus size={17} /> Add goal</button>
      </header>

      {actionError ? <p className="page-alert" role="alert">{actionError}</p> : null}
      {goals.loading ? <div className="page-status" role="status"><LoaderCircle className="spin" size={20} /><span>Loading your goals</span></div> : null}
      {goals.error ? <section className="empty-state error-state"><h2>DoNext couldn’t load your goals.</h2><p>{goals.error}</p><button className="secondary-button" type="button" onClick={() => void goals.reload()}>Try again</button></section> : null}

      {!goals.loading && !goals.error ? (
        <>
          <section className="goal-summary-card">
            <div className="goal-summary-icon"><Sprout size={24} /></div>
            <div><p className="eyebrow">This week</p><h2>{activeGoals.length ? "A sustainable rhythm starts with honest targets." : "Make room for something beyond the syllabus."}</h2></div>
            <div className="goal-summary-stat"><strong>{formatMinutes(plannedMinutes)}</strong><span>preferred across {activeGoals.length} active {activeGoals.length === 1 ? "goal" : "goals"}</span></div>
          </section>

          {goals.data?.length === 0 ? (
            <section className="empty-state"><span><Sprout size={25} /></span><h2>Add a goal worth protecting.</h2><p>Set a preferred weekly rhythm and a smaller maintenance level for busy weeks.</p><button className="primary-button" type="button" onClick={() => setDialogOpen(true)}><Plus size={17} /> Add your first goal</button></section>
          ) : null}

          <section className="goals-list">
            {goals.data?.map((goal, index) => {
              const hasProgress = goal.current_progress !== null && goal.target_progress !== null;
              const percent = hasProgress ? Math.min(100, Math.round((goal.current_progress! / goal.target_progress!) * 100)) : goal.status === "completed" ? 100 : 0;
              return (
                <article className={`goal-card ${goal.status === "paused" ? "is-paused" : ""}`} key={goal.id}>
                  <div className={`goal-orb ${goalColors[index % goalColors.length]}`}><span style={{ "--progress": `${percent * 3.6}deg` } as CSSProperties}>{hasProgress ? `${percent}%` : <Sprout size={17} />}</span></div>
                  <div className="goal-main">
                    <span className="goal-category">{goal.category} · {goal.status}</span>
                    <h2>{goal.name}</h2>
                    <p>{goal.target_description || `${formatMinutes(goal.preferred_weekly_minutes)} preferred each week`}</p>
                    <div className="goal-progress-row"><div className="progress-track"><span style={{ width: hasProgress ? `${percent}%` : "12%" }} /></div><span>{formatMinutes(goal.minimum_weekly_minutes)} minimum · {formatMinutes(goal.preferred_weekly_minutes)} preferred</span></div>
                  </div>
                  <div className="goal-rhythm"><Flame size={16} /><span>{goal.priority}</span></div>
                  <div className="card-actions">
                    <button aria-label={goal.status === "paused" ? `Resume ${goal.name}` : `Pause ${goal.name}`} type="button" onClick={() => void toggleGoal(goal)}>{goal.status === "paused" ? <Play size={17} /> : <Pause size={17} />}</button>
                    <button aria-label={`Remove ${goal.name}`} type="button" onClick={() => void deleteGoal(goal)}><Trash2 size={17} /></button>
                  </div>
                </article>
              );
            })}
          </section>

          <section className="maintenance-note"><div><strong>Maintenance mode is built into every flexible goal.</strong><p>During a busy week, the scheduler can shrink flexible goals without making them disappear.</p></div></section>
        </>
      ) : null}

      <FormDialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Add a personal goal" description="Choose a rhythm that can survive a demanding week.">
        <form className="stacked-form" onSubmit={createGoal}>
          <label><span>Goal name</span><input name="name" placeholder="Practice conversational French" required /></label>
          <div className="form-row"><label><span>Category</span><select name="category" defaultValue="personal"><option value="personal">Personal</option><option value="health">Health</option><option value="career">Career</option><option value="creative">Creative</option><option value="learning">Learning</option></select></label><label><span>Priority</span><select name="priority" defaultValue="medium"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="optional">Optional</option></select></label></div>
          <div className="form-row"><label><span>Preferred weekly time</span><select name="preferred_weekly_minutes" defaultValue="120"><option value="30">30 minutes</option><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option><option value="180">3 hours</option><option value="240">4 hours</option></select></label><label><span>Target date <small>Optional</small></span><input name="target_date" type="date" /></label></div>
          <label><span>What does success look like? <small>Optional</small></span><input name="target_description" placeholder="Hold a 15-minute conversation" /></label>
          <label className="checkbox-field"><input name="reducible" type="checkbox" defaultChecked /><span><strong>Allow a maintenance week</strong><small>DoNext may temporarily reduce this goal when deadlines pile up.</small></span></label>
          {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
          <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setDialogOpen(false)}>Cancel</button><button className="primary-button" disabled={submitting} type="submit">{submitting ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />} Save goal</button></div>
        </form>
      </FormDialog>
    </main>
  );
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}
