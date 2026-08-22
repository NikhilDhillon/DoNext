"use client";

import {
  AlertTriangle,
  CalendarClock,
  Check,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";

import { DraftScheduleCalendar } from "@/components/draft-schedule-calendar";
import { ScheduleBlockEditor } from "@/components/schedule-block-editor";
import { useApiResource } from "@/hooks/use-api-resource";
import { apiRequest, ApiRequestError } from "@/lib/api";
import type {
  AvailabilityWindow,
  PlannerTask,
  PlanningEntry,
  ScheduleBlock,
  ScheduleProposal,
  Semester,
} from "@/lib/types";

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
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"accept" | "reject" | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<PlanningEntry | null>(null);
  const [editorDate, setEditorDate] = useState(semester.start_date);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      proposal.setData(
        await apiRequest<ScheduleProposal>(
          `/semesters/${semester.id}/schedule/proposals`,
          { method: "POST" },
        ),
      );
    } catch (requestError) {
      setError(errorMessage(requestError, "DoNext could not generate a schedule draft."));
    } finally {
      setBusy(false);
    }
  }

  async function finish(action: "accept" | "reject") {
    if (!proposal.data) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest<ScheduleProposal | void>(
        `/schedule-proposals/${proposal.data.id}/${action}`,
        { method: "POST" },
      );
      proposal.setData(null);
      setConfirming(null);
      if (action === "accept") await onAccepted();
    } catch (requestError) {
      setError(errorMessage(requestError, `DoNext could not ${action} this draft.`));
    } finally {
      setBusy(false);
    }
  }

  function edit(block: ScheduleBlock) {
    setSelectedEntry(blockEntry(block));
    setEditorDate(dateInTimezone(block.start_at, timezone));
    setEditorOpen(true);
  }

  function addBlock(date?: string) {
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

  if (proposal.loading && !proposal.data) {
    return <section className="proposal-review loading"><LoaderCircle className="spin" size={20} /> Checking for a draft</section>;
  }

  if (!proposal.data) {
    return (
      <section className="proposal-launch">
        <span><Sparkles size={22} /></span>
        <div>
          <p className="eyebrow">Deterministic planning</p>
          <h2>Build a reviewable 14-day draft.</h2>
          <p>Your accepted plan stays untouched until you explicitly approve the complete draft.</p>
        </div>
        <button className="primary-button" disabled={busy} type="button" onClick={() => void generate()}>
          {busy ? <LoaderCircle className="spin" size={17} /> : <CalendarClock size={17} />}
          {busy ? "Building draft" : "Generate 14-day plan"}
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
          <p>The accepted calendar remains below. These blocks are a separate editable version.</p>
        </div>
        <button className="secondary-button" disabled={busy} type="button" onClick={() => void generate()}>
          <RefreshCw size={16} /> Regenerate
        </button>
      </header>

      <div className="proposal-metrics">
        <div><strong>{formatMinutes(draft.generation_summary.scheduled_minutes)}</strong><span>scheduled</span></div>
        <div><strong>{draft.generation_summary.generated_blocks}</strong><span>generated blocks</span></div>
        <div><strong>{draft.generation_summary.preserved_blocks}</strong><span>preserved blocks</span></div>
        <div><strong>{draft.generation_summary.moved_blocks}</strong><span>review edits</span></div>
      </div>

      {draft.stale ? (
        <p className="planner-alert error"><AlertTriangle size={15} /> Inputs changed. Regenerate before accepting.</p>
      ) : null}
      {draft.generation_summary.warnings.map((warning) => (
        <p className="planner-alert warning" key={warning}><AlertTriangle size={15} /> {warning}</p>
      ))}

      <div className="proposal-block-heading">
        <div><h3>Draft calendar</h3><p>Classes and fixed commitments are shown for context. Drag a generated block to move it, select it to edit details, or click an open day to add one.</p></div>
        <button className="text-button" type="button" onClick={() => addBlock()}>Add draft block</button>
      </div>
      <DraftScheduleCalendar
        blocks={draft.blocks}
        horizonEnd={draft.horizon_end}
        horizonStart={draft.horizon_start}
        proposalId={draft.id}
        timezone={timezone}
        onAdd={addBlock}
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

      {error ? <p className="planner-alert error" role="alert">{error}</p> : null}
      <footer>
        {confirming ? (
          <div className="proposal-confirm" role="alert">
            <span>{confirming === "accept" ? "Replace the accepted schedule with this complete draft?" : "Discard this draft without changing the accepted schedule?"}</span>
            <button type="button" onClick={() => setConfirming(null)}>Cancel</button>
            <button className={confirming === "accept" ? "primary-button" : "danger-button"} disabled={busy} type="button" onClick={() => void finish(confirming)}>
              {busy ? <LoaderCircle className="spin" size={16} /> : confirming === "accept" ? <Check size={16} /> : <X size={16} />}
              Confirm {confirming}
            </button>
          </div>
        ) : (
          <>
            <button className="danger-button" disabled={busy} type="button" onClick={() => setConfirming("reject")}><X size={16} /> Reject draft</button>
            <button className="primary-button" disabled={busy || draft.stale} type="button" onClick={() => setConfirming("accept")}><Check size={16} /> Accept complete draft</button>
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
        suggestedTask={null}
        onClose={() => setEditorOpen(false)}
        onSaved={proposal.reload}
      />
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
  return error instanceof ApiRequestError ? error.message : fallback;
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
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
