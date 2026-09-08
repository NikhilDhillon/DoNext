import { Suspense } from "react";

import type { Metadata } from "next";

import { MyLife } from "@/components/my-life";

export const metadata: Metadata = { title: "My Life" };

export default function MyLifePage() {
  return (
    <Suspense fallback={null}>
      <MyLife />
    </Suspense>
  );
}
