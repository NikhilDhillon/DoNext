"use client";

import {
  BookOpen,
  CalendarDays,
  CircleUserRound,
  Flag,
  HeartPulse,
  LayoutDashboard,
  Plus,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { Brand } from "@/components/brand";
import { useApiResource } from "@/hooks/use-api-resource";
import type { PlanningView, Semester, User } from "@/lib/types";

const primaryNavigation = [
  { href: "/today", label: "Today", icon: LayoutDashboard },
  { href: "/week", label: "Week", icon: CalendarDays },
  { href: "/semester", label: "Semester", icon: Flag },
  { href: "/courses", label: "Courses", icon: BookOpen },
  { href: "/my-life", label: "My Life", icon: HeartPulse },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useApiResource<User>("/auth/me");
  const semesters = useApiResource<Semester[]>("/semesters");
  const { data: planningData, reload: reloadPlanning } = useApiResource<PlanningView>("/planning/day");
  const currentSemester = semesters.data?.find((semester) => semester.status === "active") ?? semesters.data?.[0] ?? null;
  const term = currentSemester ? semesterTerm(currentSemester) : null;
  const displayName = user.data?.name || "Your workspace";
  const firstName = displayName.split(" ")[0];
  const initials = displayName === "Your workspace"
    ? "—"
    : displayName.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();

  useEffect(() => {
    if (user.data && !user.data.onboarding_completed_at) {
      router.replace("/onboarding");
    }
  }, [router, user.data]);

  useEffect(() => {
    const refreshPlanning = () => void reloadPlanning();
    window.addEventListener("donext:planning-updated", refreshPlanning);
    return () => window.removeEventListener("donext:planning-updated", refreshPlanning);
  }, [reloadPlanning]);

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brand />
        </div>

        <div className="semester-status">
          <p className="semester-status-label">{currentSemester ? "Semester" : "First step"}</p>
          <p className="semester-status-name">{currentSemester?.name ?? "No semester yet"}</p>
          {term ? (
            <div className="semester-term">
              <div className="semester-term-rail">
                <span style={{ width: `${term.percent}%` }} />
              </div>
              <p>{term.label}</p>
            </div>
          ) : (
            <p className="semester-status-hint">
              {currentSemester ? "Add term dates to track progress" : "Set one up in Semester"}
            </p>
          )}
        </div>

        <nav className="side-nav" aria-label="Main navigation">
          <p>Plan</p>
          {primaryNavigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                href={item.href}
                className={active ? "active" : undefined}
                aria-current={active ? "page" : undefined}
                key={item.href}
              >
                <Icon size={19} strokeWidth={1.9} aria-hidden="true" />
                {item.label}
                {item.href === "/today" && Boolean(planningData?.entries.length) && (
                  <span className="nav-count">{planningData?.entries.length}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />
        <Link href="/settings" className="sidebar-settings">
          <Settings size={18} aria-hidden="true" />
          Settings
        </Link>
        <div className="profile-chip">
          <span>{initials}</span>
          <div>
            <strong>{firstName}</strong>
            <small>Local workspace</small>
          </div>
          <CircleUserRound size={18} aria-hidden="true" />
        </div>
      </aside>

      <div className="app-main">
        <header className="mobile-header">
          <Brand />
          <Link href="/courses" className="icon-button" aria-label="Add an item">
            <Plus size={20} />
          </Link>
        </header>
        {children}
      </div>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        {primaryNavigation.slice(0, 5).map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              href={item.href}
              className={active ? "active" : undefined}
              aria-current={active ? "page" : undefined}
              key={item.href}
            >
              <Icon size={20} strokeWidth={1.9} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

const DAY_MS = 86_400_000;
const WEEK_MS = DAY_MS * 7;

/** How far the active term has run, so the sidebar carries progress instead of a restated name. */
function semesterTerm(semester: Semester) {
  const start = new Date(`${semester.start_date}T00:00:00`).getTime();
  const end = new Date(`${semester.end_date}T23:59:59`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;

  const now = Date.now();
  if (now < start) {
    const days = Math.ceil((start - now) / DAY_MS);
    return { percent: 0, label: days === 1 ? "Starts tomorrow" : `Starts in ${days} days` };
  }
  if (now > end) return { percent: 100, label: "Term complete" };

  const totalWeeks = Math.max(1, Math.ceil((end - start) / WEEK_MS));
  const week = Math.min(totalWeeks, Math.floor((now - start) / WEEK_MS) + 1);
  return { percent: Math.round(((now - start) / (end - start)) * 100), label: `Week ${week} of ${totalWeeks}` };
}
