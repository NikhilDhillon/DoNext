"use client";

import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  CalendarCheck,
  Check,
  CheckCircle2,
  Clock3,
  Dumbbell,
  FileText,
  Flag,
  GraduationCap,
  LoaderCircle,
  MoonStar,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { Brand } from "@/components/brand";
import { ClassScheduleStep } from "@/components/class-schedule-step";
import { CourseOutlineStep } from "@/components/course-outline-step";
import { useApiResource } from "@/hooks/use-api-resource";
import { apiRequest, ApiRequestError } from "@/lib/api";
import type {
  AvailabilityWindow,
  Course,
  FixedEvent,
  Goal,
  OutlineExtraction,
  PlanningTask,
  Preferences,
  Semester,
  User,
} from "@/lib/types";

const steps = [
  { label: "Semester", icon: GraduationCap },
  { label: "Course outlines", icon: FileText },
  { label: "Class schedule", icon: CalendarCheck },
  { label: "Commitments", icon: CalendarCheck },
  { label: "Goals", icon: Flag },
  { label: "Boundaries", icon: MoonStar },
  { label: "Review", icon: CheckCircle2 },
];

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const rruleDays = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export function OnboardingWizard() {
  const router = useRouter();
  const user = useApiResource<User>("/auth/me");
  const semesters = useApiResource<Semester[]>("/semesters");
  const goals = useApiResource<Goal[]>("/goals");
  const tasks = useApiResource<PlanningTask[]>("/tasks");
  const events = useApiResource<FixedEvent[]>("/events");
  const preferences = useApiResource<Preferences>("/preferences");
  const availability = useApiResource<AvailabilityWindow[]>("/availability");
  const currentSemester = useMemo(
    () => semesters.data?.find((semester) => semester.status === "active") ?? semesters.data?.[0] ?? null,
    [semesters.data],
  );
  const courses = useApiResource<Course[]>(
    currentSemester ? `/semesters/${currentSemester.id}/courses` : null,
  );
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [editingSemester, setEditingSemester] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (user.data?.onboarding_completed_at) router.replace("/today");
  }, [router, user.data]);

  const initialLoading = user.loading || semesters.loading || goals.loading || tasks.loading
    || events.loading || preferences.loading || availability.loading || (Boolean(currentSemester) && courses.loading);
  const loadError = user.error || semesters.error || goals.error || tasks.error || events.error
    || preferences.error || availability.error || courses.error;
  const semesterFormVisible = step === 0 && (!currentSemester || editingSemester);

  function advance() {
    if (step === 0 && !currentSemester) {
      setActionError("Create your semester before continuing.");
      return;
    }
    if (step === 1 && !courses.data?.length) {
      setActionError("Add at least one course before continuing.");
      return;
    }
    setActionError(null);
    setStep((current) => {
      const next = Math.min(current + 1, steps.length - 1);
      setFurthestStep((furthest) => Math.max(furthest, next));
      return next;
    });
  }

  function back() {
    setActionError(null);
    if (step === 0) {
      if (currentSemester) setEditingSemester((editing) => !editing);
      return;
    }
    setStep((current) => Math.max(0, current - 1));
  }

  async function perform(action: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      return true;
    } catch (error) {
      setActionError(error instanceof ApiRequestError ? error.message : "DoNext could not save that yet. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveSemester(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await perform(async () => {
      await apiRequest<Semester>(currentSemester ? `/semesters/${currentSemester.id}` : "/semesters", {
        method: currentSemester ? "PATCH" : "POST",
        body: JSON.stringify({ name: form.get("name"), start_date: form.get("start_date"), end_date: form.get("end_date"), status: "active" }),
      });
      await semesters.reload();
      setEditingSemester(false);
      setStep(1);
      setFurthestStep((furthest) => Math.max(furthest, 1));
    });
  }

  async function createCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentSemester) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await perform(async () => {
      await apiRequest<Course>(`/semesters/${currentSemester.id}/courses`, {
        method: "POST",
        body: JSON.stringify({
          code: form.get("code"),
          name: form.get("name"),
          instructor: form.get("instructor") || null,
          difficulty: Number(form.get("difficulty")),
          weekly_study_target_minutes: Number(form.get("weekly_hours")) * 60,
        }),
      });
      formElement.reset();
      await courses.reload();
    });
  }

  async function createOutlineItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const deadline = String(form.get("deadline"));
    await perform(async () => {
      await apiRequest<PlanningTask>("/tasks", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          course_id: form.get("course_id"),
          estimated_minutes: Number(form.get("estimated_hours")) * 60,
          deadline_at: new Date(`${deadline}T23:59:00`).toISOString(),
          priority: form.get("priority"),
          flexibility: "low",
          intensity: form.get("intensity"),
        }),
      });
      formElement.reset();
      await tasks.reload();
    });
  }

  async function importOutline(proposal: OutlineExtraction): Promise<boolean> {
    if (!currentSemester || !proposal.course.code || !proposal.course.name) return false;
    return perform(async () => {
      const course = await apiRequest<Course>(`/semesters/${currentSemester.id}/courses`, {
        method: "POST",
        body: JSON.stringify({
          code: proposal.course.code,
          name: proposal.course.name,
          instructor: proposal.course.instructor,
          difficulty: 3,
          weekly_study_target_minutes: 180,
        }),
      });

      await Promise.all(proposal.items.map((item) => apiRequest<PlanningTask>("/tasks", {
        method: "POST",
        body: JSON.stringify({
          name: item.name,
          course_id: course.id,
          estimated_minutes: item.estimated_minutes,
          deadline_at: item.deadline_at,
          priority: item.kind === "exam" ? "critical" : "high",
          flexibility: "low",
          intensity: "deep",
        }),
      })));

      await Promise.all(proposal.meetings.map((meeting) => {
        const firstDate = firstDayInSemester(currentSemester.start_date, meeting.day_of_week);
        return apiRequest<FixedEvent>("/events", {
          method: "POST",
          body: JSON.stringify({
            title: meeting.title,
            semester_id: currentSemester.id,
            category: "class",
            start_at: new Date(`${firstDate}T${meeting.start_time}`).toISOString(),
            end_at: new Date(`${firstDate}T${meeting.end_time}`).toISOString(),
            recurrence_rule: `FREQ=WEEKLY;BYDAY=${rruleDays[meeting.day_of_week]};UNTIL=${currentSemester.end_date.replaceAll("-", "")}T235959Z`,
            location: meeting.location,
            commute_before_minutes: 0,
            commute_after_minutes: 0,
            locked: true,
          }),
        });
      }));

      await Promise.all([courses.reload(), tasks.reload(), events.reload()]);
    });
  }

  async function createClassSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentSemester) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const selectedDays = days.flatMap((_, index) => form.get(`class_day_${index}`) === "on" ? [index] : []);
    if (!selectedDays.length) {
      setActionError("Select at least one day when this class meets.");
      return;
    }
    const course = courses.data?.find((item) => item.id === String(form.get("course_id")));
    if (!course) return;
    const startTime = String(form.get("start_time"));
    const endTime = String(form.get("end_time"));
    if (endTime <= startTime) {
      setActionError("Class end time must be later than its start time.");
      return;
    }
    await perform(async () => {
      await Promise.all(selectedDays.map((day) => {
        const firstDate = firstDayInSemester(currentSemester.start_date, day);
        return apiRequest<FixedEvent>("/events", {
          method: "POST",
          body: JSON.stringify({
            title: `${course.code} ${String(form.get("meeting_type"))}`,
            semester_id: currentSemester.id,
            category: "class",
            start_at: new Date(`${firstDate}T${startTime}:00`).toISOString(),
            end_at: new Date(`${firstDate}T${endTime}:00`).toISOString(),
            recurrence_rule: `FREQ=WEEKLY;BYDAY=${rruleDays[day]};UNTIL=${currentSemester.end_date.replaceAll("-", "")}T235959Z`,
            location: form.get("location") || null,
            commute_before_minutes: Number(form.get("commute_before")),
            commute_after_minutes: Number(form.get("commute_after")),
            locked: true,
          }),
        });
      }));
      formElement.reset();
      await events.reload();
    });
  }

  async function createCommitment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentSemester) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const day = Number(form.get("day"));
    const firstDate = firstDayInSemester(currentSemester.start_date, day);
    const start = new Date(`${firstDate}T${String(form.get("start_time"))}:00`);
    const end = new Date(start.getTime() + Number(form.get("duration")) * 60_000);
    const repeats = form.get("repeats") === "on";
    await perform(async () => {
      await apiRequest<FixedEvent>("/events", {
        method: "POST",
        body: JSON.stringify({
          title: form.get("title"),
          semester_id: currentSemester.id,
          category: form.get("category"),
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          recurrence_rule: repeats ? `FREQ=WEEKLY;BYDAY=${rruleDays[day]};UNTIL=${currentSemester.end_date.replaceAll("-", "")}T235959Z` : null,
          location: form.get("location") || null,
          commute_before_minutes: Number(form.get("commute_before")),
          commute_after_minutes: Number(form.get("commute_after")),
          locked: true,
        }),
      });
      formElement.reset();
      await events.reload();
    });
  }

  async function createGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const preferred = Number(form.get("weekly_minutes"));
    await perform(async () => {
      await apiRequest<Goal>("/goals", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          category: form.get("category"),
          priority: form.get("priority"),
          start_date: currentSemester?.start_date ?? new Date().toISOString().slice(0, 10),
          target_description: form.get("target_description") || null,
          minimum_weekly_minutes: Math.min(30, preferred),
          preferred_weekly_minutes: preferred,
          maximum_weekly_minutes: preferred * 2,
          maintenance_weekly_minutes: Math.min(25, preferred),
          reducible_during_busy_weeks: true,
        }),
      });
      formElement.reset();
      await goals.reload();
    });
  }

  async function saveBoundaries(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedDays = days.flatMap((_, index) => form.get(`day_${index}`) === "on" ? [index] : []);
    if (!selectedDays.length) {
      setActionError("Select at least one day when focus work can be scheduled.");
      return;
    }
    await perform(async () => {
      const [updatedPreferences] = await Promise.all([
        apiRequest<Preferences>("/preferences", {
          method: "PATCH",
          body: JSON.stringify({
            minimum_sleep_minutes: Number(form.get("minimum_sleep")) * 60,
            preferred_sleep_minutes: Number(form.get("preferred_sleep")) * 60,
            default_sleep_time: form.get("sleep_time"),
            default_wake_time: form.get("wake_time"),
            preferred_session_minutes: Number(form.get("session_minutes")),
            preserve_free_time_percent: Number(form.get("free_time_percent")),
          }),
        }),
        apiRequest<AvailabilityWindow[]>("/availability", {
          method: "PUT",
          body: JSON.stringify({ windows: selectedDays.map((day) => ({ day_of_week: day, start_time: form.get("available_from"), end_time: form.get("available_until"), type: "available", energy_level: "medium" })) }),
        }),
      ]);
      preferences.setData(updatedPreferences);
      await availability.reload();
      advance();
    });
  }

  async function remove(path: string, reload: () => Promise<void>) {
    await perform(async () => {
      await apiRequest<void>(path, { method: "DELETE" });
      await reload();
    });
  }

  async function finish() {
    await perform(async () => {
      await apiRequest<User>("/auth/onboarding/complete", { method: "POST" });
      router.replace("/today");
      router.refresh();
    });
  }

  if (initialLoading) {
    return <main className="onboarding-loading"><Brand /><LoaderCircle className="spin" size={25} /><p>Preparing your setup…</p></main>;
  }

  if (loadError) {
    return <main className="onboarding-loading"><Brand /><h1>We couldn’t load your setup.</h1><p>{loadError}</p><button className="primary-button" type="button" onClick={() => window.location.reload()}>Try again</button></main>;
  }

  return (
    <main className="onboarding-page">
      <aside className="onboarding-sidebar">
        <Brand />
        <div className="onboarding-intro"><p className="eyebrow">Build the full picture</p><h1>Plan around your real life.</h1><p>Classes matter. So do work, the gym, sleep, commutes, and whatever else keeps you grounded.</p></div>
        <nav aria-label="Setup progress">
          {steps.map((item, index) => {
            const Icon = item.icon;
            const available = index <= furthestStep;
            return <button className={index === step ? "active" : index < step ? "complete" : ""} disabled={!available} key={item.label} type="button" onClick={() => available && setStep(index)}><span>{index < step ? <Check size={15} /> : <Icon size={16} />}</span><strong>{item.label}</strong><small>{index + 1} of {steps.length}</small></button>;
          })}
        </nav>
        <div className="onboarding-trust"><Sparkles size={17} /><span><strong>Saved as you go</strong>Your setup survives refreshes and sign-outs.</span></div>
      </aside>

      <section className="onboarding-main">
        <header className="onboarding-mobile-header"><Brand /><span>{step + 1} / {steps.length}</span></header>
        <div className="onboarding-progress"><span style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
        <div className="onboarding-content">
          {step === 0 ? <SemesterStep semester={currentSemester} editing={editingSemester} onSubmit={saveSemester} /> : null}
          {step === 1 && currentSemester ? <CourseOutlineStep semester={currentSemester} courses={courses.data ?? []} tasks={tasks.data ?? []} busy={busy} onImport={importOutline} onCreateCourse={createCourse} onCreateItem={createOutlineItem} onRemoveCourse={(id) => void remove(`/courses/${id}`, courses.reload)} onRemoveItem={(id) => void remove(`/tasks/${id}`, tasks.reload)} /> : null}
          {step === 2 && currentSemester ? <ClassScheduleStep semester={currentSemester} courses={courses.data ?? []} events={events.data ?? []} busy={busy} onSubmit={createClassSchedule} onRemove={(id) => void remove(`/events/${id}`, events.reload)} /> : null}
          {step === 3 ? <CommitmentsStep events={events.data ?? []} busy={busy} onSubmit={createCommitment} onRemove={(id) => void remove(`/events/${id}`, events.reload)} /> : null}
          {step === 4 ? <GoalsStep goals={goals.data ?? []} busy={busy} onSubmit={createGoal} onRemove={(id) => void remove(`/goals/${id}`, goals.reload)} /> : null}
          {step === 5 && preferences.data ? <BoundariesStep preferences={preferences.data} availability={availability.data ?? []} busy={busy} onSubmit={saveBoundaries} /> : null}
          {step === 6 ? <ReviewStep semester={currentSemester} courses={courses.data ?? []} tasks={tasks.data ?? []} events={events.data ?? []} goals={goals.data ?? []} preferences={preferences.data} busy={busy} onFinish={() => void finish()} /> : null}

          {actionError ? <p className="onboarding-error" role="alert">{actionError}</p> : null}
          {step !== 5 && step !== 6 ? <div className="onboarding-actions"><button className="secondary-button" disabled={busy || (step === 0 && !currentSemester)} type="button" onClick={back}><ArrowLeft size={17} /> Back</button><button className="primary-button" disabled={busy} form={semesterFormVisible ? "semester-form" : undefined} type={semesterFormVisible ? "submit" : "button"} onClick={semesterFormVisible ? undefined : advance}>{step >= 2 ? "Save and continue" : "Continue"}<ArrowRight size={17} /></button></div> : null}
          {step === 5 ? <div className="onboarding-actions"><button className="secondary-button" disabled={busy} type="button" onClick={back}><ArrowLeft size={17} /> Back</button></div> : null}
          {step === 6 ? <div className="onboarding-actions review-back"><button className="secondary-button" disabled={busy} type="button" onClick={back}><ArrowLeft size={17} /> Back</button></div> : null}
        </div>
      </section>
    </main>
  );
}

function StepHeading({ eyebrow, title, copy, optional = false }: { eyebrow: string; title: string; copy: string; optional?: boolean }) {
  return <header className="onboarding-step-heading"><div><p className="eyebrow">{eyebrow}</p>{optional ? <span>Optional, but useful</span> : null}</div><h2>{title}</h2><p>{copy}</p></header>;
}

function SemesterStep({ semester, editing, onSubmit }: { semester: Semester | null; editing: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  if (semester && !editing) return <><StepHeading eyebrow="Your academic window" title="Your semester is in place." copy="These dates anchor deadlines, recurring classes, and workload forecasts." /><SavedCard icon={<GraduationCap size={21} />} title={semester.name} detail={`${formatDate(semester.start_date)} – ${formatDate(semester.end_date)}`} /></>;
  return <><StepHeading eyebrow="Start with the calendar" title="When does this semester run?" copy="DoNext uses the term dates to understand what belongs in this planning season." /><form className="onboarding-form" id="semester-form" onSubmit={onSubmit}><label><span>Semester name</span><input name="name" defaultValue={semester?.name} placeholder="Fall 2026" required /></label><div className="form-row"><label><span>First day</span><input name="start_date" type="date" defaultValue={semester?.start_date} required /></label><label><span>Last day</span><input name="end_date" type="date" defaultValue={semester?.end_date} required /></label></div></form></>;
}

function CommitmentsStep({ events, busy, onSubmit, onRemove }: { events: FixedEvent[]; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onRemove: (id: string) => void }) {
  const commitments = events.filter((event) => event.category !== "class");
  return <><StepHeading eyebrow="The rest of your week" title="What else is already spoken for?" copy="Add work shifts, gym sessions, appointments, clubs, or anything else DoNext must plan around." optional /><div className="commitment-examples"><span><BriefcaseBusiness size={16} /> Work</span><span><Dumbbell size={16} /> Gym</span><span><Clock3 size={16} /> Appointments</span><span><Plus size={16} /> Anything else</span></div><ItemList>{commitments.map((item) => <SavedItem key={item.id} icon={<Clock3 size={18} />} title={item.title} detail={`${capitalize(item.category)} · ${formatEventTime(item.start_at)}${item.recurrence_rule ? " · Weekly" : ""}`} onRemove={() => onRemove(item.id)} />)}</ItemList><form className="onboarding-form compact-form" onSubmit={onSubmit}><div className="form-row"><label><span>Commitment</span><input name="title" placeholder="Gym session" required /></label><label><span>Type</span><select name="category" defaultValue="work"><option value="work">Work</option><option value="gym">Gym</option><option value="commute">Commute</option><option value="appointment">Appointment</option><option value="club">Club or team</option><option value="personal">Personal</option><option value="other">Anything else</option></select></label></div><div className="form-row three-columns"><label><span>Day</span><select name="day" defaultValue="0">{days.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label><label><span>Starts</span><input name="start_time" type="time" required /></label><label><span>Duration</span><select name="duration" defaultValue="60"><option value="30">30 min</option><option value="45">45 min</option><option value="60">1 hour</option><option value="75">1h 15m</option><option value="90">1h 30m</option><option value="120">2 hours</option><option value="180">3 hours</option><option value="240">4 hours</option><option value="480">8 hours</option></select></label></div><label><span>Location <small>Optional</small></span><input name="location" placeholder="Campus gym" /></label><div className="form-row"><label><span>Travel before</span><select name="commute_before" defaultValue="0"><option value="0">None</option><option value="10">10 min</option><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">1 hour</option></select></label><label><span>Travel after</span><select name="commute_after" defaultValue="0"><option value="0">None</option><option value="10">10 min</option><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">1 hour</option></select></label></div><label className="checkbox-field"><input name="repeats" type="checkbox" defaultChecked /><span><strong>Repeat every week</strong><small>DoNext will protect this time through the semester.</small></span></label><button className="secondary-button form-submit" disabled={busy} type="submit"><Plus size={17} /> Add commitment</button></form></>;
}

function GoalsStep({ goals, busy, onSubmit, onRemove }: { goals: Goal[]; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onRemove: (id: string) => void }) {
  return <><StepHeading eyebrow="Beyond obligations" title="What do you want to keep moving?" copy="Goals give personal priorities a real place in the plan instead of leaving them for whatever time remains." optional /><ItemList>{goals.map((goal) => <SavedItem key={goal.id} icon={<Flag size={18} />} title={goal.name} detail={`${capitalize(goal.category)} · ${formatMinutes(goal.preferred_weekly_minutes)} preferred weekly`} onRemove={() => onRemove(goal.id)} />)}</ItemList><form className="onboarding-form compact-form" onSubmit={onSubmit}><label><span>Goal</span><input name="name" placeholder="Practice conversational French" required /></label><div className="form-row"><label><span>Category</span><select name="category" defaultValue="personal"><option value="health">Health</option><option value="career">Career</option><option value="creative">Creative</option><option value="learning">Learning</option><option value="personal">Personal</option></select></label><label><span>Priority</span><select name="priority" defaultValue="medium"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="optional">Optional</option></select></label></div><div className="form-row"><label><span>Preferred weekly time</span><select name="weekly_minutes" defaultValue="120"><option value="30">30 minutes</option><option value="60">1 hour</option><option value="90">1.5 hours</option><option value="120">2 hours</option><option value="180">3 hours</option><option value="240">4 hours</option></select></label><label><span>What does success look like? <small>Optional</small></span><input name="target_description" placeholder="Run 5 km comfortably" /></label></div><button className="secondary-button form-submit" disabled={busy} type="submit"><Plus size={17} /> Add goal</button></form></>;
}

function BoundariesStep({ preferences, availability, busy, onSubmit }: { preferences: Preferences; availability: AvailabilityWindow[]; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const selectedDays = new Set(availability.map((window) => window.day_of_week));
  const firstWindow = availability[0];
  return <><StepHeading eyebrow="Protect the person doing the work" title="Set the boundaries the plan cannot borrow from." copy="Sleep, realistic focus windows, and free time become planning constraints—not suggestions." /><form className="onboarding-form boundaries-form" onSubmit={onSubmit}><div className="boundary-group"><div><MoonStar size={18} /><span><strong>Sleep</strong><small>Your minimum is a hard floor.</small></span></div><div className="form-row"><label><span>Minimum</span><select name="minimum_sleep" defaultValue={preferences.minimum_sleep_minutes / 60}><option value="6">6 hours</option><option value="6.5">6.5 hours</option><option value="7">7 hours</option><option value="7.5">7.5 hours</option><option value="8">8 hours</option><option value="8.5">8.5 hours</option></select></label><label><span>Preferred</span><select name="preferred_sleep" defaultValue={preferences.preferred_sleep_minutes / 60}><option value="7">7 hours</option><option value="7.5">7.5 hours</option><option value="8">8 hours</option><option value="8.5">8.5 hours</option><option value="9">9 hours</option><option value="9.5">9.5 hours</option></select></label></div><div className="form-row"><label><span>Typical bedtime</span><input name="sleep_time" type="time" defaultValue={preferences.default_sleep_time.slice(0, 5)} required /></label><label><span>Typical wake time</span><input name="wake_time" type="time" defaultValue={preferences.default_wake_time.slice(0, 5)} required /></label></div></div><div className="boundary-group"><div><Clock3 size={18} /><span><strong>Focus availability</strong><small>Choose when flexible work may be placed.</small></span></div><fieldset className="day-picker"><legend>Available days</legend>{days.map((day, index) => <label key={day}><input name={`day_${index}`} type="checkbox" defaultChecked={availability.length ? selectedDays.has(index) : index < 5} /><span>{day.slice(0, 3)}</span></label>)}</fieldset><div className="form-row"><label><span>Available from</span><input name="available_from" type="time" defaultValue={firstWindow?.start_time.slice(0, 5) ?? "08:00"} required /></label><label><span>Available until</span><input name="available_until" type="time" defaultValue={firstWindow?.end_time.slice(0, 5) ?? "20:00"} required /></label></div><div className="form-row"><label><span>Preferred focus session</span><select name="session_minutes" defaultValue={preferences.preferred_session_minutes}><option value="25">25 minutes</option><option value="40">40 minutes</option><option value="45">45 minutes</option><option value="50">50 minutes</option><option value="60">60 minutes</option><option value="75">75 minutes</option><option value="90">90 minutes</option></select></label><label><span>Keep free each week</span><select name="free_time_percent" defaultValue={preferences.preserve_free_time_percent}><option value="10">10%</option><option value="15">15%</option><option value="20">20%</option><option value="25">25%</option><option value="30">30%</option><option value="40">40%</option></select></label></div></div><button className="primary-button form-submit" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Save boundaries and continue</button></form></>;
}

function ReviewStep({ semester, courses, tasks, events, goals, preferences, busy, onFinish }: { semester: Semester | null; courses: Course[]; tasks: PlanningTask[]; events: FixedEvent[]; goals: Goal[]; preferences: Preferences | null; busy: boolean; onFinish: () => void }) {
  const weeklyMinutes = courses.reduce((total, course) => total + course.weekly_study_target_minutes, 0) + goals.reduce((total, goal) => total + goal.preferred_weekly_minutes, 0);
  const classMeetings = events.filter((event) => event.category === "class").length;
  const otherCommitments = events.length - classMeetings;
  return <><StepHeading eyebrow="Ready to plan honestly" title="Here’s the life DoNext will plan around." copy="You can edit every detail later. Finishing setup unlocks your planner without generating or moving anything yet." /><section className="review-grid"><ReviewCard icon={<GraduationCap size={20} />} label="Semester" value={semester?.name ?? "Not added"} detail={`${courses.length} ${courses.length === 1 ? "course" : "courses"}`} /><ReviewCard icon={<FileText size={20} />} label="Course outlines" value={`${tasks.length} key ${tasks.length === 1 ? "item" : "items"}`} detail="Deadlines ready for planning" /><ReviewCard icon={<CalendarCheck size={20} />} label="Class schedule" value={`${classMeetings} meetings`} detail="Locked weekly class time" /><ReviewCard icon={<Clock3 size={20} />} label="Other commitments" value={`${otherCommitments} added`} detail="Work, gym, appointments, and life" /><ReviewCard icon={<Flag size={20} />} label="Personal goals" value={`${goals.length} protected`} detail={`${formatMinutes(weeklyMinutes)} combined weekly targets`} /><ReviewCard icon={<MoonStar size={20} />} label="Sleep floor" value={preferences ? formatMinutes(preferences.minimum_sleep_minutes) : "Not set"} detail={preferences ? `${preferences.preserve_free_time_percent}% free-time buffer` : "Use default boundaries"} /></section><div className="review-note"><Sparkles size={20} /><div><strong>Your first plan will still ask before making tradeoffs.</strong><p>Setup gives DoNext context. It does not grant permission to silently overbook you or move fixed commitments.</p></div></div><button className="primary-button finish-button" disabled={busy} type="button" onClick={onFinish}>{busy ? <LoaderCircle className="spin" size={18} /> : <CheckCircle2 size={18} />} Finish setup and open my planner</button></>;
}

function ItemList({ children }: { children: ReactNode }) {
  return <div className="onboarding-item-list">{children}</div>;
}

function SavedItem({ icon, title, detail, onRemove }: { icon: ReactNode; title: string; detail: string; onRemove: () => void }) {
  return <article className="onboarding-saved-item"><span>{icon}</span><div><strong>{title}</strong><small>{detail}</small></div><button aria-label={`Remove ${title}`} type="button" onClick={onRemove}><Trash2 size={16} /></button></article>;
}

function SavedCard({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <article className="onboarding-saved-card"><span>{icon}</span><div><small>Saved</small><h3>{title}</h3><p>{detail}</p></div><CheckCircle2 size={21} /></article>;
}

function ReviewCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return <article><span>{icon}</span><small>{label}</small><strong>{value}</strong><p>{detail}</p></article>;
}

function firstDayInSemester(startDate: string, dayIndex: number) {
  const date = new Date(`${startDate}T12:00:00`);
  const jsTarget = dayIndex === 6 ? 0 : dayIndex + 1;
  date.setDate(date.getDate() + ((jsTarget - date.getDay() + 7) % 7));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatEventTime(value: string) {
  const date = new Date(value);
  return `${days[(date.getDay() + 6) % 7]} at ${new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(date)}`;
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
