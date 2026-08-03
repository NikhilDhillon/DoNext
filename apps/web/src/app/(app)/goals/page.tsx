import type { Metadata } from "next";

import { GoalManager } from "@/components/goal-manager";

export const metadata: Metadata = { title: "Goals" };

export default function GoalsPage() {
  return <GoalManager />;
}
