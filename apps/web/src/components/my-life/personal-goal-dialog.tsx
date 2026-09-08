"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useState } from "react";

import { FormDialog } from "@/components/form-dialog";
import { apiRequest, ApiRequestError } from "@/lib/api";
import { GOAL_CATEGORIES, PRIORITIES, todayInTimezone } from "@/lib/commitments";
import type { Goal } from "@/lib/types";

const WEEKLY_MINUTE_OPTIONS = [
  ["30", "30 minutes"],
  ["60", "1 hour"],
  ["90", "1.5 hours"],
  ["120", "2 hours"],
  ["180", "3 hours"],
  ["240", "4 hours"],
  ["300", "5 hours"],
] as const;

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  timezone: string;
  semesterId: string | null;
  editing: Goal | null;
};

export function PersonalGoalDialog({ open, onClose, onSaved, timezone, semesterId, editing }: Props) {
  const today = todayInTimezone(timezone);
  const [name, setName] = useState(editing?.name ?? "");
  const [category, setCategory] = useState(editing?.category ?? "personal");
  const [priority, setPriority] = useState<string>(editing?.priority ?? "medium");
  const [weeklyMinutes, setWeeklyMinutes] = useState(
    editing ? String(editing.preferred_weekly_minutes) : "120",
  );
  const [targetDate, setTargetDate] = useState(editing?.target_date ?? "");
  const [targetDescription, setTargetDescription] = useState(editing?.target_description ?? "");
  const [reducible, setReducible] = useState(editing ? editing.reducible_during_busy_weeks : true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const preferred = Number(weeklyMinutes);
    if (!name.trim()) {
      setError("Give this goal a name.");
      return;
    }
    if (targetDate && targetDate < today) {
      setError("The target date must be in the future.");
      return;
    }
    const body = {
      name: name.trim(),
      category,
      priority,
      target_date: targetDate || null,
      target_description: targetDescription.trim() || null,
      minimum_weekly_minutes: Math.min(30, preferred),
      preferred_weekly_minutes: preferred,
      maximum_weekly_minutes: Math.max(preferred, preferred * 2),
      maintenance_weekly_minutes: reducible ? Math.min(25, preferred) : preferred,
      reducible_during_busy_weeks: reducible,
    };
    setBusy(true);
    try {
      if (editing) {
        await apiRequest<Goal>(`/goals/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await apiRequest<Goal>("/goals", {
          method: "POST",
          body: JSON.stringify({
            ...body,
            planning_kind: "goal",
            start_date: today,
            semester_id: semesterId,
          }),
        });
      }
      await onSaved();
      onClose();
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError ? requestError.message : "Could not save this goal.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={editing ? "Edit personal goal" : "Add a personal goal"}
      description="A rhythm that can survive a demanding week."
    >
      <form className="stacked-form" onSubmit={submit}>
        <label>
          <span>Goal name</span>
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="Practice conversational French"
            required
          />
        </label>
        <div className="form-row">
          <label>
            <span>Category</span>
            <select value={category} onChange={(event) => setCategory(event.currentTarget.value)}>
              {GOAL_CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Priority</span>
            <select value={priority} onChange={(event) => setPriority(event.currentTarget.value)}>
              {PRIORITIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            <span>Preferred weekly time</span>
            <select
              value={weeklyMinutes}
              onChange={(event) => setWeeklyMinutes(event.currentTarget.value)}
            >
              {WEEKLY_MINUTE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>
              Target date <small>Optional</small>
            </span>
            <input
              type="date"
              value={targetDate}
              min={today}
              onChange={(event) => setTargetDate(event.currentTarget.value)}
            />
          </label>
        </div>
        <label>
          <span>
            What does success look like? <small>Optional</small>
          </span>
          <input
            value={targetDescription}
            onChange={(event) => setTargetDescription(event.currentTarget.value)}
            placeholder="Hold a 15-minute conversation"
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={reducible}
            onChange={(event) => setReducible(event.currentTarget.checked)}
          />
          <span>
            <strong>Allow a maintenance week</strong>
            <small>DoNext may temporarily reduce this goal when deadlines pile up.</small>
          </span>
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}
            {editing ? "Save changes" : "Save goal"}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}
