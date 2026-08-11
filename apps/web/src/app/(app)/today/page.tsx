import type { Metadata } from "next";
import { TodayPlanner } from "@/components/today-planner";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() {
  return <TodayPlanner />;
}
