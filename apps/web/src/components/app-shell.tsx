"use client";

import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  CircleUserRound,
  Flag,
  LayoutDashboard,
  Plus,
  Settings,
  Sparkles,
  Target,
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
  { href: "/goals", label: "Goals", icon: Target },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useApiResource<User>("/auth/me");
  const semesters = useApiResource<Semester[]>("/semesters");
  const { data: planningData, reload: reloadPlanning } = useApiResource<PlanningView>("/planning/day");
  const currentSemester = semesters.data?.find((semester) => semester.status === "active") ?? semesters.data?.[0] ?? null;
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

  const todayCapacity = planningData?.days[0]?.capacity;

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brand />
        </div>

        <Link className="semester-switcher" href="/semester">
          <span className="semester-icon">{currentSemester ? semesterCode(currentSemester) : "NEW"}</span>
          <span>
            <small>{currentSemester ? "Current semester" : "First step"}</small>
            {currentSemester?.name ?? "Set up semester"}
          </span>
          <ChevronDown size={16} aria-hidden="true" />
        </Link>

        <nav className="side-nav" aria-label="Main navigation">
          <p>Plan</p>
          {primaryNavigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
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
        <div className="planner-note">
          <Sparkles size={18} aria-hidden="true" />
          <div>
            <strong>{todayCapacity ? "Today reflects your saved plan" : "Capacity needs your input"}</strong>
            <span>{todayCapacity ? `${formatMinutes(todayCapacity.remaining_focus_minutes)} focus time remains` : "Add availability in Settings"}</span>
          </div>
        </div>
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

function semesterCode(semester: Semester) {
  const start = new Date(`${semester.start_date}T12:00:00`);
  const season = start.getMonth() < 4 ? "W" : start.getMonth() < 8 ? "S" : "F";
  return `${season}${String(start.getFullYear()).slice(-2)}`;
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
