import type { Metadata } from "next";
import { WeekPlanner } from "@/components/week-planner";

export const metadata: Metadata = { title: "Week" };

export default function WeekPage() {
  return <WeekPlanner />;
}
