import type { Metadata } from "next";

import { PreferenceEditor } from "@/components/preference-editor";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return <PreferenceEditor />;
}
