"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";

import { FormDialog } from "@/components/form-dialog";
import type { ScheduleRevisionReason } from "@/lib/types";

const REASONS: {
  value: ScheduleRevisionReason;
  label: string;
  description: string;
}[] = [
  { value: "too_packed", label: "Too packed", description: "Use fewer blocks each day." },
  { value: "wrong_times", label: "Wrong times", description: "Use the note to describe better times." },
  { value: "sessions_too_long", label: "Sessions too long", description: "Break work into shorter sessions." },
  { value: "sessions_too_short", label: "Sessions too short", description: "Use longer, less fragmented sessions." },
  { value: "balance_activities", label: "Activities feel unbalanced", description: "Share flexible time more evenly." },
  { value: "other", label: "Something else", description: "Tell DoNext what should change." },
];

export function ScheduleRevisionDialog({
  open,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: {
    reasons: ScheduleRevisionReason[];
    note: string;
    remember: boolean;
  }) => Promise<void>;
}) {
  const [reasons, setReasons] = useState<ScheduleRevisionReason[]>([]);
  const [note, setNote] = useState("");
  const [remember, setRemember] = useState(false);

  function toggle(reason: ScheduleRevisionReason) {
    setReasons((current) => (
      current.includes(reason)
        ? current.filter((value) => value !== reason)
        : [...current, reason]
    ));
  }

  const requiresNote = reasons.includes("other");
  const canSubmit = reasons.length > 0 && (!requiresNote || note.trim().length > 0);

  return (
    <FormDialog
      open={open}
      title="What should change?"
      description="DoNext will use your feedback to build a new draft. Your current draft stays available if revision fails."
      onClose={busy ? () => undefined : onClose}
    >
      <form
        className="revision-feedback-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) void onSubmit({ reasons, note: note.trim(), remember });
        }}
      >
        <fieldset className="revision-reasons">
          <legend>Choose every reason that applies</legend>
          {REASONS.map((reason) => {
            const selected = reasons.includes(reason.value);
            return (
              <label className={selected ? "selected" : ""} key={reason.value}>
                <input
                  checked={selected}
                  disabled={busy}
                  type="checkbox"
                  onChange={() => toggle(reason.value)}
                />
                <span><strong>{reason.label}</strong><small>{reason.description}</small></span>
              </label>
            );
          })}
        </fieldset>
        <label className="revision-note">
          <span>What would make this draft better? <small>Optional</small></span>
          <textarea
            disabled={busy}
            maxLength={1000}
            placeholder="For example: Keep gym after 5 PM and avoid stacking three activities in one evening."
            rows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <label className="revision-remember">
          <input
            checked={remember}
            disabled={busy}
            type="checkbox"
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span><strong>Remember for future drafts</strong><small>Save the validated preference, not this note.</small></span>
        </label>
        <p className="revision-safety-copy">
          DoNext uses AI only to interpret this feedback. The scheduling engine still enforces every class, fixed commitment, deadline, focus hour, and break.
        </p>
        {error ? <p className="planner-alert error" role="alert">{error}</p> : null}
        <div className="dialog-actions">
          <button className="secondary-button" disabled={busy} type="button" onClick={onClose}>Keep current draft</button>
          <button className="primary-button" disabled={busy || !canSubmit} type="submit">
            {busy ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
            {busy ? "Building revised draft…" : "Reject and regenerate"}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}
