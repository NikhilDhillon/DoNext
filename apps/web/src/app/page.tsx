import { ArrowRight, BrainCircuit, CalendarCheck2, Check, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

import { Brand } from "@/components/brand";

export default function HomePage() {
  return (
    <main className="landing-page">
      <nav className="landing-nav"><Brand /><div><a href="#how-it-works">How it works</a><a href="#principles">Principles</a></div><div><Link className="nav-login" href="/login">Sign in</Link><Link className="nav-cta" href="/register">Start planning <ArrowRight size={16} /></Link></div></nav>
      <section className="hero-section">
        <div className="hero-copy">
          <span className="hero-kicker"><Sparkles size={15} /> Adaptive planning for student life</span>
          <h1>Know what to do next—<em>and what can wait.</em></h1>
          <p>DoNext creates a realistic plan across courses, work, goals, and rest. When life changes, your future adjusts without turning today upside down.</p>
          <div className="hero-actions"><Link className="primary-button" href="/register">Build my plan <ArrowRight size={17} /></Link><Link className="secondary-button" href="/today">Preview the workspace</Link></div>
          <div className="hero-trust"><span><Check size={14} /> Local-first Phase 1</span><span><Check size={14} /> No calendar required</span></div>
        </div>
        <div className="hero-visual" aria-label="Example DoNext daily plan">
          <div className="visual-toolbar"><div><span /><span /><span /></div><small>Monday, August 3</small><span className="visual-status">Sustainable</span></div>
          <div className="visual-greeting"><div><small>GOOD MORNING</small><strong>Your day has room to breathe.</strong></div><span>68%<small>allocated</small></span></div>
          <div className="visual-capacity"><span className="focus" /><span className="life" /><span className="buffer" /></div>
          <div className="visual-next"><span><Sparkles size={17} /></span><div><small>DO NEXT</small><strong>Algorithms lecture</strong><p>Starts in 35 minutes · ECS 125</p></div><ArrowRight size={18} /></div>
          <div className="visual-plan">
            <div className="visual-plan-title"><strong>Today’s plan</strong><small>4 commitments</small></div>
            {[{ time: "9:00", title: "Algorithms lecture", kind: "violet" }, { time: "11:00", title: "Problem set 3", kind: "mint" }, { time: "1:30", title: "Research methods lab", kind: "blue" }, { time: "4:15", title: "French practice", kind: "coral" }].map((item) => <div className="visual-plan-row" key={item.title}><time>{item.time}</time><i className={item.kind} /><span><strong>{item.title}</strong><small>50 min planned</small></span></div>)}
          </div>
        </div>
      </section>
      <section className="landing-principles" id="principles">
        <article><span><CalendarCheck2 size={22} /></span><h2>Realistic by default</h2><p>Capacity, sleep, transitions, and buffer are part of the plan—not afterthoughts.</p></article>
        <article><span><BrainCircuit size={22} /></span><h2>Deterministic decisions</h2><p>A constraint solver will place time. AI will interpret and explain, never guess your calendar.</p></article>
        <article><span><ShieldCheck size={22} /></span><h2>Change without chaos</h2><p>Replanning protects accepted work and makes every important trade-off reviewable.</p></article>
      </section>
    </main>
  );
}
