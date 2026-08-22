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
import { zonedDateTimeToIso } from "@/lib/date-time";
import type {
  AvailabilityWindow,
  Course,
  CourseOutlineImportResult,
  FixedEvent,
  Goal,
  OutlineExtraction,
  PlanningTask,
  Preferences,
  ScheduleProposal,
  Semester,
  User,
} from "@/lib/types";

const steps = [
  { label: "Semester", icon: GraduationCap },
  { label: "Course outlines", icon: FileText },
  { label: "Class schedule", icon: CalendarCheck },
  { label: "Commitments & goals", icon: Flag },
  { label: "Boundaries", icon: MoonStar },
  { label: "Review", icon: CheckCircle2 },
];

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const rruleDays = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const commitmentDurations = [
  ["30", "30 min"],
  ["45", "45 min"],
  ["60", "1 hour"],
  ["75", "1h 15m"],
  ["90", "1h 30m"],
  ["120", "2 hours"],
  ["180", "3 hours"],
  ["240", "4 hours"],
  ["480", "8 hours"],
] as const;

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
  const [outlineReviewActive, setOutlineReviewActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (user.data?.onboarding_completed_at) router.replace("/today");
  }, [router, user.data]);

  const initialLoading = (user.loading && user.data === null)
    || (semesters.loading && semesters.data === null)
    || (goals.loading && goals.data === null)
    || (tasks.loading && tasks.data === null)
    || (events.loading && events.data === null)
    || (preferences.loading && preferences.data === null)
    || (availability.loading && availability.data === null)
    || (Boolean(currentSemester) && courses.loading && courses.data === null);
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
    const courseCode = proposal.course.code;
    const courseName = proposal.course.name;
    if (!currentSemester || !courseCode || !courseName) return false;
    return perform(async () => {
      const existingCourse = courses.data?.find(
        (item) => normalizeCourseCode(item.code) === normalizeCourseCode(courseCode),
      );
      await apiRequest<CourseOutlineImportResult>(
        `/semesters/${currentSemester.id}/courses/import-outline`, {
        method: "POST",
        body: JSON.stringify({
          course: {
            code: courseCode,
            name: courseName,
            instructor: proposal.course.instructor,
            difficulty: 3,
            weekly_study_target_minutes: 180,
          },
          grading: {
            groups: proposal.groups,
            items: proposal.items.map((item, index) => ({
              key: item.key ?? `item-${index + 1}`,
              group_key: item.group_key,
              item_type: academicItemType(item),
              name: item.name,
              due_at: item.deadline_at,
              direct_weight_percent: item.weight_percent,
              relative_weight_percent: item.relative_weight_percent,
              points_possible: item.points_possible,
              weight_origin: item.weight_origin,
              extraction_confidence: item.confidence,
              minimum_required_percent: item.minimum_required_percent,
              extra_credit: item.extra_credit,
              source_text: item.source_text,
              source_references: proposal.source_files,
              estimated_minutes: item.estimated_minutes,
            })),
            schemes: proposal.schemes,
          },
          meeting_proposals: proposal.meetings,
          replace_existing: Boolean(existingCourse),
        }),
      });

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
    const timezone = user.data?.timezone ?? "UTC";
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
            start_at: zonedDateTimeToIso(firstDate, `${startTime}:00`, timezone),
            end_at: zonedDateTimeToIso(firstDate, `${endTime}:00`, timezone),
            recurrence_rule: `FREQ=WEEKLY;BYDAY=${rruleDays[day]};UNTIL=${currentSemester.end_date.replaceAll("-", "")}T235959Z`,
            location: form.get("location") || null,
            commute_before_minutes: 0,
            commute_after_minutes: 0,
            locked: true,
          }),
        });
      }));
      formElement.reset();
      await events.reload();
    });
  }

  async function createLifeItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentSemester) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const planningMode = form.get("planning_mode");
    if (planningMode === "flexible") {
      const cadence = form.get("schedule_cadence");
      const targetMinutes = Math.round(Number(form.get("flexible_hours")) * 60);
      const selectedFlexibleDays = days.flatMap((_, index) => form.get(`flexible_day_${index}`) === "on" ? [index] : []);
      if (!targetMinutes || targetMinutes <= 0 || targetMinutes % 15 !== 0) {
        setActionError("Enter flexible time in 15-minute increments.");
        return;
      }
      if (cadence === "selected_days" && !selectedFlexibleDays.length) {
        setActionError("Select at least one day for this flexible commitment.");
        return;
      }
      await perform(async () => {
        await apiRequest<Goal>("/goals", {
          method: "POST",
          body: JSON.stringify({
            name: form.get("title"),
            semester_id: currentSemester.id,
            category: form.get("category"),
            priority: form.get("priority"),
            start_date: currentSemester.start_date,
            planning_kind: "flexible_commitment",
            schedule_rule: cadence === "selected_days"
              ? { cadence: "selected_days", target_minutes: targetMinutes, days_of_week: selectedFlexibleDays }
              : { cadence: "weekly", target_minutes: targetMinutes },
          }),
        });
        formElement.reset();
        await goals.reload();
      });
      return;
    }
    const selectedDays = days.flatMap((_, index) => form.get(`commitment_day_${index}`) === "on" ? [index] : []);
    if (!selectedDays.length) {
      setActionError("Select at least one day for this commitment.");
      return;
    }
    const schedules = selectedDays.map((day) => ({
      day,
      startTime: String(form.get(`commitment_start_${day}`) ?? ""),
      durationMinutes: Number(form.get(`commitment_duration_${day}`)),
    }));
    if (schedules.some((schedule) => !schedule.startTime || !schedule.durationMinutes)) {
      setActionError("Add a start time and duration for every selected day.");
      return;
    }
    const timezone = user.data?.timezone ?? "UTC";
    const repeats = form.get("repeats") === "on";
    await perform(async () => {
      await Promise.all(schedules.map(({ day, startTime, durationMinutes }) => {
        const firstDate = firstDayInSemester(currentSemester.start_date, day);
        const start = new Date(zonedDateTimeToIso(firstDate, `${startTime}:00`, timezone));
        const end = new Date(start.getTime() + durationMinutes * 60_000);
        return apiRequest<FixedEvent>("/events", {
          method: "POST",
          body: JSON.stringify({
            title: form.get("title"),
            semester_id: currentSemester.id,
            category: form.get("category"),
            priority: form.get("priority"),
            start_at: start.toISOString(),
            end_at: end.toISOString(),
            recurrence_rule: repeats ? `FREQ=WEEKLY;BYDAY=${rruleDays[day]};UNTIL=${currentSemester.end_date.replaceAll("-", "")}T235959Z` : null,
            location: form.get("location") || null,
            commute_before_minutes: 0,
            commute_after_minutes: 0,
            locked: true,
          }),
        });
      }));
      formElement.reset();
      await events.reload();
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
    if (!currentSemester) {
      setActionError("Add a semester before creating your first schedule draft.");
      return;
    }
    await perform(async () => {
      await apiRequest<ScheduleProposal>(`/semesters/${currentSemester.id}/schedule/proposals`, {
        method: "POST",
      });
      await apiRequest<User>("/auth/onboarding/complete", { method: "POST" });
      router.replace("/week");
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
        <div className={`onboarding-content${step === 1 && outlineReviewActive ? " review-queue-content" : ""}`}>
          {step === 0 ? <SemesterStep semester={currentSemester} editing={editingSemester} onSubmit={saveSemester} /> : null}
          {step === 1 && currentSemester ? <CourseOutlineStep semester={currentSemester} courses={courses.data ?? []} tasks={tasks.data ?? []} busy={busy} onImport={importOutline} onCreateCourse={createCourse} onCreateItem={createOutlineItem} onRemoveCourse={(id) => void remove(`/courses/${id}`, courses.reload)} onRemoveItem={(id) => void remove(`/tasks/${id}`, tasks.reload)} onReviewActiveChange={setOutlineReviewActive} /> : null}
          {step === 2 && currentSemester ? <ClassScheduleStep semester={currentSemester} courses={courses.data ?? []} events={events.data ?? []} timezone={user.data?.timezone ?? "UTC"} busy={busy} onSubmit={createClassSchedule} onRemove={(id) => void remove(`/events/${id}`, events.reload)} /> : null}
          {step === 3 ? <CommitmentsAndGoalsStep events={events.data ?? []} goals={goals.data ?? []} busy={busy} onSubmit={createLifeItem} onRemoveEvent={(id) => void remove(`/events/${id}`, events.reload)} onRemoveGoal={(id) => void remove(`/goals/${id}`, goals.reload)} /> : null}
          {step === 4 && preferences.data ? <BoundariesStep preferences={preferences.data} availability={availability.data ?? []} busy={busy} onSubmit={saveBoundaries} /> : null}
          {step === 5 ? <ReviewStep semester={currentSemester} courses={courses.data ?? []} tasks={tasks.data ?? []} events={events.data ?? []} goals={goals.data ?? []} preferences={preferences.data} busy={busy} onFinish={() => void finish()} /> : null}

          {actionError ? <p className="onboarding-error" role="alert">{actionError}</p> : null}
          {step !== 4 && step !== 5 && !(step === 1 && outlineReviewActive) ? <div className="onboarding-actions"><button className="secondary-button" disabled={busy || (step === 0 && !currentSemester)} type="button" onClick={back}><ArrowLeft size={17} /> Back</button><button className="primary-button" disabled={busy} form={semesterFormVisible ? "semester-form" : undefined} type={semesterFormVisible ? "submit" : "button"} onClick={semesterFormVisible ? undefined : advance}>{step >= 2 ? "Save and continue" : "Continue"}<ArrowRight size={17} /></button></div> : null}
          {step === 4 ? <div className="onboarding-actions"><button className="secondary-button" disabled={busy} type="button" onClick={back}><ArrowLeft size={17} /> Back</button></div> : null}
          {step === 5 ? <div className="onboarding-actions review-back"><button className="secondary-button" disabled={busy} type="button" onClick={back}><ArrowLeft size={17} /> Back</button></div> : null}
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

function CommitmentsAndGoalsStep({ events, goals, busy, onSubmit, onRemoveEvent, onRemoveGoal }: { events: FixedEvent[]; goals: Goal[]; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onRemoveEvent: (id: string) => void; onRemoveGoal: (id: string) => void }) {
  const commitments = events.filter((event) => event.category !== "class");
  const flexibleCommitments = goals.filter((goal) => goal.planning_kind === "flexible_commitment");
  const personalGoals = goals.filter((goal) => goal.planning_kind === "goal");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [planningMode, setPlanningMode] = useState<"manual" | "flexible">("manual");
  const [cadence, setCadence] = useState<"weekly" | "selected_days">("weekly");
  const [flexibleDays, setFlexibleDays] = useState<number[]>([]);

  function setDaySelected(index: number, selected: boolean) {
    setSelectedDays((current) => selected
      ? [...current, index].sort((left, right) => left - right)
      : current.filter((day) => day !== index));
  }

  function setFlexibleDay(index: number, selected: boolean) {
    setFlexibleDays((current) => selected
      ? [...current, index].sort((left, right) => left - right)
      : current.filter((day) => day !== index));
  }

  function resetFormState() {
    setSelectedDays([]);
    setFlexibleDays([]);
    setPlanningMode("manual");
    setCadence("weekly");
  }

  return (
    <>
      <StepHeading eyebrow="Life beyond classes" title="What should DoNext make room for?" copy="Add work, workouts, personal projects, appointments, or anything else that needs time." optional />
      <div className="commitment-examples"><span><BriefcaseBusiness size={16} /> Work</span><span><Dumbbell size={16} /> Gym</span><span><Flag size={16} /> Personal goals</span><span><Plus size={16} /> Anything else</span></div>
      <ItemList>
        {commitments.map((item) => <SavedItem key={item.id} icon={<Clock3 size={18} />} title={item.title} detail={`Fixed time · ${formatEventTime(item.start_at)}${item.recurrence_rule ? " · Weekly" : ""} · ${capitalize(item.priority)} priority`} onRemove={() => onRemoveEvent(item.id)} />)}
        {flexibleCommitments.map((item) => <SavedItem key={item.id} icon={<Sparkles size={18} />} title={item.name} detail={`${formatFlexibleCommitment(item)} · ${capitalize(item.priority)} priority`} onRemove={() => onRemoveGoal(item.id)} />)}
        {personalGoals.map((goal) => <SavedItem key={goal.id} icon={<Flag size={18} />} title={goal.name} detail={`Scheduled by DoNext · ${formatMinutes(goal.preferred_weekly_minutes)}/week · ${capitalize(goal.priority)} priority`} onRemove={() => onRemoveGoal(goal.id)} />)}
      </ItemList>
      <form className="onboarding-form compact-form" onReset={resetFormState} onSubmit={onSubmit}>
        <div className="form-row three-columns">
          <label><span>Name</span><input name="title" placeholder="Work shift, gym, or project" required /></label>
          <label><span>Category</span><select name="category" defaultValue="work"><option value="work">Work</option><option value="gym">Gym or fitness</option><option value="appointment">Appointment</option><option value="club">Club or team</option><option value="health">Health</option><option value="career">Career</option><option value="creative">Creative</option><option value="learning">Learning</option><option value="personal">Personal</option><option value="commute">Commute</option><option value="other">Anything else</option></select></label>
          <label><span>Priority</span><select name="priority" defaultValue="medium"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="optional">Optional</option></select><small>Helps DoNext choose between flexible items. Fixed times always stay protected.</small></label>
        </div>
        <input name="planning_mode" type="hidden" value={planningMode} />
        <fieldset className="commitment-mode-picker">
          <legend>Who should choose the time?</legend>
          <label><input checked={planningMode === "manual"} name="planning_mode_choice" type="radio" value="manual" onChange={() => setPlanningMode("manual")} /><span><Clock3 size={18} /><span><strong>I’ll set the times</strong><small>Best for work shifts, appointments, and anything fixed.</small></span></span></label>
          <label><input checked={planningMode === "flexible"} name="planning_mode_choice" type="radio" value="flexible" onChange={() => setPlanningMode("flexible")} /><span><Sparkles size={18} /><span><strong>Let DoNext schedule it</strong><small>Tell us the hours and we’ll find room in a draft.</small></span></span></label>
        </fieldset>
        {planningMode === "manual" ? (
          <>
            <fieldset className="class-day-picker">
              <legend>Occurs on</legend>
              {days.map((day, index) => <label key={day}><input checked={selectedDays.includes(index)} name={`commitment_day_${index}`} type="checkbox" onChange={(event) => setDaySelected(index, event.currentTarget.checked)} /><span>{day.slice(0, 3)}</span></label>)}
            </fieldset>
            {selectedDays.length ? (
              <section aria-label="Times by day" className="commitment-day-schedules">
                <header><div><strong>Times by day</strong><small>Each selected day can have its own schedule.</small></div></header>
                {selectedDays.map((day) => (
                  <div className="commitment-day-row" key={day}>
                    <strong>{days[day]}</strong>
                    <label><span>Starts</span><input aria-label={`${days[day]} starts`} name={`commitment_start_${day}`} type="time" required /></label>
                    <label><span>Duration</span><select aria-label={`${days[day]} duration`} name={`commitment_duration_${day}`} defaultValue="60">{commitmentDurations.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  </div>
                ))}
              </section>
            ) : (
              <div className="commitment-day-empty"><Clock3 size={18} /><span><strong>Select the days first</strong><small>You’ll set a time for each selected day.</small></span></div>
            )}
            <label><span>Location <small>Optional</small></span><input name="location" placeholder="Campus gym" /></label>
            <label className="checkbox-field"><input name="repeats" type="checkbox" defaultChecked /><span><strong>Repeat every week</strong><small>DoNext will repeat each day at the time you set above.</small></span></label>
          </>
        ) : (
          <section className="flexible-commitment-fields">
            <fieldset className="flexible-cadence-picker">
              <legend>How should the time add up?</legend>
              <label><input checked={cadence === "weekly"} name="schedule_cadence" type="radio" value="weekly" onChange={() => setCadence("weekly")} /><span><strong>Hours per week</strong><small>DoNext can spread the time across any available days.</small></span></label>
              <label><input checked={cadence === "selected_days"} name="schedule_cadence" type="radio" value="selected_days" onChange={() => setCadence("selected_days")} /><span><strong>Hours per selected day</strong><small>Keep the target attached to specific weekdays.</small></span></label>
            </fieldset>
            {cadence === "selected_days" ? <fieldset className="class-day-picker"><legend>Schedule on</legend>{days.map((day, index) => <label key={day}><input checked={flexibleDays.includes(index)} name={`flexible_day_${index}`} type="checkbox" onChange={(event) => setFlexibleDay(index, event.currentTarget.checked)} /><span>{day.slice(0, 3)}</span></label>)}</fieldset> : null}
            <label><span>{cadence === "weekly" ? "Hours each week" : "Hours on each selected day"}</span><input name="flexible_hours" type="number" min="0.25" max={cadence === "weekly" ? "168" : "24"} step="0.25" defaultValue="1" required /><small>Use 15-minute increments.</small></label>
            <div className="flexible-draft-note"><Sparkles size={18} /><span><strong>Times won’t be added to your calendar yet.</strong><small>DoNext will propose times in your next draft schedule. Review and accept the draft before your calendar changes.</small></span></div>
          </section>
        )}
        <button className="secondary-button form-submit" disabled={busy} type="submit">{planningMode === "flexible" ? <Sparkles size={17} /> : <Plus size={17} />} {planningMode === "flexible" ? "Let DoNext schedule it" : "Add item"}</button>
      </form>
    </>
  );
}

function BoundariesStep({ preferences, availability, busy, onSubmit }: { preferences: Preferences; availability: AvailabilityWindow[]; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const selectedDays = new Set(availability.map((window) => window.day_of_week));
  const firstWindow = availability[0];
  return <><StepHeading eyebrow="Protect the person doing the work" title="Set the boundaries the plan cannot borrow from." copy="Sleep, realistic focus windows, and free time become planning constraints—not suggestions." /><form className="onboarding-form boundaries-form" onSubmit={onSubmit}><div className="boundary-group"><div><MoonStar size={18} /><span><strong>Sleep</strong><small>Your minimum is a hard floor.</small></span></div><div className="form-row"><label><span>Minimum</span><select name="minimum_sleep" defaultValue={preferences.minimum_sleep_minutes / 60}><option value="6">6 hours</option><option value="6.5">6.5 hours</option><option value="7">7 hours</option><option value="7.5">7.5 hours</option><option value="8">8 hours</option><option value="8.5">8.5 hours</option></select></label><label><span>Preferred</span><select name="preferred_sleep" defaultValue={preferences.preferred_sleep_minutes / 60}><option value="7">7 hours</option><option value="7.5">7.5 hours</option><option value="8">8 hours</option><option value="8.5">8.5 hours</option><option value="9">9 hours</option><option value="9.5">9.5 hours</option></select></label></div><div className="form-row"><label><span>Typical bedtime</span><input name="sleep_time" type="time" defaultValue={preferences.default_sleep_time.slice(0, 5)} required /></label><label><span>Typical wake time</span><input name="wake_time" type="time" defaultValue={preferences.default_wake_time.slice(0, 5)} required /></label></div></div><div className="boundary-group"><div><Clock3 size={18} /><span><strong>Focus availability</strong><small>Choose when flexible work may be placed.</small></span></div><fieldset className="day-picker"><legend>Available days</legend>{days.map((day, index) => <label key={day}><input name={`day_${index}`} type="checkbox" defaultChecked={availability.length ? selectedDays.has(index) : index < 5} /><span>{day.slice(0, 3)}</span></label>)}</fieldset><div className="form-row"><label><span>Available from</span><input name="available_from" type="time" defaultValue={firstWindow?.start_time.slice(0, 5) ?? "08:00"} required /></label><label><span>Available until</span><input name="available_until" type="time" defaultValue={firstWindow?.end_time.slice(0, 5) ?? "20:00"} required /></label></div><div className="form-row"><label><span>Preferred focus session</span><select name="session_minutes" defaultValue={preferences.preferred_session_minutes}><option value="25">25 minutes</option><option value="40">40 minutes</option><option value="45">45 minutes</option><option value="50">50 minutes</option><option value="60">60 minutes</option><option value="75">75 minutes</option><option value="90">90 minutes</option></select></label><label><span>Keep free each week</span><select name="free_time_percent" defaultValue={preferences.preserve_free_time_percent}><option value="10">10%</option><option value="15">15%</option><option value="20">20%</option><option value="25">25%</option><option value="30">30%</option><option value="40">40%</option></select></label></div></div><button className="primary-button form-submit" disabled={busy} type="submit">{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Save boundaries and continue</button></form></>;
}

function ReviewStep({ semester, courses, tasks, events, goals, preferences, busy, onFinish }: { semester: Semester | null; courses: Course[]; tasks: PlanningTask[]; events: FixedEvent[]; goals: Goal[]; preferences: Preferences | null; busy: boolean; onFinish: () => void }) {
  const personalGoals = goals.filter((goal) => goal.planning_kind === "goal");
  const flexibleCommitments = goals.filter((goal) => goal.planning_kind === "flexible_commitment");
  const goalMinutes = personalGoals.reduce((total, goal) => total + goal.preferred_weekly_minutes, 0);
  const flexibleMinutes = flexibleCommitments.reduce((total, goal) => total + goal.preferred_weekly_minutes, 0);
  const classMeetings = events.filter((event) => event.category === "class").length;
  const lifeItems = events.length - classMeetings + flexibleCommitments.length + personalGoals.length;
  const flexibleLifeMinutes = flexibleMinutes + goalMinutes;
  return <><StepHeading eyebrow="Ready to plan honestly" title="Here’s the life DoNext will plan around." copy="When you finish, DoNext will create a 14-day draft using these details and take you straight to review it." /><section className="review-grid"><ReviewCard icon={<GraduationCap size={20} />} label="Semester" value={semester?.name ?? "Not added"} detail={`${courses.length} ${courses.length === 1 ? "course" : "courses"}`} /><ReviewCard icon={<FileText size={20} />} label="Course outlines" value={`${tasks.length} key ${tasks.length === 1 ? "item" : "items"}`} detail="Deadlines ready for planning" /><ReviewCard icon={<CalendarCheck size={20} />} label="Class schedule" value={`${classMeetings} meetings`} detail="Locked weekly class time" /><ReviewCard icon={<Flag size={20} />} label="Commitments & goals" value={`${lifeItems} added`} detail={flexibleLifeMinutes ? `${formatMinutes(flexibleLifeMinutes)} for DoNext to place each week` : "Work, workouts, projects, and life"} /><ReviewCard icon={<MoonStar size={20} />} label="Sleep floor" value={preferences ? formatMinutes(preferences.minimum_sleep_minutes) : "Not set"} detail={preferences ? `${preferences.preserve_free_time_percent}% free-time buffer` : "Use default boundaries"} /></section><div className="review-note"><Sparkles size={20} /><div><strong>You stay in control of the final schedule.</strong><p>DoNext will prepare a draft, not change your calendar. Nothing becomes active until you review and accept it.</p></div></div><button className="primary-button finish-button" disabled={busy} type="button" onClick={onFinish}>{busy ? <LoaderCircle className="spin" size={18} /> : <CheckCircle2 size={18} />} {busy ? "Creating your first draft…" : "Finish setup and create my draft"}</button></>;
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
  const date = new Date(`${startDate}T12:00:00Z`);
  const jsTarget = dayIndex === 6 ? 0 : dayIndex + 1;
  date.setUTCDate(date.getUTCDate() + ((jsTarget - date.getUTCDay() + 7) % 7));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
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

function formatFlexibleCommitment(goal: Goal) {
  const rule = goal.schedule_rule;
  if (!rule) return "Scheduled by DoNext";
  if (rule.cadence === "weekly") {
    return `Scheduled by DoNext · ${formatMinutes(rule.target_minutes)}/week`;
  }
  const selectedDays = rule.days_of_week.map((day) => days[day].slice(0, 3)).join(", ");
  return `Scheduled by DoNext · ${formatMinutes(rule.target_minutes)} on ${selectedDays}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeCourseCode(value: string) {
  return value.replaceAll(/\s+/g, "").toUpperCase();
}

function academicItemType(item: OutlineExtraction["items"][number]) {
  if (item.kind === "exam") {
    return item.name.toLowerCase().includes("final") ? "final_exam" : "midterm";
  }
  if (item.kind === "paper") return "presentation";
  return item.kind;
}
