import type { Metadata } from "next";
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";

export const metadata: Metadata = { title: "Week" };

const days = [
  { day: "Mon", date: "3", load: "Balanced" },
  { day: "Tue", date: "4", load: "Focused" },
  { day: "Wed", date: "5", load: "Light" },
  { day: "Thu", date: "6", load: "Busy" },
  { day: "Fri", date: "7", load: "Balanced" },
];

const weekBlocks = [
  { day: 0, top: 1, span: 2, title: "Algorithms", meta: "9:00 · ECS 125", type: "violet" },
  { day: 0, top: 4, span: 1, title: "Problem set 3", meta: "11:00 · Focus", type: "mint" },
  { day: 1, top: 2, span: 2, title: "Research methods", meta: "10:00 · Lecture", type: "blue" },
  { day: 1, top: 6, span: 2, title: "Work shift", meta: "2:00 · Campus cafe", type: "slate" },
  { day: 2, top: 1, span: 1, title: "French", meta: "9:00 · Practice", type: "coral" },
  { day: 2, top: 4, span: 2, title: "Economics reading", meta: "11:00 · Focus", type: "amber" },
  { day: 3, top: 2, span: 2, title: "Algorithms", meta: "10:00 · ECS 125", type: "violet" },
  { day: 3, top: 5, span: 2, title: "Literature review", meta: "12:30 · Deep work", type: "mint" },
  { day: 4, top: 3, span: 2, title: "Writing seminar", meta: "10:30 · CLE A127", type: "coral" },
  { day: 4, top: 6, span: 1, title: "Weekly reset", meta: "2:00 · Planning", type: "blue" },
];

export default function WeekPage() {
  return (
    <main className="page-shell">
      <header className="page-heading week-heading">
        <div>
          <p className="eyebrow">August 3–9</p>
          <h1>Your week</h1>
          <p>Twenty-four focused hours with 15% protected buffer.</p>
        </div>
        <div className="heading-actions">
          <div className="date-controls">
            <button aria-label="Previous week" type="button"><ChevronLeft size={18} /></button>
            <button type="button">This week</button>
            <button aria-label="Next week" type="button"><ChevronRight size={18} /></button>
          </div>
          <button className="secondary-button" type="button"><SlidersHorizontal size={17} /> Preferences</button>
        </div>
      </header>

      <section className="week-summary">
        <div><span className="summary-icon violet" /> <strong>12h 20m</strong><small>Classes</small></div>
        <div><span className="summary-icon mint" /> <strong>9h 40m</strong><small>Focused work</small></div>
        <div><span className="summary-icon coral" /> <strong>2h 30m</strong><small>Personal goals</small></div>
        <div><span className="summary-icon outline" /> <strong>6h 15m</strong><small>Open capacity</small></div>
      </section>

      <section className="calendar-card" aria-label="Weekly calendar">
        <div className="calendar-header">
          <div className="timezone">PDT</div>
          {days.map((day, index) => (
            <div className={index === 0 ? "today" : undefined} key={day.day}>
              <span>{day.day}</span><strong>{day.date}</strong><small>{day.load}</small>
            </div>
          ))}
        </div>
        <div className="calendar-body">
          <div className="time-axis">
            {["8 AM", "9 AM", "10 AM", "11 AM", "12 PM", "1 PM", "2 PM", "3 PM", "4 PM", "5 PM"].map((time) => <span key={time}>{time}</span>)}
          </div>
          <div className="calendar-grid">
            {days.map((day) => <div className="day-column" key={day.day} />)}
            {weekBlocks.map((block) => (
              <article
                className={`week-block ${block.type}`}
                style={{
                  gridColumn: block.day + 1,
                  gridRow: `${block.top + 1} / span ${block.span}`,
                }}
                key={`${block.day}-${block.title}`}
              >
                <strong>{block.title}</strong><span>{block.meta}</span>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
