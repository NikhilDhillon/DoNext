"use client";

import { Bookmark, Check, Info, LoaderCircle, RefreshCw, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ScheduleRevisionDialog } from "@/components/schedule-revision-dialog";
import { useApiResource, type ApiResource } from "@/hooks/use-api-resource";
import { apiRequest, ApiRequestError } from "@/lib/api";
import { extraFocusDecisionMessage } from "@/lib/schedule-generation";
import type { Preferences, ScheduleProposal, ScheduleGenerationRequirements, ScheduleRevisionReason, Semester } from "@/lib/types";

type ScheduleProposalReviewProps = {
  semester: Semester;
  proposal: ApiResource<ScheduleProposal>;
  onAccepted: () => Promise<void>;
};

/**
 * The one decision on the Week page: accept this draft, ask for a different one, or say what is
 * wrong with it. The draft's placements are drawn in the week calendar itself, so this card
 * carries only what the calendar cannot say.
 */
export function ScheduleProposalReview({ semester, proposal, onAccepted }: ScheduleProposalReviewProps) {
  const [busy, setBusy] = useState(false);
  const [generationState, setGenerationState] = useState<"idle" | "running" | "success">("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [undoConfirming, setUndoConfirming] = useState(false);
  const [undone, setUndone] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [forgotten, setForgotten] = useState(false);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A preference kept from an earlier revision shapes this draft and every later one, so the
  // card that asks for the accept decision is where it has to be readable and revocable.
  const preferences = useApiResource<Preferences>("/preferences");

  useEffect(() => () => {
    if (successTimer.current) clearTimeout(successTimer.current);
  }, []);

  function flashSuccess(delay: number) {
    setGenerationState("success");
    successTimer.current = setTimeout(() => {
      setGenerationState("idle");
      successTimer.current = null;
    }, delay);
  }

  async function generate() {
    if (busy || forgetting) return;
    const resettingDraft = proposal.data !== null;
    if (successTimer.current) clearTimeout(successTimer.current);
    setBusy(true);
    setGenerationState("running");
    setError(null);
    try {
      const requirements = await apiRequest<ScheduleGenerationRequirements>(
        `/semesters/${semester.id}/schedule/generation-requirements`,
      );
      if (requirements.blocking_inputs.length) {
        throw new Error(requirements.blocking_inputs.map((item) => item.message).join(" "));
      }
      let generated: ScheduleProposal;
      try {
        generated = await apiRequest<ScheduleProposal>(
          `/semesters/${semester.id}/schedule/proposals`,
          { method: "POST", body: JSON.stringify({}) },
        );
      } catch (requestError) {
        if (
          requestError instanceof ApiRequestError
          && requestError.code === "SCHEDULER_EXTRA_FOCUS_PERMISSION_REQUIRED"
        ) {
          const allowed = window.confirm(extraFocusDecisionMessage(requestError.details));
          generated = await apiRequest<ScheduleProposal>(
            `/semesters/${semester.id}/schedule/proposals`,
            {
              method: "POST",
              body: JSON.stringify({
                extra_focus_decision: {
                  approved: allowed,
                  request_fingerprint: requestError.details?.request_fingerprint,
                },
              }),
            },
          );
        } else {
          throw requestError;
        }
      }
      proposal.setData(generated);
      setForgotten(false);
      setResetConfirming(false);
      setUndoConfirming(false);
      setUndone(false);
      if (resettingDraft) {
        flashSuccess(1800);
      } else {
        setGenerationState("idle");
      }
    } catch (requestError) {
      setGenerationState("idle");
      setError(errorMessage(requestError, "DoNext could not generate a schedule draft."));
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!proposal.data || busy || forgetting) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest<ScheduleProposal | void>(`/schedule-proposals/${proposal.data.id}/accept`, { method: "POST" });
      proposal.setData(null);
      setConfirming(false);
      await onAccepted();
    } catch (requestError) {
      setError(errorMessage(requestError, "DoNext could not accept this draft."));
    } finally {
      setBusy(false);
    }
  }

  async function revise(payload: { reasons: ScheduleRevisionReason[]; note: string; remember: boolean }) {
    if (!proposal.data || busy || forgetting) return;
    setBusy(true);
    setRevisionError(null);
    try {
      const revised = await apiRequest<ScheduleProposal>(
        `/schedule-proposals/${proposal.data.id}/revise`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      proposal.setData(revised);
      setForgotten(false);
      setUndoConfirming(false);
      setUndone(false);
      await preferences.reload();
      setRevisionOpen(false);
      flashSuccess(2200);
    } catch (requestError) {
      setRevisionError(
        errorMessage(requestError, "DoNext could not apply that feedback. The current draft is unchanged."),
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Take back the last piece of feedback. The draft it replaced is still on the server, so this
   * puts back the exact plan the student was looking at rather than asking for another
   * interpretation of the same words, which could land somewhere else again.
   */
  async function undoRevision() {
    if (!proposal.data || busy || forgetting) return;
    setBusy(true);
    setError(null);
    try {
      const restored = await apiRequest<ScheduleProposal>(
        `/schedule-proposals/${proposal.data.id}/undo-revision`,
        { method: "POST" },
      );
      proposal.setData(restored);
      setUndoConfirming(false);
      setForgotten(false);
      setUndone(true);
      // Undoing may have put back the preference the revision overwrote, or cleared one it saved.
      await preferences.reload();
    } catch (requestError) {
      setError(errorMessage(requestError, "DoNext could not undo that feedback."));
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    if (!preferences.data || busy || forgetting) return;
    setForgetting(true);
    setError(null);
    try {
      await apiRequest<void>("/preferences/remembered-schedule-preferences", { method: "DELETE" });
      preferences.setData({ ...preferences.data, remembered_schedule_preferences: [] });
      // Its blocks still reflect the old inputs; only a reset draft can be accepted now.
      proposal.setData((current) => current ? { ...current, stale: true } : current);
      setConfirming(false);
      setResetConfirming(false);
      setUndoConfirming(false);
      setUndone(false);
      setForgotten(true);
    } catch (requestError) {
      setError(errorMessage(requestError, "DoNext could not forget that preference."));
    } finally {
      setForgetting(false);
    }
  }

  if (proposal.loading && !proposal.data) {
    return <section className="draft-decision loading"><LoaderCircle className="spin" size={18} /> Checking for a draft</section>;
  }

  if (!proposal.data) {
    return (
      <section className="draft-prompt">
        <span><Sparkles size={22} /></span>
        <div>
          <strong>No draft is waiting.</strong>
          <small>Build one to give your deadlines, goals and rest actual time.</small>
        </div>
        <button className="primary-button" disabled={busy || forgetting} type="button" onClick={() => void generate()}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={17} />} Plan the next 14 days
        </button>
        {error ? <p className="planner-alert error" role="alert">{error}</p> : null}
      </section>
    );
  }

  const draft = proposal.data;
  const remembered = preferences.data?.remembered_schedule_preferences ?? [];
  const summary = draft.generation_summary;
  const unplaced = summary.unscheduled;
  const covered = summary.requested_minutes
    ? Math.min(Math.round((summary.scheduled_minutes / summary.requested_minutes) * 100), 100)
    : 100;

  return (
    <section className="draft-decision" aria-label="Draft">
      <div className="draft-decision-top">
        <div>
          <p className="eyebrow">Draft · {formatRange(draft.horizon_start, draft.horizon_end)}</p>
          <h2>{unplaced.length === 0 ? "All active work fits" : "Some work found no room"}</h2>
        </div>
        {confirming ? (
          <div className="draft-actions confirm" role="alert">
            <span>Replace the accepted schedule with this draft?</span>
            <button className="ghost-button" type="button" onClick={() => setConfirming(false)}>Cancel</button>
            <button className="primary-button" disabled={busy || forgetting || draft.stale} type="button" onClick={() => void accept()}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Confirm
            </button>
          </div>
        ) : resetConfirming ? (
          <div className="draft-actions confirm" role="alert">
            <span>Reset to DoNext&apos;s default plan? Added blocks and edits will be removed.</span>
            <button className="ghost-button" type="button" onClick={() => setResetConfirming(false)}>Keep changes</button>
            <button className="danger-button" disabled={busy || forgetting} type="button" onClick={() => void generate()}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />} {busy ? "Resetting…" : "Reset draft"}
            </button>
          </div>
        ) : (
          <div className="draft-actions">
            <button className={`ghost-button regenerate ${generationState}`} disabled={busy || forgetting} type="button" onClick={() => setResetConfirming(true)}>
              {generationState === "running" ? <LoaderCircle className="spin" size={15} /> : null}
              {generationState === "success" ? <Check className="regeneration-success-icon" size={15} /> : null}
              {generationState === "idle" ? <RefreshCw size={15} /> : null}
              <span aria-live="polite">{resetLabel(generationState)}</span>
            </button>
            <button className="secondary-button" disabled={busy || forgetting} type="button" onClick={() => { setRevisionError(null); setRevisionOpen(true); }}>
              Adjust
            </button>
            <button className="primary-button" disabled={busy || forgetting || draft.stale} type="button" onClick={() => setConfirming(true)}>
              <Check size={16} /> Accept plan
            </button>
          </div>
        )}
      </div>

      {remembered.length > 0 ? (
        <p className="draft-remembered">
          <Bookmark size={15} />
          <span><strong>Remembering</strong> {remembered.join(" · ")}</span>
          <button disabled={busy || forgetting || revisionOpen} type="button" onClick={() => void forget()}>{forgetting ? "Forgetting…" : "Forget"}</button>
        </p>
      ) : null}

      {undone && !draft.revision_feedback ? (
        <p className="draft-remembered undone" role="status">
          <Undo2 size={15} />
          <span>Feedback undone. This is the draft you had before it.</span>
        </p>
      ) : null}

      {forgotten && remembered.length === 0 ? (
        <p className="draft-remembered forgotten" role="status">
          <Bookmark size={15} />
          <span>Feedback forgotten. Choose Reset to default to replan these same dates without it.</span>
        </p>
      ) : null}

      {unplaced.length > 0 ? (
        <div className="draft-meter">
          <span><i style={{ width: `${covered}%` }} /></span>
        </div>
      ) : null}

      {draft.revision_feedback && undoConfirming ? (
        <div className="revision-applied undoing" role="alert">
          <Undo2 size={17} />
          <span>
            <strong>Undo this feedback?</strong>
            <small>{undoConsequences(draft)}</small>
          </span>
          <button className="ghost-button" disabled={busy || forgetting} type="button" onClick={() => setUndoConfirming(false)}>
            Keep it
          </button>
          <button className="danger-button" disabled={busy || forgetting} type="button" onClick={() => void undoRevision()}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Undo2 size={15} />}
            {busy ? "Undoing…" : "Undo feedback"}
          </button>
        </div>
      ) : draft.revision_feedback ? (
        <div className="revision-applied" role="status">
          <Sparkles size={17} />
          <span>
            <strong>Applied your feedback</strong>
            <small>
              {draft.revision_feedback.summary}
              {draft.revision_feedback.changes ? formatRevisionChanges(draft.revision_feedback.changes) : ""}
            </small>
          </span>
          <em>{draft.revision_feedback.interpreter === "openai" ? "AI interpreted" : "Quick preferences"}</em>
          {draft.can_undo_revision ? (
            <button className="revision-undo" disabled={busy || forgetting || revisionOpen} type="button" onClick={() => { setError(null); setUndoConfirming(true); }}>
              <Undo2 size={14} /> Undo
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="draft-notes">
        <p className="draft-note rule">
          <Info size={16} />
          <span>{ACTIVATION_NOTE}</span>
        </p>
      </div>

      {error ? <p className="planner-alert error" role="alert">{error}</p> : null}

      {revisionOpen ? (
        <ScheduleRevisionDialog busy={busy || forgetting} error={revisionError} open onClose={() => setRevisionOpen(false)} onSubmit={revise} />
      ) : null}
    </section>
  );
}

const ACTIVATION_NOTE = "Every assignment must be activated from Home before this plan will "
  + "reserve time for it. Until then it is tracked as a deadline but holds no time.";

/**
 * What undoing costs, beyond the placements going back. Hand edits belong to the revised draft and
 * leave with it, and a revision that was remembered is still shaping every later draft, so both
 * have to be said before the student commits rather than discovered afterwards.
 */
function undoConsequences(draft: ScheduleProposal) {
  const consequences = ["This draft goes back to the one you had before this feedback."];
  if (draft.generation_summary.moved_blocks > 0) {
    consequences.push("Blocks you moved since will go with it.");
  }
  if (draft.revision_feedback?.remembered) {
    consequences.push("The preference it saved will be forgotten.");
  }
  return consequences.join(" ");
}

function resetLabel(state: "idle" | "running" | "success") {
  if (state === "running") return "Resetting";
  return state === "success" ? "Default restored" : "Reset to default";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} h ${remainder}m` : `${hours} h`;
}

function formatRevisionChanges(changes: NonNullable<ScheduleProposal["revision_feedback"]>["changes"]) {
  if (!changes) return "";
  const details = [`${changes.blocks_changed} placement changes`];
  if (changes.block_count_delta !== 0) {
    details.push(`${Math.abs(changes.block_count_delta)} ${changes.block_count_delta > 0 ? "more" : "fewer"} blocks`);
  }
  if (changes.scheduled_minutes_delta !== 0) {
    details.push(`${formatMinutes(Math.abs(changes.scheduled_minutes_delta))} ${changes.scheduled_minutes_delta > 0 ? "more" : "less"} scheduled`);
  }
  return ` · ${details.join(" · ")}`;
}

function formatRange(start: string, end: string) {
  const month = new Intl.DateTimeFormat("en-CA", { month: "short", timeZone: "UTC" });
  const day = new Intl.DateTimeFormat("en-CA", { day: "numeric", timeZone: "UTC" });
  const from = new Date(`${start}T12:00:00Z`);
  const to = new Date(`${end}T12:00:00Z`);
  const tail = month.format(from) === month.format(to)
    ? day.format(to)
    : `${month.format(to)} ${day.format(to)}`;
  return `${month.format(from)} ${day.format(from)}–${tail}`;
}
