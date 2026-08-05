import type { Metadata } from "next";
import { AlertTriangle, ArrowUpRight, CalendarRange, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = { title: "Semester" };

const weeks = [34, 46, 52, 65, 48, 72, 88, 64, 92, 75, 58, 82, 68, 40, 26];

export default function SemesterPage() {
  return (
    <main className="page-shell">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Fall 2026 · 15 weeks</p>
          <h1>See the semester before it gets busy.</h1>
          <p>Your workload is sustainable overall, with two weeks worth preparing for now.</p>
        </div>
        <button className="secondary-button" type="button"><CalendarRange size={18} /> Edit semester</button>
      </header>

      <section className="semester-metrics">
        <article><span>Required work</span><strong>168h</strong><small>Across 4 courses</small></article>
        <article><span>Open capacity</span><strong>42h</strong><small>After protected buffer</small></article>
        <article><span>Upcoming deadlines</span><strong>11</strong><small>Next 30 days</small></article>
        <article className="good"><span>Plan health</span><strong>Good</strong><small><CheckCircle2 size={14} /> No impossible weeks</small></article>
      </section>

      <section className="load-card">
        <div className="section-heading">
          <div><h2>Weekly load</h2><p>Expected demand as a share of realistic capacity</p></div>
          <div className="load-legend"><span><i /> Planned</span><span><i /> Risk threshold</span></div>
        </div>
        <div className="load-chart" aria-label="Semester weekly workload chart">
          <div className="risk-line"><span>Risk threshold</span></div>
          {weeks.map((load, index) => (
            <div className="load-week" key={index}>
              <span className={load >= 85 ? "risk" : undefined} style={{ height: `${load}%` }} />
              <small>W{index + 1}</small>
            </div>
          ))}
        </div>
      </section>

      <div className="semester-grid">
        <section className="deadline-card">
          <div className="section-heading"><div><h2>Important dates</h2><p>Milestones shaping your plan</p></div><button className="text-button" type="button">View all</button></div>
          <div className="deadline-list">
            <article><time><strong>14</strong><span>SEP</span></time><div><h3>Problem set 3</h3><p>CSC 320 · 15% of course grade</p></div><span className="risk-badge low">On track</span></article>
            <article><time><strong>18</strong><span>SEP</span></time><div><h3>Literature review</h3><p>PSYC 201 · 1,500 words</p></div><span className="risk-badge medium">Start soon</span></article>
            <article><time><strong>02</strong><span>OCT</span></time><div><h3>Microeconomics midterm</h3><p>ECON 245 · 25% of course grade</p></div><span className="risk-badge low">Planned</span></article>
          </div>
        </section>
        <aside className="risk-card">
          <div className="risk-card-icon"><AlertTriangle size={20} /></div>
          <p className="eyebrow">Look ahead</p>
          <h2>Week 9 needs attention</h2>
          <p>Two major deadlines and a work shift bring you close to capacity.</p>
          <button type="button">See what can move <ArrowUpRight size={16} /></button>
        </aside>
      </div>
    </main>
  );
}
