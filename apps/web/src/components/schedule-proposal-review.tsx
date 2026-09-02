"use client";

import {
  AlertTriangle,
  CalendarClock,
  Check,
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DraftScheduleCalendar } from "@/components/draft-schedule-calendar";
import { ScheduleBlockEditor } from "@/components/schedule-block-editor";
import { ScheduleRevisionDialog } from "@/components/schedule-revision-dialog";
import { useApiResource } from "@/hooks/use-api-resource";
import { apiRequest, ApiRequestError } from "@/lib/api";
import { extraFocusDecisionMessage } from "@/lib/schedule-generation";
import type {
  AvailabilityWindow,
  PlannerTask,
  PlanningEntry,
  ScheduleBlock,
  ScheduleProposal,
  ScheduleGenerationRequirements,
  ScheduleRevisionReason,
  Semester,
} from "@/lib/types";

const completeSolverTimeoutWarning = "Everything fits. Regenerate for a different arrangement.";
const partialSolverTimeoutWarning =
  "Some work did not fit — see unresolved items below. Regenerate for a different arrangement.";
// Drafts generated before the copy was shortened still carry the long warnings, so they stay
// recognizable here; only the wording shown to the student changes.
const solverTimeoutWarnings = new Set([
  "The solver reached its time limit; this feasible draft may not be optimal.",
  "Everything fits: all requested work is scheduled and every hard constraint is satisfied. DoNext stopped after its optimization limit, so a different valid arrangement may match your preferences slightly better.",
  "DoNext found a valid partial draft before its optimization limit, but some work remains unscheduled. Review the unresolved items below; a different valid arrangement may fit more work or match your preferences better.",
  completeSolverTimeoutWarning,
  partialSolverTimeoutWarning,
]);

type ScheduleProposalReviewProps = {
  semester: Semester;
  tasks: PlannerTask[];
  timezone: string;
  onAccepted: () => Promise<void>;
};

export function ScheduleProposalReview({
  semester,
  tasks,
  timezone,
  onAccepted,
}: ScheduleProposalReviewProps) {
  const proposal = useApiResource<ScheduleProposal>(
    `/semesters/${semester.id}/schedule/proposal`,
  );
  const availability = useApiResource<AvailabilityWindow[]>("/availability");
  const [busy, setBusy] = useState(false);
  const [generationState, setGenerationState] = useState<"idle" | "running" | "success">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<PlanningEntry | null>(null);
  const [duplicateEntry, setDuplicateEntry] = useState<PlanningEntry | null>(null);
  const [editorDate, setEditorDate] = useState(semester.start_date);
  const generationSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (generationSuccessTimer.current) clearTimeout(generationSuccessTimer.current);
  }, []);

  async function generate() {
    if (generationSuccessTimer.current) clearTimeout(generationSuccessTimer.current);
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
      for (const exam of requirements.exams) {
        const useDefault = window.confirm(
          `${exam.course_code} · ${exam.name} is now inside the 14-day plan. Use the 8-hour preparation default? Choose Cancel to enter your own estimate.`,
        );
        if (useDefault) {
          await apiRequest(`/academic-items/${exam.academic_item_id}/effort-estimate`, {
            method: "PUT",
            body: JSON.stringify({ decision: "use_default" }),
          });
          continue;
        }
        const hours = window.prompt(
          `How many hours of preparation will you need for ${exam.course_code} · ${exam.name}?`,
          "",
        );
        if (hours === null) throw new Error("Schedule generation was cancelled.");
        const minutes = Math.round(Number(hours) * 12) * 5;
        if (!Number.isFinite(minutes) || minutes < 15) {
          throw new Error("Enter a valid exam preparation estimate.");
        }
        await apiRequest(`/academic-items/${exam.academic_item_id}/effort-estimate`, {
          method: "PUT",
          body: JSON.stringify({ decision: "student", minutes }),
        });
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
      setGenerationState("success");
      generationSuccessTimer.current = setTimeout(() => {
        setGenerationState("idle");
        generationSuccessTimer.current = null;
      }, 1800);
    } catch (requestError) {
      setGenerationState("idle");
      setError(errorMessage(requestError, "DoNext could not generate a schedule draft."));
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!proposal.data) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest<ScheduleProposal | void>(
        `/schedule-proposals/${proposal.data.id}/accept`,
        { method: "POST" },
      );
      proposal.setData(null);
      setConfirming(false);
      await onAccepted();
    } catch (requestError) {
      setError(errorMessage(requestError, "DoNext could not accept this draft."));
    } finally {
      setBusy(false);
    }
  }

  async function revise(payload: {
    reasons: ScheduleRevisionReason[];
    note: string;
    remember: boolean;
  }) {
    if (!proposal.data) return;
    setBusy(true);
    setRevisionError(null);
    try {
      const revised = await apiRequest<ScheduleProposal>(
        `/schedule-proposals/${proposal.data.id}/revise`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      proposal.setData(revised);
      setRevisionOpen(false);
      setGenerationState("success");
      generationSuccessTimer.current = setTimeout(() => {
        setGenerationState("idle");
        generationSuccessTimer.current = null;
      }, 2200);
    } catch (requestError) {
      setRevisionError(
        errorMessage(requestError, "DoNext could not apply that feedback. The current draft is unchanged."),
      );
    } finally {
      setBusy(false);
    }
  }

  function edit(block: ScheduleBlock) {
    setDuplicateEntry(null);
    setSelectedEntry(blockEntry(block));
    setEditorDate(dateInTimezone(block.start_at, timezone));
    setEditorOpen(true);
  }

  function addBlock(date?: string) {
    setDuplicateEntry(null);
    setSelectedEntry(null);
    setEditorDate(
      date
      ?? firstFocusDate(
        proposal.data?.horizon_start ?? semester.start_date,
        proposal.data?.horizon_end ?? semester.end_date,
        availability.data ?? [],
      ),
    );
    setEditorOpen(true);
  }

  function duplicateBlock(block: ScheduleBlock) {
    const entry = blockEntry(block);
    setSelectedEntry(null);
    setDuplicateEntry(entry);
    setEditorDate(dateInTimezone(block.start_at, timezone));
    setEditorOpen(true);
  }

  if (proposal.loading && !proposal.data) {
    return <section className="proposal-review loading"><LoaderCircle className="spin" size={20} /> Checking for a draft</section>;
  }

  if (!proposal.data) {
    return (
      <section className="proposal-launch">
        <span><Sparkles size={22} /></span>
        <div>
          <p className="eyebrow">Student-aware deterministic planning</p>
          <h2>Build a reviewable 14-day draft.</h2>
          <p>DoNext starts ready assignments early, protects urgent deadlines, and activates exam preparation inside the next 14 days. Your accepted plan remains untouched until you approve the draft.</p>
        </div>
        <button className="primary-button" disabled={busy} type="button" onClick={() => void generate()}>
          <CalendarClock size={17} /> Generate 14-day plan
        </button>
        {error ? <p className="planner-alert error" role="alert">{error}</p> : null}
      </section>
    );
  }

  const draft = proposal.data;
  return (
    <section className="proposal-review">
      <header>
        <div>
          <p className="eyebrow">Draft schedule · {formatRange(draft.horizon_start, draft.horizon_end)}</p>
          <h2>Review every placement before it becomes active.</h2>
        </div>
        <button
          className={`secondary-button regeneration-button ${generationState}`}
          disabled={busy}
          type="button"
          onClick={() => void generate()}
        >
          {generationState === "success" ? (
            <Check className="regeneration-success-icon" size={16} />
          ) : (
            <RefreshCw size={16} />
          )}
          <span aria-live="polite">
            {generationState === "success" ? "Draft updated" : "Regenerate"}
          </span>
        </button>
      </header>

      <div className="proposal-metrics">
        <div><strong>{formatMinutes(draft.generation_summary.scheduled_minutes)}</strong><span>scheduled</span></div>
        <div><strong>{formatMinutes(draft.generation_summary.requested_minutes)}</strong><span>requested</span></div>
      </div>

      {draft.revision_feedback ? (
        <div className="revision-applied" role="status">
          <Sparkles size={17} />
          <span>
            <strong>Applied your feedback</strong>
            <small>
              {draft.revision_feedback.summary}
              {draft.revision_feedback.changes
                ? formatRevisionChanges(draft.revision_feedback.changes)
                : ""}
            </small>
          </span>
          <em>{draft.revision_feedback.interpreter === "openai" ? "AI interpreted" : "Quick preferences"}</em>
        </div>
      ) : null}

      {draft.stale ? (
        <p className="planner-alert error"><AlertTriangle size={15} /> Inputs changed. Regenerate before accepting.</p>
      ) : null}
      {draft.generation_summary.warnings.map((warning) => {
        const display = proposalWarningDisplay(warning, draft.generation_summary);
        return (
          <p className={`planner-alert ${display.informational ? "info" : "warning"}`} key={warning}>
            {display.informational ? <Check size={15} /> : <AlertTriangle size={15} />}
            {display.message}
          </p>
        );
      })}

      <div className="proposal-block-heading">
        <div><h3>Draft calendar</h3></div>
        <button className="primary-button draft-add-button" type="button" onClick={() => addBlock()}><Plus size={17} /> Add draft block</button>
      </div>
      <DraftScheduleCalendar
        blocks={draft.blocks}
        horizonEnd={draft.horizon_end}
        horizonStart={draft.horizon_start}
        proposalId={draft.id}
        timezone={timezone}
        onAdd={addBlock}
        onDuplicate={duplicateBlock}
        onEdit={edit}
        onMoved={proposal.reload}
      />

      {draft.generation_summary.unscheduled.length ? (
        <div className="proposal-unresolved">
          <strong>Still unresolved</strong>
          {draft.generation_summary.unscheduled.map((item) => (
            <p key={item.id}>{item.name} · {formatMinutes(item.remaining_minutes)} — {item.reason}</p>
          ))}
        </div>
      ) : null}

      <ProposalTradeoffs summary={draft.generation_summary} />

      {error ? <p className="planner-alert error" role="alert">{error}</p> : null}
      <footer>
        {confirming ? (
          <div className="proposal-confirm" role="alert">
            <span>Replace the accepted schedule with this reviewed draft?</span>
            <button type="button" onClick={() => setConfirming(false)}>Cancel</button>
            <button className="primary-button" disabled={busy} type="button" onClick={() => void accept()}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
              Confirm acceptance
            </button>
          </div>
        ) : (
          <>
            <button className="danger-button" disabled={busy} type="button" onClick={() => { setRevisionError(null); setRevisionOpen(true); }}><X size={16} /> Reject and revise</button>
            <button className="primary-button" disabled={busy || draft.stale} type="button" onClick={() => setConfirming(true)}><Check size={16} /> Accept draft</button>
          </>
        )}
      </footer>

      <ScheduleBlockEditor
        open={editorOpen}
        semesterId={semester.id}
        proposalId={draft.id}
        date={editorDate}
        tasks={tasks}
        entry={selectedEntry}
        duplicateOf={duplicateEntry}
        suggestedTask={null}
        onClose={() => { setEditorOpen(false); setDuplicateEntry(null); }}
        onSaved={proposal.reload}
      />
      {revisionOpen ? (
        <ScheduleRevisionDialog
          busy={busy}
          error={revisionError}
          open
          onClose={() => setRevisionOpen(false)}
          onSubmit={revise}
        />
      ) : null}
    </section>
  );
}

function blockEntry(block: ScheduleBlock): PlanningEntry {
  return {
    id: `proposal:${block.id}`,
    kind: "scheduled_block",
    source_id: block.id,
    title: block.title,
    start_at: block.start_at,
    end_at: block.end_at,
    block_type: block.block_type,
    category: block.block_type,
    location: null,
    task_id: block.task_id,
    task_status: null,
    goal_id: block.goal_id,
    course_code: null,
    locked: block.locked,
    recurring: false,
    editable: true,
  };
}

function firstFocusDate(
  startDate: string,
  endDate: string,
  availability: AvailabilityWindow[],
) {
  const availableDays = new Set(
    availability
      .filter((window) => window.type !== "unavailable")
      .map((window) => window.day_of_week),
  );
  for (let offset = 0; offset <= dateDifference(startDate, endDate); offset += 1) {
    const candidate = addDays(startDate, offset);
    const weekdayIndex = (new Date(`${candidate}T12:00:00Z`).getUTCDay() + 6) % 7;
    if (availableDays.has(weekdayIndex)) return candidate;
  }
  return startDate;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function proposalWarningDisplay(
  warning: string,
  summary: ScheduleProposal["generation_summary"],
) {
  if (!summary.timed_out || !solverTimeoutWarnings.has(warning)) {
    return { informational: false, message: warning };
  }
  const complete = summary.coverage_status === "complete" && summary.unscheduled.length === 0;
  return {
    informational: complete,
    message: complete ? completeSolverTimeoutWarning : partialSolverTimeoutWarning,
  };
}

function ProposalTradeoffs({ summary }: { summary: ScheduleProposal["generation_summary"] }) {
  const details = [
    ...summary.exam_preparation.map((item) => `${String(item.name)} · ${formatMinutes(Number(item.scheduled_prep_minutes ?? 0))} of ${formatMinutes(Number(item.total_estimate_minutes ?? 0))} scheduled · ${String(item.estimate_source).replaceAll("_", " ")}`),
    ...summary.flexible_adjustments.map((item) => `${String(item.name)} · reduced by ${formatMinutes(Number(item.reduced_minutes ?? 0))}`),
    ...summary.rollover_by_day.filter((item) => Number(item.consumed_minutes ?? 0) > 0).map((item) => `${String(item.date)} · used ${formatMinutes(Number(item.consumed_minutes))} of rollover buffer`),
    ...summary.extra_focus_by_day.map((item) => `${String(item.date)} · ${formatMinutes(Number(item.used_minutes ?? 0))} extra focus`),
    ...summary.sleep_by_day.filter((item) => Number(item.reduction_minutes ?? 0) > 0).map((item) => `${String(item.date)} · sleep reduced by ${formatMinutes(Number(item.reduction_minutes))}, staying at or above the minimum`),
  ];
  if (!details.length) return null;
  return <div className="proposal-unresolved"><strong>How this draft made room</strong>{details.map((detail) => <p key={detail}>{detail}</p>)}</div>;
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
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
  const formatter = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${formatter.format(new Date(`${start}T12:00:00Z`))}–${formatter.format(new Date(`${end}T12:00:00Z`))}`;
}

function dateInTimezone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateDifference(start: string, end: string) {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
