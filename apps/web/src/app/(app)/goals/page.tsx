import type { Metadata } from "next";
import { ArrowUpRight, Flame, MoreHorizontal, Plus, Sprout } from "lucide-react";

import { goals } from "@/lib/fixtures";

export const metadata: Metadata = { title: "Goals" };

export default function GoalsPage() {
  return (
    <main className="page-shell">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Beyond the syllabus</p>
          <h1>Goals that still fit your life.</h1>
          <p>DoNext protects steady progress, then shifts to maintenance when school gets heavy.</p>
        </div>
        <button className="primary-button" type="button"><Plus size={17} /> Add goal</button>
      </header>

      <section className="goal-summary-card">
        <div className="goal-summary-icon"><Sprout size={24} /></div>
        <div><p className="eyebrow">This week</p><h2>You’re building consistency without borrowing from sleep.</h2></div>
        <div className="goal-summary-stat"><strong>4h</strong><span>planned across 3 goals</span></div>
      </section>

      <section className="goals-list">
        {goals.map((goal) => {
          const percent = Math.round((goal.current / goal.target) * 100);
          return (
            <article className="goal-card" key={goal.name}>
              <div className={`goal-orb ${goal.color}`}><span style={{ "--progress": `${percent * 3.6}deg` } as React.CSSProperties}>{percent}%</span></div>
              <div className="goal-main">
                <span className="goal-category">{goal.category}</span>
                <h2>{goal.name}</h2>
                <p>{goal.cadence}</p>
                <div className="goal-progress-row"><div className="progress-track"><span style={{ width: `${percent}%` }} /></div><span>{goal.current} / {goal.target} min</span></div>
              </div>
              <div className="goal-rhythm"><Flame size={16} /><span>{goal.streak}</span></div>
              <button aria-label={`More options for ${goal.name}`} type="button"><MoreHorizontal size={19} /></button>
            </article>
          );
        })}
      </section>

      <section className="maintenance-note">
        <div><strong>Maintenance mode is ready when you need it.</strong><p>During a busy week, flexible goals can shrink to their minimum without disappearing.</p></div>
        <button type="button">Review goal flexibility <ArrowUpRight size={16} /></button>
      </section>
    </main>
  );
}
