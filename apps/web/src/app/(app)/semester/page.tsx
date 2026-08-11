import type { Metadata } from "next";
import { SemesterPlanner } from "@/components/semester-planner";

export const metadata: Metadata = { title: "Semester" };

export default function SemesterPage() {
  return <SemesterPlanner />;
}
