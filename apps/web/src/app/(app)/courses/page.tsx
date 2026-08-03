import type { Metadata } from "next";

import { CourseManager } from "@/components/course-manager";

export const metadata: Metadata = { title: "Courses" };

export default function CoursesPage() {
  return <CourseManager />;
}
