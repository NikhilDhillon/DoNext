"use client";

import { CalendarDays, Clock3, GraduationCap, Plus, Trash2 } from "lucide-react";
import type { FormEvent } from "react";

import type { Course, FixedEvent, Semester } from "@/lib/types";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type ClassScheduleStepProps = {
  semester: Semester;
  courses: Course[];
  events: FixedEvent[];
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRemove: (id: string) => void;
};

export function ClassScheduleStep({ semester, courses, events, busy, onSubmit, onRemove }: ClassScheduleStepProps) {
  const classEvents = events
    .filter((event) => event.category === "class")
    .sort((left, right) => {
      const leftStart = new Date(left.start_at);
      const rightStart = new Date(right.start_at);
      const leftDay = (leftStart.getDay() + 6) % 7;
      const rightDay = (rightStart.getDay() + 6) % 7;
      return leftDay - rightDay || leftStart.getHours() - rightStart.getHours() || leftStart.getMinutes() - rightStart.getMinutes();
    });

  return (
    <>
      <header className="onboarding-step-heading">
        <div><p className="eyebrow">Your weekly timetable</p><span>Fast multi-day entry</span></div>
        <h2>When are your classes?</h2>
        <p>Imported meeting times are already here. For anything missing, choose a course, select every day it meets, and enter the time once.</p>
      </header>

      {classEvents.length ? <section className="class-schedule-list">
        <div className="proposal-section-title"><strong>Weekly classes</strong><small>{classEvents.length} recurring meetings</small></div>
        {classEvents.map((event) => <article key={event.id}><span><GraduationCap size={17} /></span><div><strong>{event.title}</strong><small>{formatEvent(event)}{event.location ? ` · ${event.location}` : ""}</small></div><button aria-label={`Remove ${event.title}`} type="button" onClick={() => onRemove(event.id)}><Trash2 size={16} /></button></article>)}
      </section> : <div className="class-schedule-empty"><CalendarDays size={21} /><div><strong>No class times added yet</strong><p>Add your lectures, labs, or tutorials below. Asynchronous courses can be left without a fixed time.</p></div></div>}

      <form className="onboarding-form class-schedule-form" onSubmit={onSubmit}>
        <div className="form-row">
          <label><span>Course</span><select name="course_id" required>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} · {course.name}</option>)}</select></label>
          <label><span>Meeting type</span><select name="meeting_type" defaultValue="Lecture"><option>Lecture</option><option>Lab</option><option>Tutorial</option><option>Seminar</option><option>Studio</option></select></label>
        </div>

        <fieldset className="class-day-picker">
          <legend>Meets on</legend>
          {days.map((day, index) => <label key={day}><input name={`class_day_${index}`} type="checkbox" /><span>{day.slice(0, 3)}</span></label>)}
        </fieldset>

        <div className="form-row">
          <label><span>Starts</span><input name="start_time" type="time" required /></label>
          <label><span>Ends</span><input name="end_time" type="time" required /></label>
        </div>
        <label><span>Location <small>Optional</small></span><input name="location" placeholder="ECS 125 or online" /></label>
        <div className="form-row">
          <label><span>Travel before</span><select name="commute_before" defaultValue="0"><option value="0">None</option><option value="10">10 min</option><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">1 hour</option></select></label>
          <label><span>Travel after</span><select name="commute_after" defaultValue="0"><option value="0">None</option><option value="10">10 min</option><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">1 hour</option></select></label>
        </div>
        <button className="secondary-button form-submit" disabled={busy || !courses.length} type="submit"><Plus size={17} /> Add weekly classes</button>
      </form>

      <div className="schedule-tip"><Clock3 size={17} /><p><strong>Why this is faster:</strong> a Monday/Wednesday/Friday lecture takes one form, not three. DoNext creates each locked recurring meeting through {semester.name}.</p></div>
    </>
  );
}

function formatEvent(event: FixedEvent) {
  const starts = new Date(event.start_at);
  const ends = new Date(event.end_at);
  const day = starts.toLocaleDateString("en-CA", { weekday: "long" });
  const start = starts.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
  const end = ends.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${start}–${end}${event.recurrence_rule ? " · Weekly" : ""}`;
}
