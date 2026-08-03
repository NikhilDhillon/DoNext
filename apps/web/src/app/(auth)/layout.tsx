import { Check, MoonStar, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="auth-story-top"><Brand /><Link href="/">Back to overview</Link></div>
        <div className="auth-story-copy">
          <span className="story-kicker"><Sparkles size={15} /> A plan that tells the truth</span>
          <h1>Make progress without scheduling every minute.</h1>
          <p>DoNext balances deadlines, classes, goals, and rest—then shows the trade-offs when everything cannot fit.</p>
          <ul>
            <li><span><Check size={15} /></span>Protect sleep and non-negotiable time</li>
            <li><span><Check size={15} /></span>Keep enough buffer for real life</li>
            <li><span><Check size={15} /></span>Understand why your plan changed</li>
          </ul>
        </div>
        <div className="auth-principles">
          <div><MoonStar size={18} /><span><strong>8 hours</strong>Sleep protected</span></div>
          <div><ShieldCheck size={18} /><span><strong>15%</strong>Weekly buffer</span></div>
        </div>
      </section>
      <section className="auth-panel">{children}</section>
    </main>
  );
}
