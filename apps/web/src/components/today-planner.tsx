"use client";

import { ArrowRight, Clock3, LoaderCircle, Plus, Sparkles, Undo2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ScheduleBlockEditor } from "@/components/schedule-block-editor";
import { AttentionPanel } from "@/components/today/attention-panel";
import { CloseOutPanel } from "@/components/today/close-out-panel";
import { DayChecklist } from "@/components/today/day-checklist";
import { LogSessionDialog } from "@/components/today/log-session-dialog";
import { NowCard } from "@/components/today/now-card";
import { ProgressPanel } from "@/components/today/progress-panel";
import { useApiResource } from "@/hooks/use-api-resource";
import { apiRequest, ApiRequestError } from "@/lib/api";
import { dayPart, formatFullDate, headerSummary, highestPriorityTask, timerCheckEntry } from "@/lib/today";
import type {
  ActivationPrompt,
  PlannerTask,
  PlanningEntry,
  PlanningView,
  RolloverResult,
  Schedule,
  ScheduleBlock,
  ScheduleProposal,
  Semester,
  User,
  WorkOutcome,
  WorkSession,
  WorkTimer,
} from "@/lib/types";

export function TodayPlanner() {
  const user = useApiResource<User>("/auth/me");
  const semesters = useApiResource<Semester[]>("/semesters");
  const plan = useApiResource<PlanningView>("/planning/day");
  const currentSemester = useMemo(
    () =>
      semesters.data?.find((semester) => semester.status === "active") ??
      semesters.data?.[0] ??
      null,
    [semesters.data],
  );
  const proposal = useApiResource<ScheduleProposal>(
    currentSemester ? `/semesters/${currentSemester.id}/schedule/proposal` : null,
  );
  const accepted = useApiResource<Schedule | null>(
    currentSemester ? `/semesters/${currentSemester.id}/schedule` : null,
  );
  const activationQueue = useApiResource<ActivationPrompt[]>(
    currentSemester ? `/semesters/${currentSemester.id}/activation-queue` : null,
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<PlanningEntry | null>(null);
  const [suggestedTask, setSuggestedTask] = useState<PlannerTask | null>(null);
  const [checkEntry, setCheckEntry] = useState<PlanningEntry | null>(null);
  const [timerCheckMinutes, setTimerCheckMinutes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [rolloverBlocks, setRolloverBlocks] = useState<ScheduleBlock[]>([]);

  const loading = user.loading || semesters.loading || plan.loading;
  if (loading && !plan.data) return <PlannerLoading label="Building today from your real plan" />;
  if (plan.error || user.error || semesters.error) {
    return (
      <PlannerError
        message={plan.error || user.error || semesters.error || "DoNext could not load today."}
        onRetry={plan.reload}
      />
    );
  }
  if (!plan.data) return <PlannerLoading label="Loading today" />;

  const data = plan.data;
  const capacity = data.days[0]?.capacity;
  const waitingPrompts = (activationQueue.data ?? []).filter((prompt) => !prompt.activated);
  const waitingTaskIds = new Set(waitingPrompts.map((prompt) => prompt.task_id));
  const firstName = user.data?.name.split(" ")[0] || "there";
  const allPlanningTasks = Array.from(
    new Map(
      [...data.deadlines, ...data.unscheduled_tasks, ...data.completed_tasks].map((task) => [
        task.id,
        task,
      ]),
    ).values(),
  );

  function openNew(task: PlannerTask | null = null) {
    setSelectedEntry(null);
    setSuggestedTask(task);
    setEditorOpen(true);
  }

  function openEntry(entry: PlanningEntry) {
    if (!entry.editable) return;
    setSelectedEntry(entry);
    setSuggestedTask(null);
    setEditorOpen(true);
  }

  function openCheckIn(entry: PlanningEntry) {
    setActionError(null);
    setTimerCheckMinutes(null);
    setCheckEntry(entry);
  }

  function openTimerCheckIn(entry?: PlanningEntry) {
    const timer = data.active_timer;
    if (!timer) return;
    setActionError(null);
    const activeEntry = entry ?? timerCheckEntry(timer, data.entries, allPlanningTasks);
    setTimerCheckMinutes(Math.max(Math.round((Date.now() - new Date(timer.started_at).getTime()) / 60000), 0));
    setCheckEntry(activeEntry);
  }

  async function refreshAll() {
    window.dispatchEvent(new Event("donext:planning-updated"));
    await Promise.all([
      plan.reload(),
      proposal.reload(),
      accepted.reload(),
      activationQueue.reload(),
    ]);
  }

  async function rollover() {
    if (!currentSemester) return null;
    try {
      const result = await apiRequest<RolloverResult>(
        `/semesters/${currentSemester.id}/schedule/rollover`,
        { method: "POST", body: JSON.stringify({ local_date: data.start_date }) },
      );
      if (result.outcome === "placed") {
        setRolloverBlocks(result.blocks);
        setActionNotice(result.reason);
      } else if (result.outcome === "draft_created") {
        setActionNotice("The remaining work needs a trade-off. A draft is ready for review.");
      }
      return result;
    } catch (error) {
      setActionError(`Your check-in was saved. ${errorMessage(error, "The remaining work could not be placed. Open Week to review it.")}`);
      return null;
    }
  }

  async function undoRollover() {
    await runAction(async () => {
      await Promise.all(rolloverBlocks.map(async (block) => {
        try { await apiRequest(`/schedule-blocks/${block.id}`, { method: "DELETE" }); }
        catch (error) { if (!(error instanceof ApiRequestError && error.status === 404)) throw error; }
      }));
      setRolloverBlocks([]);
      setActionNotice("The added rollover time was removed. Your check-ins are still saved.");
      await refreshAll();
    }, "DoNext could not remove all the added time. Open Week to review it.");
  }

  async function saveSession(entry: PlanningEntry, outcome: WorkOutcome, minutes: number) {
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await apiRequest<WorkSession>("/work-sessions", {
        method: "POST",
        body: JSON.stringify({
          task_id: entry.task_id,
          goal_id: entry.goal_id,
          scheduled_block_id: entry.source_id,
          local_date: data.start_date,
          minutes,
          outcome,
          source: "quick_confirm",
        }),
      });
      if (entry.task_id) await rollover();
      setCheckEntry(null);
      await refreshAll();
    } catch (error) {
      setActionError(errorMessage(error, "DoNext could not save that check-in."));
    } finally {
      setBusy(false);
    }
  }

  async function logAll(entries: PlanningEntry[]) {
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await Promise.all(
        entries.map((entry) =>
          apiRequest<WorkSession>("/work-sessions", {
            method: "POST",
            body: JSON.stringify({
              task_id: entry.task_id,
              goal_id: entry.goal_id,
              scheduled_block_id: entry.source_id,
              local_date: data.start_date,
              minutes: entry.planned_minutes,
              outcome: entry.task_id ? "still_going" : "finished",
              source: "quick_confirm",
            }),
          }),
        ),
      );
      if (entries.some((entry) => entry.task_id)) await rollover();
      setActionNotice(
        "Past blocks were marked as planned. Adjust academic work if the time was different.",
      );
      await refreshAll();
    } catch (error) {
      setActionError(errorMessage(error, "DoNext could not close out those blocks."));
    } finally {
      setBusy(false);
    }
  }

  async function startTimer(entry: PlanningEntry) {
    if (!entry.task_id) return;
    await runAction(async () => {
      await apiRequest<WorkTimer>("/work-timer", {
        method: "POST",
        body: JSON.stringify({ task_id: entry.task_id, scheduled_block_id: entry.source_id }),
      });
      await plan.reload();
    }, "DoNext could not start the timer.");
  }

  async function stopTimer(outcome: WorkOutcome, minutes?: number) {
    await runAction(async () => {
      await apiRequest<WorkSession>("/work-timer/stop", {
        method: "POST",
        body: JSON.stringify({ outcome, minutes }),
      });
      await rollover();
      setCheckEntry(null);
      setTimerCheckMinutes(null);
      await refreshAll();
    }, "DoNext could not stop the timer.");
  }

  async function discardTimer() {
    await runAction(async () => {
      await apiRequest("/work-timer", { method: "DELETE" });
      setActionNotice("Timer discarded. No time was logged.");
      await plan.reload();
    }, "DoNext could not discard the timer.");
  }

  async function undoSession(entry: PlanningEntry) {
    if (!entry.work_session_id) return;
    await runAction(async () => {
      await apiRequest(`/work-sessions/${entry.work_session_id}`, { method: "DELETE" });
      setActionNotice(entry.goal_id
        ? `${entry.title} marked incomplete.`
        : `${entry.title} is unanswered again.`);
      await refreshAll();
    }, "DoNext could not undo that check-in.");
  }

  function checkIn(entry: PlanningEntry) {
    if (entry.timer_running) {
      openTimerCheckIn(entry);
      return;
    }
    if (entry.task_id) {
      openCheckIn(entry);
      return;
    }
    if (!entry.goal_id) return;
    if (entry.check_in_outcome === "finished") {
      void undoSession(entry);
      return;
    }
    void saveSession(entry, "finished", entry.planned_minutes);
  }

  async function runAction(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await action();
    } catch (error) {
      setActionError(errorMessage(error, fallback));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-shell today-page">
      <header className="page-heading today-heading">
        <div>
          <p className="eyebrow">{formatFullDate(data.start_date)}</p>
          <h1>Good {dayPart(data.timezone)}, {firstName}.</h1>
          <p>{headerSummary(data, waitingPrompts.length)}</p>
        </div>
        <div className="heading-actions">
          <Link className="secondary-button" href="/week"><Clock3 size={18} /> View week</Link>
          <button className="primary-button" disabled={!currentSemester} type="button" onClick={() => openNew()}>
            <Plus size={17} /> Add block
          </button>
        </div>
      </header>

      {proposal.data ? (
        <Link className="proposal-pending-banner" href="/week">
          <Sparkles size={17} /><span><strong>A draft is waiting for review.</strong><small>Today still reflects your accepted schedule.</small></span><ArrowRight size={17} />
        </Link>
      ) : null}

      <NowCard
        busy={busy}
        capacity={capacity}
        deadline={highestPriorityTask(data.unscheduled_tasks.length ? data.unscheduled_tasks : data.deadlines)}
        entries={data.entries}
        loggedMinutes={data.logged_minutes}
        timer={data.active_timer}
        timerTitle={data.active_timer ? allPlanningTasks.find((task) => task.id === data.active_timer?.task_id)?.name : undefined}
        timezone={data.timezone}
        warnings={data.warnings}
        unbookedDeadlines={waitingPrompts.length}
        onDiscard={discardTimer}
        onDone={() => stopTimer("finished")}
        onStart={startTimer}
        onStop={() => { openTimerCheckIn(); return Promise.resolve(); }}
      />

      {actionError ? <p className="planner-alert error today-alert" role="alert">{actionError}</p> : null}
      {actionNotice || rolloverBlocks.length ? <div className="planner-alert info today-alert" role="status"><Sparkles size={15} /><span>{actionNotice || "Remaining work was added without moving your accepted plan."}</span>{rolloverBlocks.length ? <button disabled={busy} type="button" onClick={() => void undoRollover()}><Undo2 size={14} /> Undo added time</button> : null}</div> : null}

      <CloseOutPanel
        busy={busy}
        entries={data.entries}
        timezone={data.timezone}
        onLog={checkIn}
        onLogAll={logAll}
      />

      <DayChecklist
        busy={busy}
        entries={data.entries}
        nextEntryId={data.next_entry_id}
        timezone={data.timezone}
        onAdd={() => openNew()}
        onCheckIn={checkIn}
        onEdit={openEntry}
      />

      <div className="today-lower-grid">
        <ProgressPanel
          tasks={[...data.deadlines.filter((task) => !waitingTaskIds.has(task.id)), ...data.completed_tasks]}
          timezone={data.timezone}
          onPlan={openNew}
        />
        {currentSemester ? (
          <AttentionPanel
            prompts={activationQueue.data ?? []}
            semester={currentSemester}
            unscheduledTasks={data.unscheduled_tasks.filter((task) => !waitingTaskIds.has(task.id))}
            onChanged={refreshAll}
            onPlan={openNew}
          />
        ) : (
          <section className="attention-panel empty"><p className="planner-quiet">Accept a schedule to connect new work to today.</p></section>
        )}
      </div>

      {data.entries.some((entry) => entry.work_session_id) ? (
        <div className="today-undo-strip" aria-label="Recent check-ins">
          <span>Need to correct reality?</span>
          {data.entries.filter((entry) => entry.work_session_id).map((entry) => (
            <button disabled={busy} key={entry.id} type="button" onClick={() => void undoSession(entry)}>
              <Undo2 size={14} /> Undo {entry.title}
            </button>
          ))}
        </div>
      ) : null}

      <LogSessionDialog
        key={checkEntry ? `${checkEntry.id}:${checkEntry.work_session_id ?? "new"}:${timerCheckMinutes ?? "session"}` : "closed"}
        entry={checkEntry}
        open={Boolean(checkEntry)}
        saving={busy}
        saveError={actionError}
        initialMinutes={timerCheckMinutes ?? undefined}
        timer={timerCheckMinutes !== null}
        onClose={() => setCheckEntry(null)}
        onSave={(outcome, minutes) => timerCheckMinutes !== null ? stopTimer(outcome, minutes) : saveSession(checkEntry!, outcome, minutes)}
      />

      {currentSemester ? (
        <ScheduleBlockEditor
          date={data.start_date}
          entry={selectedEntry}
          open={editorOpen}
          semesterId={currentSemester.id}
          suggestedTask={suggestedTask}
          tasks={allPlanningTasks}
          onClose={() => setEditorOpen(false)}
          onSaved={refreshAll}
        />
      ) : null}
    </main>
  );
}

function PlannerLoading({ label }: { label: string }) {
  return <main className="page-shell planner-state"><LoaderCircle className="spin" size={26} /><h1>{label}</h1><p>DoNext is reading your saved commitments and work.</p></main>;
}

function PlannerError({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  return <main className="page-shell planner-state error"><h1>Today could not load.</h1><p>{message}</p><button className="primary-button" type="button" onClick={onRetry}>Try again</button></main>;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiRequestError ? error.message : fallback;
}
