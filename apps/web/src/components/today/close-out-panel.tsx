"use client";

import { CheckCheck, ClockAlert, LoaderCircle } from "lucide-react";

import { formatMinutes, formatTime, isPast, isTickable } from "@/lib/today";
import type { PlanningEntry } from "@/lib/types";

export function CloseOutPanel({
  entries,
  timezone,
  busy,
  onLog,
  onLogAll,
}: {
  entries: PlanningEntry[];
  timezone: string;
  busy: boolean;
  onLog: (entry: PlanningEntry) => void;
  onLogAll: (entries: PlanningEntry[]) => Promise<void>;
}) {
  const unanswered = entries.filter(
    (entry) => isTickable(entry) && isPast(entry) && !entry.check_in_outcome,
  );
  if (!unanswered.length) return null;
  return (
    <section className="close-out-panel" aria-labelledby="close-out-title">
      <header>
        <span><ClockAlert size={19} /></span>
        <div><p className="eyebrow">Close out today</p><h2 id="close-out-title">What happened in these blocks?</h2></div>
        <button className="secondary-button" disabled={busy} type="button" onClick={() => void onLogAll(unanswered)}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <CheckCheck size={16} />} Mark all as planned
        </button>
      </header>
      <ul>
        {unanswered.map((entry) => (
          <li key={entry.id}>
            <button disabled={busy} type="button" onClick={() => onLog(entry)}>
              <span>{formatTime(entry.start_at, timezone)}</span>
              <strong>{entry.title}</strong>
              <small>{formatMinutes(entry.planned_minutes)} planned</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
