"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { CommitmentsPanel } from "@/components/my-life/commitments-panel";
import { FocusBoundariesPanel } from "@/components/my-life/focus-boundaries-panel";

type Tab = "commitments" | "focus";

const TABS: [Tab, string][] = [
  ["commitments", "Commitments & goals"],
  ["focus", "Focus & boundaries"],
];

export function MyLife() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab: Tab = searchParams.get("tab") === "focus" ? "focus" : "commitments";
  const [tab, setTab] = useState<Tab>(initialTab);

  function selectTab(next: Tab) {
    setTab(next);
    const query = next === "focus" ? "?tab=focus" : "";
    router.replace(`/my-life${query}`, { scroll: false });
  }

  return (
    <main className="page-shell narrow-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Your life, in one place</p>
          <h1>My Life</h1>
          <p>
            Manage work, the gym, appointments, personal goals, and the focus hours DoNext plans
            around. Classes and coursework stay in Courses.
          </p>
        </div>
      </header>

      <div className="my-life-tabs" role="tablist" aria-label="My Life sections">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "active" : undefined}
            onClick={() => selectTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Both panels stay mounted so unsaved edits survive a tab switch. */}
      <div hidden={tab !== "commitments"}>
        <CommitmentsPanel />
      </div>
      <div hidden={tab !== "focus"}>
        <FocusBoundariesPanel />
      </div>
    </main>
  );
}
