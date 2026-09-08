"use client";

import {
  CalendarClock,
  Flag,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { CommitmentDialog } from "@/components/my-life/commitment-dialog";
import { PersonalGoalDialog } from "@/components/my-life/personal-goal-dialog";
import { useApiResource } from "@/hooks/use-api-resource";
import { apiRequest, ApiRequestError } from "@/lib/api";
import {
  capitalize,
  describeFixedCommitment,
  describeFlexibleCommitment,
  describePersonalGoal,
  isCommitmentEvent,
  parseWeeklyRecurrence,
  todayInTimezone,
} from "@/lib/commitments";
import type { FixedEvent, Goal, Semester, User } from "@/lib/types";

type StatusFilter = "active" | "paused" | "completed" | "ended" | "all";

const STATUS_FILTERS: [StatusFilter, string][] = [
  ["active", "Active"],
  ["paused", "Paused"],
  ["completed", "Completed"],
  ["ended", "Ended"],
  ["all", "All"],
];

function fixedEventEnded(event: FixedEvent, today: string): boolean {
  const recurrence = parseWeeklyRecurrence(event.recurrence_rule);
  if (recurrence) return recurrence.until !== null && recurrence.until < today;
  return event.end_at.slice(0, 10) < today;
}

type EditTarget =
  | { kind: "fixed"; event: FixedEvent }
  | { kind: "flexible"; goal: Goal }
  | null;

export function CommitmentsPanel() {
  const user = useApiResource<User>("/auth/me");
  const semesters = useApiResource<Semester[]>("/semesters");
  const events = useApiResource<FixedEvent[]>("/events");
  const goals = useApiResource<Goal[]>("/goals");

  const [filter, setFilter] = useState<StatusFilter>("active");
  const [commitmentDialog, setCommitmentDialog] = useState<{ editing: EditTarget } | null>(null);
  const [goalDialog, setGoalDialog] = useState<{ editing: Goal | null } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const timezone = user.data?.timezone ?? "UTC";
  const today = todayInTimezone(timezone);
  const activeSemester =
    semesters.data?.find((semester) => semester.status === "active") ?? semesters.data?.[0] ?? null;

  const loading = events.loading || goals.loading || user.loading;
  const error = events.error ?? goals.error ?? user.error;

  async function refresh() {
    await Promise.all([events.reload(), goals.reload()]);
    window.dispatchEvent(new Event("donext:planning-updated"));
  }

  const fixedCommitments = useMemo(
    () => (events.data ?? []).filter(isCommitmentEvent),
    [events.data],
  );
  const flexibleCommitments = useMemo(
    () => (goals.data ?? []).filter((goal) => goal.planning_kind === "flexible_commitment"),
    [goals.data],
  );
  const personalGoals = useMemo(
    () => (goals.data ?? []).filter((goal) => goal.planning_kind === "goal"),
    [goals.data],
  );

  const visibleFixed = fixedCommitments.filter((event) => {
    const ended = fixedEventEnded(event, today);
    if (filter === "all") return true;
    if (filter === "ended") return ended;
    if (filter === "active") return !ended;
    return false; // paused / completed do not apply to fixed events
  });

  function goalMatchesFilter(goal: Goal): boolean {
    if (filter === "all") return true;
    if (filter === "active") return goal.status === "active";
    if (filter === "paused") return goal.status === "paused";
    if (filter === "completed") return goal.status === "completed" || goal.status === "archived";
    return false;
  }

  const visibleFlexible = flexibleCommitments.filter(goalMatchesFilter);
  const visibleGoals = personalGoals.filter(goalMatchesFilter);

  async function run(id: string, task: () => Promise<void>) {
    setActionError(null);
    setPendingId(id);
    try {
      await task();
      await refresh();
    } catch (requestError) {
      setActionError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : "Could not complete that change.",
      );
    } finally {
      setPendingId(null);
    }
  }

  function removeEvent(event: FixedEvent) {
    if (!window.confirm(`Remove “${event.title}” from your commitments?`)) return;
    void run(event.id, () => apiRequest<void>(`/events/${event.id}`, { method: "DELETE" }));
  }

  function removeGoal(goal: Goal, noun: string) {
    if (!window.confirm(`Remove “${goal.name}” from your ${noun}?`)) return;
    void run(goal.id, () => apiRequest<void>(`/goals/${goal.id}`, { method: "DELETE" }));
  }

  function toggleGoal(goal: Goal) {
    const action = goal.status === "paused" ? "resume" : "pause";
    void run(goal.id, () =>
      apiRequest<Goal>(`/goals/${goal.id}/${action}`, { method: "POST" }).then(() => undefined),
    );
  }

  if (loading && !events.data && !goals.data) {
    return (
      <div className="page-status" role="status">
        <LoaderCircle className="spin" size={20} />
        <span>Loading your commitments</span>
      </div>
    );
  }

  if (error) {
    return (
      <section className="empty-state error-state">
        <h2>DoNext couldn&rsquo;t load your commitments.</h2>
        <p>{error}</p>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            void events.reload();
            void goals.reload();
          }}
        >
          Try again
        </button>
      </section>
    );
  }

  const nothingSaved =
    fixedCommitments.length === 0 && flexibleCommitments.length === 0 && personalGoals.length === 0;

  return (
    <div className="my-life-panel">
      <div className="my-life-panel-actions">
        <label className="status-filter">
          <span>Show</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value as StatusFilter)}
          >
            {STATUS_FILTERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="my-life-panel-buttons">
          <button
            className="secondary-button"
            type="button"
            onClick={() => setGoalDialog({ editing: null })}
          >
            <Flag size={16} /> Add personal goal
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => setCommitmentDialog({ editing: null })}
          >
            <Plus size={16} /> Add commitment
          </button>
        </div>
      </div>

      {actionError ? (
        <p className="page-alert" role="alert">
          {actionError}
        </p>
      ) : null}

      {nothingSaved ? (
        <section className="empty-state">
          <span>
            <Sparkles size={24} />
          </span>
          <h2>Add what needs time outside classes.</h2>
          <p>Work shifts, the gym, appointments, and personal goals all live here.</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => setCommitmentDialog({ editing: null })}
          >
            <Plus size={17} /> Add your first commitment
          </button>
        </section>
      ) : null}

      <CommitmentGroup
        title="Fixed commitments"
        caption="Placed on your calendar at set times."
        count={visibleFixed.length}
        emptyLabel={fixedCommitments.length ? "None match this filter." : "No fixed commitments yet."}
      >
        {visibleFixed.map((event) => (
          <CommitmentRow
            key={event.id}
            icon={<CalendarClock size={18} />}
            name={event.title}
            detail={`${describeFixedCommitment(event, timezone)} · ${capitalize(event.priority)} priority`}
            pending={pendingId === event.id}
            onEdit={() => setCommitmentDialog({ editing: { kind: "fixed", event } })}
            onRemove={() => removeEvent(event)}
          />
        ))}
      </CommitmentGroup>

      <CommitmentGroup
        title="Flexible commitments"
        caption="A weekly time target DoNext fits into drafts."
        count={visibleFlexible.length}
        emptyLabel={
          flexibleCommitments.length ? "None match this filter." : "No flexible commitments yet."
        }
      >
        {visibleFlexible.map((goal) => (
          <CommitmentRow
            key={goal.id}
            icon={<Sparkles size={18} />}
            name={goal.name}
            detail={`${describeFlexibleCommitment(goal)} · ${capitalize(goal.priority)} priority${goal.status !== "active" ? ` · ${capitalize(goal.status)}` : ""}`}
            pending={pendingId === goal.id}
            paused={goal.status === "paused"}
            onEdit={() => setCommitmentDialog({ editing: { kind: "flexible", goal } })}
            onToggle={() => toggleGoal(goal)}
            onRemove={() => removeGoal(goal, "flexible commitments")}
          />
        ))}
      </CommitmentGroup>

      <CommitmentGroup
        title="Personal goals"
        caption="Steady progress DoNext protects, then shrinks to maintenance on heavy weeks."
        count={visibleGoals.length}
        emptyLabel={personalGoals.length ? "None match this filter." : "No personal goals yet."}
      >
        {visibleGoals.map((goal) => (
          <CommitmentRow
            key={goal.id}
            icon={<Flag size={18} />}
            name={goal.name}
            detail={`${describePersonalGoal(goal)} · ${capitalize(goal.priority)} priority${goal.status !== "active" ? ` · ${capitalize(goal.status)}` : ""}`}
            pending={pendingId === goal.id}
            paused={goal.status === "paused"}
            onEdit={() => setGoalDialog({ editing: goal })}
            onToggle={() => toggleGoal(goal)}
            onRemove={() => removeGoal(goal, "goals")}
          />
        ))}
      </CommitmentGroup>

      {commitmentDialog ? (
        <CommitmentDialog
          key={
            commitmentDialog.editing
              ? commitmentDialog.editing.kind === "fixed"
                ? commitmentDialog.editing.event.id
                : commitmentDialog.editing.goal.id
              : "new"
          }
          open
          onClose={() => setCommitmentDialog(null)}
          onSaved={refresh}
          timezone={timezone}
          semesterId={activeSemester?.id ?? null}
          semesterEndDate={activeSemester?.end_date ?? null}
          editing={commitmentDialog.editing}
        />
      ) : null}

      {goalDialog ? (
        <PersonalGoalDialog
          key={goalDialog.editing?.id ?? "new"}
          open
          onClose={() => setGoalDialog(null)}
          onSaved={refresh}
          timezone={timezone}
          semesterId={activeSemester?.id ?? null}
          editing={goalDialog.editing}
        />
      ) : null}
    </div>
  );
}

function CommitmentGroup({
  title,
  caption,
  count,
  emptyLabel,
  children,
}: {
  title: string;
  caption: string;
  count: number;
  emptyLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="commitment-group">
      <header>
        <div>
          <h2>{title}</h2>
          <p>{caption}</p>
        </div>
        <span className="commitment-count">{count}</span>
      </header>
      {count === 0 ? (
        <p className="commitment-group-empty">{emptyLabel}</p>
      ) : (
        <div className="commitment-rows">{children}</div>
      )}
    </section>
  );
}

function CommitmentRow({
  icon,
  name,
  detail,
  pending,
  paused = false,
  onEdit,
  onToggle,
  onRemove,
}: {
  icon: ReactNode;
  name: string;
  detail: string;
  pending: boolean;
  paused?: boolean;
  onEdit: () => void;
  onToggle?: () => void;
  onRemove: () => void;
}) {
  return (
    <article className={`commitment-row${paused ? " is-paused" : ""}`}>
      <span className="commitment-row-icon">{icon}</span>
      <div className="commitment-row-body">
        <strong>{name}</strong>
        <small>{detail}</small>
      </div>
      <div className="commitment-row-actions">
        {pending ? <LoaderCircle className="spin" size={16} /> : null}
        {onToggle ? (
          <button type="button" aria-label={paused ? `Resume ${name}` : `Pause ${name}`} onClick={onToggle}>
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
        ) : null}
        <button type="button" aria-label={`Edit ${name}`} onClick={onEdit}>
          <Pencil size={16} />
        </button>
        <button type="button" aria-label={`Remove ${name}`} onClick={onRemove}>
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}
