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
