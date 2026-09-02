"use client";

import { ChevronDown, ChevronUp, Copy, Layers, LoaderCircle, Minus, Pencil, Plus, Trash2, X } from "lucide-react";

import { formatBlockTime, splitEventTitle } from "@/components/draft-calendar/lib";
import type { ScheduleBlock } from "@/lib/types";

type BlockInspectorProps = {
  block: ScheduleBlock;
  timezone: string;
  columns: number;
  columnIndex: number;
  gutterWidth: number;
  busy: boolean;
  confirmingDelete: boolean;
  onShiftStart: (minutes: number) => void;
  onShiftLength: (minutes: number) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onClose: () => void;
};

const PANEL_WIDTH = 258;

export function BlockInspector({
  block,
  timezone,
  columns,
  columnIndex,
  gutterWidth,
  busy,
  confirmingDelete,
  onShiftStart,
  onShiftLength,
  onEdit,
  onDuplicate,
  onDelete,
  onCancelDelete,
  onClose,
}: BlockInspectorProps) {
  const title = splitEventTitle(block.title);
  const minutes = Math.round(
    (new Date(block.end_at).getTime() - new Date(block.start_at).getTime()) / 60_000,
  );
  const displaced = displacedWork(block);
  const explanations = explanationLines(block, timezone);

  return (
    <aside
      aria-label={`Draft block: ${block.title}`}
      className="console-inspector"
      role="dialog"
      style={panelPosition(columns, columnIndex, gutterWidth)}
    >
      <header>
        <span className="console-inspector-tag">{title.eyebrow ?? "Draft block"}</span>
        <button aria-label="Close block details" type="button" onClick={onClose}><X size={15} /></button>
      </header>
      <h4>{title.label}</h4>
      <p className="console-inspector-when">{formatBlockTime(block, timezone)}</p>

      <div className="console-steps">
        <div>
          <p>Start</p>
          <span>
            {startClock(block.start_at, timezone)}
            <span>
              <button aria-label="Start 15 minutes earlier" disabled={busy} type="button" onClick={() => onShiftStart(-15)}><ChevronUp size={14} /></button>
              <button aria-label="Start 15 minutes later" disabled={busy} type="button" onClick={() => onShiftStart(15)}><ChevronDown size={14} /></button>
            </span>
          </span>
        </div>
        <div>
          <p>Length</p>
          <span>
            {formatLength(minutes)}
            <span>
              <button aria-label="15 minutes shorter" disabled={busy || minutes <= 15} type="button" onClick={() => onShiftLength(-15)}><Minus size={14} /></button>
              <button aria-label="15 minutes longer" disabled={busy} type="button" onClick={() => onShiftLength(15)}><Plus size={14} /></button>
            </span>
          </span>
        </div>
      </div>

      <div className="console-inspector-actions">
        {confirmingDelete ? (
          <>
            <button className="danger" disabled={busy} type="button" onClick={onDelete}>
              {busy ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />} Confirm delete
            </button>
            <button type="button" onClick={onCancelDelete}>Keep</button>
          </>
        ) : (
          <>
            <button disabled={busy} type="button" onClick={onEdit}><Pencil size={14} /> Edit</button>
            <button disabled={busy} type="button" onClick={onDuplicate}><Copy size={14} /> Duplicate</button>
            <button aria-label={`Delete ${block.title}`} className="danger icon" disabled={busy} type="button" onClick={onDelete}>
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>

      {displaced ? (
        <p className="console-inspector-displaced">
          <Layers aria-hidden="true" size={13} />
          <span>Took capacity from <strong>{displaced.title}</strong> — {displaced.short} still unscheduled.</span>
        </p>
      ) : null}

      {explanations.length ? (
        <div className="console-inspector-reasons">
          <strong>Why DoNext placed this here</strong>
          {explanations.map((explanation) => <p key={explanation}>{explanation}</p>)}
        </div>
      ) : null}

      <p className="console-inspector-hint">
        Drag the block, or nudge it with <kbd>↑</kbd><kbd>↓</kbd> and <kbd>←</kbd><kbd>→</kbd>.
        Nothing reaches your accepted plan until you approve this draft.
      </p>
    </aside>
  );
}

// Docked beside the selected column, flipped inward once that column is close to the right
// edge. Narrow spans have no room to sit beside anything, so the panel pins to the edge.
function panelPosition(columns: number, columnIndex: number, gutterWidth: number) {
  if (columns <= 2) return { right: "12px" };
  const flip = columnIndex >= columns - 2;
  const ratio = flip ? columnIndex / columns : (columnIndex + 1) / columns;
  const nudge = flip ? `- ${PANEL_WIDTH + 8}px` : "+ 8px";
  return { left: `calc(${gutterWidth}px + (100% - ${gutterWidth}px) * ${ratio} ${nudge})` };
}

// The scheduler records which lower-priority work lost capacity to this block. Showing it
// answers the last of the specification's explainability questions on the block itself.
function displacedWork(block: ScheduleBlock) {
  const details = block.reason_details;
  if (!details) return null;
  const title = details.displaced_title;
  const short = details.displaced_shortfall_minutes;
  if (typeof title !== "string" || typeof short !== "number") return null;
  return { title, short: formatLength(short) };
}

function explanationLines(block: ScheduleBlock, timezone: string) {
  const details = block.reason_details;
  if (!details || block.source !== "generated") return [];
  if (details.explanation_version !== 1) {
    return ["This block was generated by an earlier scheduler version; detailed placement evidence is unavailable."];
  }
  const lines: string[] = [];
  const priority = details.primary_priority_reason;
  if (typeof priority === "string") {
    lines.push(`Priority: ${priority.replaceAll("_", " ")}.`);
  }
  const deadline = details.due_at;
  const remaining = details.remaining_before_minutes;
  if (typeof deadline === "string" && typeof remaining === "number") {
    lines.push(`${formatLength(remaining)} remained before this block; due ${new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(deadline))}.`);
  }
  const readiness = details.readiness_at;
  if (typeof readiness === "string") {
    lines.push(`Course work was available from ${new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(readiness))}.`);
  }
  const materialRelease = details.material_release_at;
  if (typeof materialRelease === "string") {
    lines.push(`This preparation session unlocked after material released on ${new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(materialRelease))}.`);
  }
  const slack = details.slack_minutes;
  if (typeof slack === "number") {
    lines.push(slack >= 0 ? `${formatLength(slack)} of forecast slack remained.` : `Forecast demand exceeded pre-deadline capacity by ${formatLength(Math.abs(slack))}.`);
  }
  if (details.exam_relationship === "same_course_pre_exam") {
    lines.push("Finishing this work reduces risk before an approaching exam.");
  }
  const weightTie = details.weight_tie_result;
  if (weightTie === "higher_known_weight_preferred") {
    lines.push("Its higher confirmed grade weight broke a same-day deadline tie.");
  } else if (weightTie === "skipped_unknown_weight") {
    lines.push("Grade weight was not compared because one value is unknown; deadline risk decided.");
  } else if (weightTie === "higher_priority_band_overrode_weight") {
    lines.push("Deadline urgency took precedence over a same-day grade-weight difference.");
  }
  if (details.weight_percent === null) {
    lines.push("Grade weight is unknown and was not treated as zero.");
  }
  if (details.strategic_lead === true) {
    lines.push("An optimistic semester-capacity proof showed this work must start inside the current horizon.");
  }
  const selectedEnergy = details.energy_level;
  const requestedEnergy = details.requested_energy_level;
  if (typeof selectedEnergy === "string" && typeof requestedEnergy === "string") {
    lines.push(details.energy_matched === true
      ? `This ${selectedEnergy}-energy opening matches the work.`
      : `A ${selectedEnergy}-energy opening was used because a ${requestedEnergy}-energy match could not preserve higher scheduling priorities.`);
  }
  const source = details.capacity_source;
  if (typeof source === "string") {
    lines.push(`Capacity source: ${source.replaceAll("_", " ")}.`);
  }
  return lines;
}

function startClock(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).format(new Date(value));
}

function formatLength(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
