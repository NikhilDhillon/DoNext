"use client";

import { Check, LoaderCircle, Pause, Play, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { formatMinutes } from "@/lib/today";
import type { PlannerTask, PlanningCapacity, PlanningEntry, WorkTimer } from "@/lib/types";

export function NowCard({
  entries,
  timezone,
  timer,
  timerTitle,
  deadline,
  capacity,
  loggedMinutes,
  unbookedDeadlines,
  warnings,
  busy,
  onStart,
  onStop,
  onDone,
  onDiscard,
}: {
  entries: PlanningEntry[];
  timezone: string;
  timer: WorkTimer | null;
  timerTitle?: string;
  deadline: PlannerTask | null;
  capacity: PlanningCapacity | undefined;
  loggedMinutes: number;
  unbookedDeadlines: number;
  warnings: string[];
  busy: boolean;
  onStart: (entry: PlanningEntry) => Promise<void>;
  onStop: () => Promise<void>;
  onDone: () => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timer) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [timer]);

  const currentCommitment = entries.find(
    (entry) =>
      (entry.kind === "fixed_event" || entry.block_type === "commitment") &&
      new Date(entry.start_at).getTime() <= now &&
      new Date(entry.end_at).getTime() > now,
  );
  const activeEntry = timer
    ? entries.find((entry) => timer.block_fingerprint !== null && entry.block_fingerprint === timer.block_fingerprint) ??
      entries.find((entry) => entry.task_id === timer.task_id)
    : null;
  const nextFocus =
    activeEntry ??
    entries.find(
      (entry) =>
        Boolean(entry.task_id) &&
        new Date(entry.end_at).getTime() > now &&
        entry.check_in_outcome !== "finished",
    ) ??
    null;
  const elapsed = timer ? Math.max(Math.floor((now - new Date(timer.started_at).getTime()) / 1000), 0) : 0;
  const tickable = entries.filter((entry) => entry.task_id || entry.goal_id);
  const done = tickable.filter((entry) => entry.check_in_outcome === "finished").length;
  const planned = Math.max(
    entries.reduce(
      (minutes, entry) => minutes + (entry.task_id ? entry.planned_minutes : 0),
      0,
    ),
    1,
  );
  const workedPercent = Math.min(Math.round((loggedMinutes / planned) * 100), 100);

  return (
    <section className="today-now-grid" aria-label="Current work and today’s progress">
      <div className="now-card">
        <div className="now-card-mark"><Sparkles size={21} /></div>
        <div className="now-card-copy">
          <p>{timer ? "Running now" : "Right now"}</p>
          <h2>{timer ? activeEntry?.title ?? timerTitle ?? "Current work" : nextFocus?.title ?? deadline?.name ?? "No focus block is waiting"}</h2>
          {timer ? (
            <strong className="timer-readout" aria-live="polite">{formatElapsed(elapsed)}</strong>
          ) : (
            <span>
              {nextFocus
                ? `${formatMinutes(nextFocus.planned_minutes)} planned`
                : deadline
                  ? `${formatMinutes(deadline.remaining_minutes)} left · next unbooked deadline`
                  : "Your next choice is open."}
            </span>
          )}
          {currentCommitment ? <small>Inside {currentCommitment.title} until {timeOnly(currentCommitment.end_at, timezone)}</small> : null}
        </div>
        <div className="now-actions">
          {timer ? (
            <>
              <button className="now-secondary" disabled={busy} type="button" onClick={() => void onStop()}>
                {busy ? <LoaderCircle className="spin" size={16} /> : <Pause size={16} />} Stop & log
              </button>
              <button className="now-primary" disabled={busy} type="button" onClick={() => void onDone()}>
                <Check size={16} /> Done
              </button>
              <button className="now-discard" disabled={busy} type="button" onClick={() => void onDiscard()}>
                <RotateCcw size={14} /> Discard timer
              </button>
            </>
          ) : nextFocus?.task_id ? (
            <button className="now-primary" disabled={busy} type="button" onClick={() => void onStart(nextFocus)}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />} Start timer
            </button>
          ) : null}
        </div>
      </div>

      <div className="today-counter">
        <div className="today-counter-top"><span>Today</span><strong>{done} of {tickable.length}</strong></div>
        <div className="today-dots" aria-label={`${done} of ${tickable.length} checkable blocks finished`}>
          {tickable.map((entry) => <i className={entry.check_in_outcome === "finished" ? "done" : ""} key={entry.id} />)}
        </div>
        <strong>{formatMinutes(loggedMinutes)} logged</strong>
        <div className="today-progress"><span style={{ width: `${workedPercent}%` }} /></div>
        <small>{workedPercent}% of planned focus worked · {formatMinutes(capacity?.remaining_focus_minutes ?? 0)} still open</small>
        <span className={unbookedDeadlines ? "capacity-honesty warning" : "capacity-honesty calm"}>
          {unbookedDeadlines ? `${unbookedDeadlines} ${unbookedDeadlines === 1 ? "deadline" : "deadlines"} without time` : "All known deadlines have an answer"}
        </span>
        {warnings.map((warning) => <p className="today-capacity-warning" key={warning}>{warning}</p>)}
      </div>
    </section>
  );
}

function formatElapsed(seconds: number) {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
}

function timeOnly(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}
