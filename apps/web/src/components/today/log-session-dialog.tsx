"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useState } from "react";

import { FormDialog } from "@/components/form-dialog";
import { formatMinutes } from "@/lib/today";
import type { PlanningEntry, WorkOutcome } from "@/lib/types";

const OUTCOMES: { value: WorkOutcome; label: string; help: string }[] = [
  { value: "finished", label: "Finished it", help: "Close the work and release future time." },
  { value: "still_going", label: "Still going", help: "Keep the remaining work active." },
  { value: "not_started", label: "Didn’t get to it", help: "Record an answer with no time logged." },
];

export function LogSessionDialog({
  entry,
  open,
  saving,
  saveError,
  initialMinutes,
  timer = false,
  onClose,
  onSave,
}: {
  entry: PlanningEntry | null;
  open: boolean;
  saving: boolean;
  saveError: string | null;
  initialMinutes?: number;
  timer?: boolean;
  onClose: () => void;
  onSave: (outcome: WorkOutcome, minutes: number) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<WorkOutcome>(timer ? "still_going" : entry?.check_in_outcome ?? "finished");
  const [hours, setHours] = useState(
    ((initialMinutes ?? (entry?.logged_minutes || entry?.planned_minutes || 0)) / 60).toFixed(2).replace(/0+$/, "").replace(/\.$/, ""),
  );
  const [error, setError] = useState<string | null>(null);
  if (!entry) return null;

  async function submit() {
    if (saving) return;
    const minutes = outcome === "not_started" ? 0 : Math.round(Number(hours) * 60);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440 || (!timer && outcome !== "not_started" && minutes === 0)) {
      setError("Enter the time you worked, or choose Didn’t get to it.");
      return;
    }
    setError(null);
    await onSave(outcome, minutes);
  }

  return (
    <FormDialog
      className="session-form-dialog"
      initialFocusSelector=".session-hours input"
      description={timer ? `The timer measured ${formatMinutes(initialMinutes ?? 0)}. Correct it before saving.` : `The planned time was ${formatMinutes(entry.planned_minutes)}. Change it to what actually happened.`}
      onClose={onClose}
      open={open}
      title={`${timer ? "Stop timer" : "Check in"} · ${entry.title}`}
    >
      <div className="session-dialog">
        <fieldset className="session-outcomes">
          <legend>What happened?</legend>
          {OUTCOMES.map((option) => (
            <label className={outcome === option.value ? "selected" : ""} key={option.value}>
              <input
                checked={outcome === option.value}
                name="session-outcome"
                type="radio"
                value={option.value}
                onChange={() => setOutcome(option.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submit();
                }}
              />
              <span><strong>{option.label}</strong><small>{option.help}</small></span>
            </label>
          ))}
        </fieldset>
        <label className="session-hours">
          <span>Time worked</span>
          <span className="intake-hours">
            <input
              disabled={outcome === "not_started"}
              inputMode="decimal"
              value={outcome === "not_started" ? "0" : hours}
              onChange={(event) => setHours(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
            <em>hrs</em>
          </span>
        </label>
        {error || saveError ? <p className="planner-alert error" role="alert">{error || saveError}</p> : null}
        <div className="planner-dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={saving} type="button" onClick={() => void submit()}>
            {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
            Save check-in
          </button>
        </div>
      </div>
    </FormDialog>
  );
}
