import type { Metadata } from "next";
import {
  ArrowRight,
  BatteryMedium,
  Check,
  ChevronRight,
  Clock3,
  Coffee,
  MoreHorizontal,
  Play,
  Sparkles,
} from "lucide-react";

import { todayBlocks } from "@/lib/fixtures";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() {
  return (
    <main className="page-shell today-page">
      <header className="page-heading today-heading">
        <div>
          <p className="eyebrow">Monday, August 3</p>
          <h1>Good morning, Nikhil.</h1>
          <p>Your day is focused, with enough room to recover.</p>
        </div>
        <div className="heading-actions">
          <button className="secondary-button" type="button">
            <MoreHorizontal size={18} />
            Adjust day
          </button>
          <button className="primary-button" type="button">
            <Play size={17} fill="currentColor" />
            Start next
          </button>
        </div>
      </header>

      <section className="day-overview" aria-label="Day overview">
        <div className="capacity-card">
          <div className="capacity-topline">
            <span className="status-pill calm">
              <span /> Sustainable day
            </span>
            <span className="muted-label">68% allocated</span>
          </div>
          <div className="capacity-copy">
            <div>
              <strong>5h 10m</strong>
              <span>planned focus</span>
            </div>
            <div>
              <strong>3h 20m</strong>
              <span>buffer & free time</span>
            </div>
            <div>
              <strong>8h</strong>
              <span>protected sleep</span>
            </div>
          </div>
          <div className="capacity-track" aria-label="68 percent of flexible time allocated">
            <span className="capacity-focus" />
            <span className="capacity-life" />
            <span className="capacity-buffer" />
          </div>
          <div className="capacity-legend">
            <span><i className="focus-dot" /> Focus</span>
            <span><i className="life-dot" /> Commitments</span>
            <span><i className="buffer-dot" /> Buffer</span>
          </div>
        </div>

        <div className="next-card">
          <div className="next-card-icon">
            <Sparkles size={21} />
          </div>
          <div>
            <p>Do next</p>
            <h2>Algorithms lecture</h2>
            <span>Starts in 35 minutes · ECS 125</span>
          </div>
          <button aria-label="View Algorithms lecture" type="button">
            <ArrowRight size={20} />
          </button>
        </div>
      </section>

      <div className="today-grid">
        <section className="agenda-panel">
          <div className="section-heading">
            <div>
              <h2>Today’s plan</h2>
              <p>Four commitments · three focus transitions</p>
            </div>
            <button className="text-button" type="button">View timeline</button>
          </div>

          <div className="agenda-list">
            {todayBlocks.map((block, index) => (
              <article className={`agenda-row ${block.status}`} key={block.title}>
                <div className="agenda-time">
                  <strong>{block.time}</strong>
                  <span>{block.meridiem}</span>
                </div>
                <div className="agenda-line" aria-hidden="true">
                  <span className={block.kind} />
                  {index < todayBlocks.length - 1 && <i />}
                </div>
                <div className="agenda-content">
                  <div>
                    {block.status === "up-next" && <span className="up-next-label">Up next</span>}
                    <h3>{block.title}</h3>
                    <p>{block.detail}</p>
                  </div>
                  <span className="duration"><Clock3 size={14} /> {block.duration}</span>
                  <button aria-label={`More options for ${block.title}`} type="button">
                    <MoreHorizontal size={19} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="today-aside">
          <section className="focus-card">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">Focus check</p>
                <h2>Keep these moving</h2>
              </div>
              <BatteryMedium size={22} />
            </div>
            <ul className="priority-list">
              <li>
                <span className="check-ring"><Check size={13} /></span>
                <div><strong>Problem set 3</strong><small>50 of 150 min planned</small></div>
                <ChevronRight size={17} />
              </li>
              <li>
                <span className="check-ring" />
                <div><strong>Literature review</strong><small>Due in 8 days</small></div>
                <ChevronRight size={17} />
              </li>
              <li>
                <span className="check-ring" />
                <div><strong>French practice</strong><small>2 of 3 sessions this week</small></div>
                <ChevronRight size={17} />
              </li>
            </ul>
          </section>

          <section className="insight-card">
            <div className="insight-icon"><Coffee size={20} /></div>
            <div>
              <p className="eyebrow">Protected on purpose</p>
              <h3>Your evening stays free</h3>
              <p>The plan leaves everything after 5:00 PM open and keeps 45 minutes of buffer.</p>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
