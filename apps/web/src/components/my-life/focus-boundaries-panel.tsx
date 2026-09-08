"use client";

import {
  BrainCircuit,
  CalendarDays,
  Check,
  Copy,
  LoaderCircle,
  MoonStar,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useApiResource } from "@/hooks/use-api-resource";
import { apiRequest, ApiRequestError } from "@/lib/api";
import {
  focusHoursFromWindows,
  validateFocusHours,
  WEEKDAYS,
} from "@/lib/commitments";
import type { FocusHoursDraft, FocusWindowDraft } from "@/lib/commitments";
import type { AvailabilityWindow, Preferences } from "@/lib/types";

type SaveState = "idle" | "saving" | "saved" | "error";

function useSaveState() {
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  return {
    state,
    message,
    reset: () => {
      setState("idle");
      setMessage(null);
    },
    async run(task: () => Promise<void>) {
      setState("saving");
      setMessage(null);
      try {
        await task();
        setState("saved");
        window.setTimeout(() => setState((current) => (current === "saved" ? "idle" : current)), 2400);
      } catch (error) {
        setState("error");
        setMessage(error instanceof ApiRequestError ? error.message : "Could not save this section.");
      }
    },
  };
}

export function FocusBoundariesPanel() {
  const preferences = useApiResource<Preferences>("/preferences");
  const availability = useApiResource<AvailabilityWindow[]>("/availability");

  if ((preferences.loading && !preferences.data) || (availability.loading && !availability.data)) {
    return (
      <div className="page-status" role="status">
        <LoaderCircle className="spin" size={20} />
        <span>Loading your boundaries</span>
      </div>
    );
  }
  if (preferences.error || availability.error) {
    return (
      <section className="empty-state error-state">
        <h2>DoNext couldn&rsquo;t load your boundaries.</h2>
        <p>{preferences.error ?? availability.error}</p>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            void preferences.reload();
            void availability.reload();
          }}
        >
          Try again
        </button>
      </section>
    );
  }
  if (!preferences.data || !availability.data) return null;

  return (
    <div className="my-life-panel">
      <FocusHoursSection
        windows={availability.data}
        onSaved={(next) => {
          availability.setData(next);
          window.dispatchEvent(new Event("donext:planning-updated"));
        }}
      />
      <FocusSessionsSection preferences={preferences.data} onSaved={preferences.setData} />
      <SleepSection preferences={preferences.data} onSaved={preferences.setData} />
      <ScheduleStabilitySection preferences={preferences.data} onSaved={preferences.setData} />
      <RememberedPreferencesSection
        preferences={preferences.data}
        onForget={() => {
          void preferences.reload();
          window.dispatchEvent(new Event("donext:planning-updated"));
        }}
      />
    </div>
  );
}

function Section({
  icon,
  title,
  description,
  children,
  footer,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="preference-section">
      <div className="preference-heading">
        <span>{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {children}
      {footer}
    </section>
  );
}

function SectionSave({
  dirty,
  save,
  label = "Save",
}: {
  dirty: boolean;
  save: ReturnType<typeof useSaveState>;
  label?: string;
}) {
  return (
    <div className="section-save">
      <span aria-live="polite">
        {save.state === "saving" ? (
          "Saving…"
        ) : save.state === "saved" ? (
          <>
            <Check size={14} /> Saved
          </>
        ) : save.state === "error" ? (
          <span className="section-save-error">{save.message}</span>
        ) : dirty ? (
          "Unsaved changes"
        ) : (
          "Up to date"
        )}
      </span>
      <button className="primary-button" type="submit" disabled={!dirty || save.state === "saving"}>
        {save.state === "saving" ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} {label}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Focus hours
// ---------------------------------------------------------------------------

function FocusHoursSection({
  windows,
  onSaved,
}: {
  windows: AvailabilityWindow[];
  onSaved: (next: AvailabilityWindow[]) => void;
}) {
  const baseline = useMemo(() => focusHoursFromWindows(windows), [windows]);
  const [draft, setDraft] = useState<FocusHoursDraft>(baseline);
  const [advanced, setAdvanced] = useState(
    windows.some((window) => window.type !== "available" || window.energy_level !== "medium"),
  );
  const [copyFrom, setCopyFrom] = useState<number | null>(null);
  const [copyTargets, setCopyTargets] = useState<number[]>([]);
  const save = useSaveState();

  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  function update(next: FocusHoursDraft) {
    setDraft(next);
    save.reset();
  }

  function setDay(day: number, dayWindows: FocusWindowDraft[]) {
    update({ ...draft, [day]: dayWindows });
  }

  function addWindow(day: number) {
    const existing = draft[day] ?? [];
    const start = existing.length ? existing[existing.length - 1].end : "09:00";
    setDay(day, [...existing, { start, end: "17:00", type: "available", energy: "medium" }]);
  }

  function applyCopy() {
    if (copyFrom === null) return;
    const source = draft[copyFrom] ?? [];
    const next = { ...draft };
    for (const target of copyTargets) {
      next[target] = source.map((window) => ({ ...window }));
    }
    update(next);
    setCopyFrom(null);
    setCopyTargets([]);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateFocusHours(draft);
    if (!result.ok) {
      save.run(() => Promise.reject(new ApiRequestError(result.message, 422)));
      return;
    }
    await save.run(async () => {
      const next = await apiRequest<AvailabilityWindow[]>("/availability", {
        method: "PUT",
        body: JSON.stringify({ windows: result.windows }),
      });
      onSaved(next);
    });
  }

  return (
    <form onSubmit={submit}>
      <Section
        icon={<CalendarDays size={20} />}
        title="Focus hours"
        description="The days and times DoNext may schedule flexible work."
      >
        <button
          type="button"
          className="link-button"
          onClick={() => setAdvanced((current) => !current)}
        >
          {advanced ? "Hide" : "Show"} window type and energy
        </button>
        <div className="focus-hours-grid">
          {WEEKDAYS.map((dayName, day) => {
            const dayWindows = draft[day] ?? [];
            return (
              <div className="focus-day-row" key={dayName}>
                <div className="focus-day-head">
                  <strong>{dayName}</strong>
                  {dayWindows.length === 0 ? <span className="focus-day-off">Day off</span> : null}
                  <div className="focus-day-head-actions">
                    <button type="button" onClick={() => addWindow(day)} aria-label={`Add a window on ${dayName}`}>
                      <Plus size={14} /> Window
                    </button>
                    {dayWindows.length ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCopyFrom(day);
                          setCopyTargets([]);
                        }}
                      >
                        <Copy size={14} /> Copy to days
                      </button>
                    ) : null}
                    {dayWindows.length ? (
                      <button
                        type="button"
                        onClick={() => setDay(day, [])}
                        aria-label={`Clear ${dayName}`}
                      >
                        <X size={14} /> Day off
                      </button>
                    ) : null}
                  </div>
                </div>

                {dayWindows.map((window, index) => (
                  <div className="focus-window-row" key={index}>
                    <input
                      type="time"
                      step="900"
                      value={window.start}
                      aria-label={`${dayName} window ${index + 1} start`}
                      onChange={(event) =>
                        setDay(
                          day,
                          dayWindows.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, start: event.currentTarget.value } : item,
                          ),
                        )
                      }
                    />
                    <span aria-hidden="true">–</span>
                    <input
                      type="time"
                      step="900"
                      value={window.end}
                      aria-label={`${dayName} window ${index + 1} end`}
                      onChange={(event) =>
                        setDay(
                          day,
                          dayWindows.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, end: event.currentTarget.value } : item,
                          ),
                        )
                      }
                    />
                    {advanced ? (
                      <>
                        <select
                          value={window.type}
                          aria-label={`${dayName} window ${index + 1} type`}
                          onChange={(event) =>
                            setDay(
                              day,
                              dayWindows.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, type: event.currentTarget.value as FocusWindowDraft["type"] }
                                  : item,
                              ),
                            )
                          }
                        >
                          <option value="available">Available</option>
                          <option value="preferred">Preferred</option>
                          <option value="unavailable">Unavailable</option>
                        </select>
                        <select
                          value={window.energy}
                          aria-label={`${dayName} window ${index + 1} energy`}
                          onChange={(event) =>
                            setDay(
                              day,
                              dayWindows.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, energy: event.currentTarget.value as FocusWindowDraft["energy"] }
                                  : item,
                              ),
                            )
                          }
                        >
                          <option value="high">High energy</option>
                          <option value="medium">Medium energy</option>
                          <option value="low">Low energy</option>
                        </select>
                      </>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Remove ${dayName} window ${index + 1}`}
                      onClick={() =>
                        setDay(
                          day,
                          dayWindows.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}

                {copyFrom === day ? (
                  <div className="focus-copy-panel">
                    <p>Copy {dayName}&rsquo;s windows to:</p>
                    <div className="focus-copy-days">
                      {WEEKDAYS.map((targetName, targetDay) =>
                        targetDay === day ? null : (
                          <label key={targetName}>
                            <input
                              type="checkbox"
                              checked={copyTargets.includes(targetDay)}
                              onChange={(event) =>
                                setCopyTargets((current) =>
                                  event.currentTarget.checked
                                    ? [...current, targetDay]
                                    : current.filter((value) => value !== targetDay),
                                )
                              }
                            />
                            <span>{targetName.slice(0, 3)}</span>
                          </label>
                        ),
                      )}
                    </div>
                    <div className="focus-copy-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setCopyFrom(null);
                          setCopyTargets([]);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={copyTargets.length === 0}
                        onClick={applyCopy}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="preference-help">
          Generated and dragged draft blocks stay inside these windows. Regenerate an existing draft
          after changing them. A window ending at 00:00 runs to midnight.
        </p>
        <SectionSave dirty={dirty} save={save} label="Save focus hours" />
      </Section>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 2. Focus sessions
// ---------------------------------------------------------------------------

function FocusSessionsSection({
  preferences,
  onSaved,
}: {
  preferences: Preferences;
  onSaved: (next: Preferences) => void;
}) {
  const [session, setSession] = useState(preferences.preferred_session_minutes);
  const [breakMinutes, setBreakMinutes] = useState(preferences.minimum_break_minutes);
  const [dailyMax, setDailyMax] = useState(preferences.maximum_daily_focus_minutes);
  const save = useSaveState();

  const dirty =
    session !== preferences.preferred_session_minutes ||
    breakMinutes !== preferences.minimum_break_minutes ||
    dailyMax !== preferences.maximum_daily_focus_minutes;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save.run(async () => {
      const next = await apiRequest<Preferences>("/preferences", {
        method: "PATCH",
        body: JSON.stringify({
          preferred_session_minutes: session,
          minimum_break_minutes: breakMinutes,
          maximum_daily_focus_minutes: dailyMax,
        }),
      });
      onSaved(next);
      window.dispatchEvent(new Event("donext:planning-updated"));
    });
  }

  return (
    <form onSubmit={submit}>
      <Section
        icon={<BrainCircuit size={20} />}
        title="Focus sessions"
        description="Shape sessions around how you can actually concentrate."
      >
        <div className="form-row">
          <label>
            <span>Preferred session</span>
            <select value={session} onChange={(event) => setSession(Number(event.currentTarget.value))}>
              {[25, 40, 45, 50, 60, 75, 90].map((value) => (
                <option key={value} value={value}>
                  {value} minutes
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Minimum break</span>
            <select
              value={breakMinutes}
              onChange={(event) => setBreakMinutes(Number(event.currentTarget.value))}
            >
              {[5, 10, 15, 20, 30].map((value) => (
                <option key={value} value={value}>
                  {value} minutes
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          <span>Maximum focus per day</span>
          <select value={dailyMax} onChange={(event) => setDailyMax(Number(event.currentTarget.value))}>
            {[180, 240, 300, 360, 420, 480, 600].map((value) => (
              <option key={value} value={value}>
                {value / 60} hours
              </option>
            ))}
          </select>
        </label>
        <SectionSave dirty={dirty} save={save} label="Save focus sessions" />
      </Section>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 3. Sleep
// ---------------------------------------------------------------------------

function SleepSection({
  preferences,
  onSaved,
}: {
  preferences: Preferences;
  onSaved: (next: Preferences) => void;
}) {
  const [bedtime, setBedtime] = useState(preferences.default_sleep_time.slice(0, 5));
  const [wake, setWake] = useState(preferences.default_wake_time.slice(0, 5));
  const [minimumHours, setMinimumHours] = useState(preferences.minimum_sleep_minutes / 60);
  const save = useSaveState();

  const dirty =
    bedtime !== preferences.default_sleep_time.slice(0, 5) ||
    wake !== preferences.default_wake_time.slice(0, 5) ||
    minimumHours !== preferences.minimum_sleep_minutes / 60;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save.run(async () => {
      const next = await apiRequest<Preferences>("/preferences", {
        method: "PATCH",
        body: JSON.stringify({
          default_sleep_time: bedtime,
          default_wake_time: wake,
          minimum_sleep_minutes: Math.round(minimumHours * 60),
        }),
      });
      onSaved(next);
      window.dispatchEvent(new Event("donext:planning-updated"));
    });
  }

  return (
    <form onSubmit={submit}>
      <Section
        icon={<MoonStar size={20} />}
        title="Sleep"
        description="Sleep is a hard planning boundary, not spare capacity."
      >
        <div className="form-row">
          <label>
            <span>Typical bedtime</span>
            <input
              type="time"
              value={bedtime}
              step="300"
              onChange={(event) => setBedtime(event.currentTarget.value)}
              required
            />
          </label>
          <label>
            <span>Typical wake time</span>
            <input
              type="time"
              value={wake}
              step="300"
              onChange={(event) => setWake(event.currentTarget.value)}
              required
            />
          </label>
        </div>
        <label>
          <span>Minimum sleep</span>
          <select
            value={minimumHours}
            onChange={(event) => setMinimumHours(Number(event.currentTarget.value))}
          >
            {[6, 6.5, 7, 7.5, 8, 8.5, 9].map((value) => (
              <option key={value} value={value}>
                {value} hours
              </option>
            ))}
          </select>
        </label>
        <SectionSave dirty={dirty} save={save} label="Save sleep" />
      </Section>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 4. Schedule stability
// ---------------------------------------------------------------------------

function ScheduleStabilitySection({
  preferences,
  onSaved,
}: {
  preferences: Preferences;
  onSaved: (next: Preferences) => void;
}) {
  const [freezeHours, setFreezeHours] = useState(preferences.freeze_window_minutes / 60);
  const save = useSaveState();
  const dirty = freezeHours !== preferences.freeze_window_minutes / 60;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save.run(async () => {
      const next = await apiRequest<Preferences>("/preferences", {
        method: "PATCH",
        body: JSON.stringify({ freeze_window_minutes: Math.round(freezeHours * 60) }),
      });
      onSaved(next);
      window.dispatchEvent(new Event("donext:planning-updated"));
    });
  }

  return (
    <form onSubmit={submit}>
      <Section
        icon={<ShieldCheck size={20} />}
        title="Schedule stability"
        description="Keep near-term commitments stable and preserve breathing room."
      >
        <label>
          <span>Freeze window</span>
          <select
            value={freezeHours}
            onChange={(event) => setFreezeHours(Number(event.currentTarget.value))}
          >
            <option value={0}>No freeze window</option>
            {[1, 2, 4, 6, 12, 24].map((value) => (
              <option key={value} value={value}>
                {value} hour{value === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        <p className="preference-help">
          DoNext keeps a one-hour rollover buffer each day. Only overdue work, or work due within 48
          hours, may use it automatically.
        </p>
        <SectionSave dirty={dirty} save={save} label="Save stability" />
      </Section>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 5. Remembered preferences
// ---------------------------------------------------------------------------

function RememberedPreferencesSection({
  preferences,
  onForget,
}: {
  preferences: Preferences;
  onForget: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remembered = preferences.remembered_schedule_preferences;

  async function forget() {
    setBusy(true);
    setError(null);
    try {
      await apiRequest<void>("/preferences/remembered-schedule-preferences", { method: "DELETE" });
      onForget();
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : "Could not clear remembered preferences.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      icon={<Sparkles size={20} />}
      title="Remembered preferences"
      description="Standing rules a “remember this” schedule revision left in place."
    >
      {remembered.length === 0 ? (
        <p className="preference-help">
          Nothing remembered. When you accept a revision and ask DoNext to remember it, it appears
          here.
        </p>
      ) : (
        <>
          <ul className="remembered-list">
            {remembered.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void forget()}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />} Forget these
          </button>
        </>
      )}
    </Section>
  );
}
