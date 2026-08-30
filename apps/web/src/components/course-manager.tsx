"use client";

import { BookOpen, Clock3, LoaderCircle, Plus, Scale, Trash2, UploadCloud } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import { CourseOutlineStep } from "@/components/course-outline-step";
import { FormDialog } from "@/components/form-dialog";
import { GradingEditor } from "@/components/grading-editor";
import { useApiResource } from "@/hooks/use-api-resource";
import { apiRequest, ApiRequestError } from "@/lib/api";
import type {
  Course,
  CourseOutlineImportResult,
  OutlineExtraction,
  Semester,
} from "@/lib/types";

const courseColors = ["mint", "violet", "blue", "coral"];

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function yearEndDate() {
  const date = new Date();
  date.setMonth(date.getMonth() + 4);
  return date.toISOString().slice(0, 10);
}

export function CourseManager() {
  const semesters = useApiResource<Semester[]>("/semesters");
  const currentSemester = useMemo(
    () => semesters.data?.find((semester) => semester.status === "active") ?? semesters.data?.[0] ?? null,
    [semesters.data],
  );
  const courses = useApiResource<Course[]>(
    currentSemester ? `/semesters/${currentSemester.id}/courses` : null,
  );
  const [courseDialogOpen, setCourseDialogOpen] = useState(false);
  const [gradingCourse, setGradingCourse] = useState<Course | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [outlineImporterOpen, setOutlineImporterOpen] = useState(false);
  const [outlineReviewActive, setOutlineReviewActive] = useState(false);
  const outlineReviewStarted = useRef(false);

  const handleOutlineReviewActiveChange = useCallback((active: boolean) => {
    setOutlineReviewActive(active);
    if (active) {
      outlineReviewStarted.current = true;
    } else if (outlineReviewStarted.current) {
      outlineReviewStarted.current = false;
      setOutlineImporterOpen(false);
    }
  }, []);

  async function createSemester(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setActionError(null);
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest<Semester>("/semesters", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          start_date: form.get("start_date"),
          end_date: form.get("end_date"),
          status: "active",
        }),
      });
      await semesters.reload();
    } catch (error) {
      setActionError(error instanceof ApiRequestError ? error.message : "Could not save the semester.");
    } finally {
      setSubmitting(false);
    }
  }

  async function createCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentSemester) return;
    setSubmitting(true);
    setActionError(null);
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest<Course>(`/semesters/${currentSemester.id}/courses`, {
        method: "POST",
        body: JSON.stringify({
          code: form.get("code"),
          name: form.get("name"),
          instructor: form.get("instructor") || null,
          difficulty: Number(form.get("difficulty")),
          weekly_study_target_minutes: Number(form.get("weekly_target") ?? form.get("weekly_hours")) * 60,
        }),
      });
      setCourseDialogOpen(false);
      await courses.reload();
    } catch (error) {
      setActionError(error instanceof ApiRequestError ? error.message : "Could not save the course.");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteCourse(course: Course) {
    if (!window.confirm(`Remove ${course.code} from this semester?`)) return;
    setActionError(null);
    try {
      await apiRequest<void>(`/courses/${course.id}`, { method: "DELETE" });
      await courses.reload();
    } catch (error) {
      setActionError(error instanceof ApiRequestError ? error.message : "Could not remove the course.");
    }
  }

  async function importOutline(proposal: OutlineExtraction): Promise<boolean> {
    const courseCode = proposal.course.code;
    const courseName = proposal.course.name;
    if (!currentSemester || !courseCode || !courseName) return false;
    setSubmitting(true);
    setActionError(null);
    try {
      const existingCourse = courses.data?.find(
        (item) => normalizeCourseCode(item.code) === normalizeCourseCode(courseCode),
      );
      await apiRequest<CourseOutlineImportResult>(
        `/semesters/${currentSemester.id}/courses/import-outline`,
        {
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
        },
      );
      await courses.reload();
      return true;
    } catch (error) {
      setActionError(
        error instanceof ApiRequestError
          ? error.message
          : "DoNext could not import that course outline.",
      );
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  const totalMinutes = courses.data?.reduce(
    (sum, course) => sum + course.weekly_study_target_minutes,
    0,
  ) ?? 0;

  if (semesters.loading) return <PageLoading label="Loading your courses" />;
  if (semesters.error) return <PageError message={semesters.error} onRetry={semesters.reload} />;

  if (!currentSemester) {
    return (
      <main className="page-shell narrow-page">
        <header className="page-heading">
          <div><p className="eyebrow">First things first</p><h1>Set up your semester.</h1><p>Courses need a term so DoNext can understand the dates you are planning around.</p></div>
        </header>
        <section className="setup-card">
          <span className="setup-icon"><BookOpen size={23} /></span>
          <div><h2>Create your current semester</h2><p>You can change these details later.</p></div>
          <form className="stacked-form" onSubmit={createSemester}>
            <label><span>Semester name</span><input name="name" placeholder="Fall 2026" required /></label>
            <div className="form-row">
              <label><span>Start date</span><input name="start_date" type="date" defaultValue={todayDate()} required /></label>
              <label><span>End date</span><input name="end_date" type="date" defaultValue={yearEndDate()} required /></label>
            </div>
            {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
            <button className="primary-button" disabled={submitting} type="submit">
              {submitting ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}
              Create semester
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{currentSemester.name}</p>
          <h1>Courses</h1>
          <p>{courses.data?.length ?? 0} {(courses.data?.length ?? 0) === 1 ? "course" : "courses"} · {(totalMinutes / 60).toFixed(1)} hours of weekly study targets.</p>
        </div>
        <div className="heading-actions">
          {courses.data?.length && !outlineReviewActive ? (
            <button
              aria-pressed={outlineImporterOpen}
              className="secondary-button"
              type="button"
              onClick={() => setOutlineImporterOpen((current) => !current)}
            >
              <UploadCloud size={17} />
              {outlineImporterOpen ? "Close outline import" : "Add from outline"}
            </button>
          ) : null}
          <button className="primary-button" type="button" onClick={() => setCourseDialogOpen(true)}><Plus size={17} /> Add course</button>
        </div>
      </header>

      {actionError ? <p className="page-alert" role="alert">{actionError}</p> : null}
      {courses.loading && !outlineReviewActive ? <PageLoading label="Loading course details" /> : null}
      {courses.error ? <PageError message={courses.error} onRetry={courses.reload} /> : null}

      {outlineReviewActive || (!courses.loading && (courses.data?.length === 0 || outlineImporterOpen)) ? (
        <section className={`course-outline-empty${outlineReviewActive ? " reviewing" : ""}`}>
          {!outlineReviewActive ? (
            <div className="course-outline-empty-copy">
              <span><BookOpen size={25} /></span>
              <h2>{courses.data?.length ? "Add more courses from outlines." : "Add the courses competing for your time."}</h2>
              <p>Drop one or more course outlines and review each course before DoNext adds it.</p>
            </div>
          ) : null}
          <CourseOutlineStep
            busy={submitting}
            courses={courses.data ?? []}
            semester={currentSemester}
            showExistingCourses={false}
            showIntro={false}
            showManualEntry={false}
            tasks={[]}
            onCreateCourse={createCourse}
            onCreateItem={(event) => event.preventDefault()}
            onImport={importOutline}
            onRemoveCourse={() => undefined}
            onRemoveItem={() => undefined}
            onReviewActiveChange={handleOutlineReviewActiveChange}
          />
          {!outlineReviewActive ? (
            <div className="course-outline-manual-option">
              <span>or</span>
              <button className="secondary-button" type="button" onClick={() => {
                setOutlineImporterOpen(false);
                setCourseDialogOpen(true);
              }}><Plus size={17} /> Enter course manually</button>
            </div>
          ) : null}
        </section>
      ) : null}

      {courses.data && courses.data.length > 0 && !outlineImporterOpen && !outlineReviewActive ? (
        <section className="course-grid">
          {courses.data.map((course, index) => (
            <article className="course-card" key={course.id}>
              <div className="course-card-top">
                <span className={`course-symbol ${courseColors[index % courseColors.length]}`}><BookOpen size={20} /></span>
                <button className="quiet-icon-button" aria-label={`Remove ${course.code}`} type="button" onClick={() => void deleteCourse(course)}><Trash2 size={17} /></button>
              </div>
              <span className="course-code">{course.code}</span>
              <h2>{course.name}</h2>
              <div className="course-detail-list">
                <span><small>Weekly target</small><strong>{formatMinutes(course.weekly_study_target_minutes)}</strong></span>
                <span><small>Difficulty</small><strong>{course.difficulty} / 5</strong></span>
              </div>
              <div className="course-next"><span>Instructor</span><strong>{course.instructor || "Not added yet"}</strong><small>Course details can be refined anytime</small></div>
              <div className="course-card-footer"><span><Clock3 size={15} /> {formatMinutes(course.weekly_study_target_minutes)} each week</span><button type="button" onClick={() => setGradingCourse(course)}><Scale size={14} /> Grading & impact</button></div>
            </article>
          ))}
          <button className="add-course-card" type="button" onClick={() => setCourseDialogOpen(true)}><span><Plus size={22} /></span><strong>Add another course</strong><small>Build a complete picture of your semester</small></button>
        </section>
      ) : null}

      <FormDialog open={courseDialogOpen} onClose={() => setCourseDialogOpen(false)} title="Add a course" description={`Add the workload you expect during ${currentSemester.name}.`}>
        <form className="stacked-form" onSubmit={createCourse}>
          <div className="form-row"><label><span>Course code</span><input name="code" placeholder="CSC 320" required /></label><label><span>Course name</span><input name="name" placeholder="Algorithms" required /></label></div>
          <label><span>Instructor <small>Optional</small></span><input name="instructor" placeholder="Dr. Chen" /></label>
          <div className="form-row"><label><span>Difficulty</span><select name="difficulty" defaultValue="3"><option value="1">1 · Light</option><option value="2">2</option><option value="3">3 · Moderate</option><option value="4">4</option><option value="5">5 · Demanding</option></select></label><label><span>Weekly study target</span><select name="weekly_target" defaultValue="3"><option value="1">1 hour</option><option value="2">2 hours</option><option value="3">3 hours</option><option value="4">4 hours</option><option value="5">5 hours</option><option value="6">6 hours</option><option value="8">8 hours</option><option value="10">10 hours</option></select></label></div>
          {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
          <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setCourseDialogOpen(false)}>Cancel</button><button className="primary-button" disabled={submitting} type="submit">{submitting ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />} Save course</button></div>
        </form>
      </FormDialog>
      {gradingCourse ? <GradingEditor course={gradingCourse} open onClose={() => setGradingCourse(null)} onSaved={courses.reload} /> : null}
    </main>
  );
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
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

function PageLoading({ label }: { label: string }) {
  return <div className="page-status" role="status"><LoaderCircle className="spin" size={20} /><span>{label}</span></div>;
}

function PageError({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  return <section className="empty-state error-state"><h2>DoNext couldn’t load this yet.</h2><p>{message}</p><button className="secondary-button" type="button" onClick={() => void onRetry()}>Try again</button></section>;
}
