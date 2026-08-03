import type { Metadata } from "next";
import { Bell, Clock3, MoonStar, ShieldCheck } from "lucide-react";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <main className="page-shell narrow-page">
      <header className="page-heading"><div><p className="eyebrow">Your boundaries</p><h1>Planning preferences</h1><p>These rules will guide automatic schedules in the next phase.</p></div></header>
      <section className="settings-list">
        <article><span><MoonStar size={20} /></span><div><h2>Sleep protection</h2><p>Minimum 7 hours · Prefer 8 hours</p></div><button type="button">Edit</button></article>
        <article><span><Clock3 size={20} /></span><div><h2>Focus sessions</h2><p>Prefer 50 minutes · Maximum 2 hours</p></div><button type="button">Edit</button></article>
        <article><span><ShieldCheck size={20} /></span><div><h2>Freeze window</h2><p>Do not move plans in the next 4 hours</p></div><button type="button">Edit</button></article>
        <article><span><Bell size={20} /></span><div><h2>Reminders</h2><p>Quiet hours from 10:00 PM to 8:00 AM</p></div><button type="button">Edit</button></article>
      </section>
    </main>
  );
}
