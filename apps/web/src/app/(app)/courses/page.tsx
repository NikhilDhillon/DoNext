import type { Metadata } from "next";
import { ArrowUpRight, BookOpen, Clock3, MoreHorizontal, Plus } from "lucide-react";

import { courseCards } from "@/lib/fixtures";

export const metadata: Metadata = { title: "Courses" };

export default function CoursesPage() {
  return (
    <main className="page-shell">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Fall 2026</p>
          <h1>Courses</h1>
          <p>Four courses · 11.5 hours of study planned each week.</p>
        </div>
        <button className="primary-button" type="button"><Plus size={17} /> Add course</button>
      </header>

      <section className="course-grid">
        {courseCards.map((course) => (
          <article className="course-card" key={course.code}>
            <div className="course-card-top">
              <span className={`course-symbol ${course.color}`}><BookOpen size={20} /></span>
              <button aria-label={`More options for ${course.code}`} type="button"><MoreHorizontal size={19} /></button>
            </div>
            <span className="course-code">{course.code}</span>
            <h2>{course.name}</h2>
            <div className="course-progress-copy"><span>Weekly progress</span><strong>{course.progress}%</strong></div>
            <div className="progress-track"><span style={{ width: `${course.progress}%` }} /></div>
            <div className="course-next">
              <span>Next up</span>
              <strong>{course.next}</strong>
              <small>{course.due}</small>
            </div>
            <div className="course-card-footer">
              <span><Clock3 size={15} /> {course.target}</span>
              <button aria-label={`Open ${course.code}`} type="button"><ArrowUpRight size={17} /></button>
            </div>
          </article>
        ))}
        <button className="add-course-card" type="button">
          <span><Plus size={22} /></span><strong>Add another course</strong><small>Build a complete picture of your semester</small>
        </button>
      </section>
    </main>
  );
}
