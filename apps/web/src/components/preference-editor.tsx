"use client";

import { AlertTriangle, Bell, Check, Clock3, LoaderCircle, MoonStar, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { FormDialog } from "@/components/form-dialog";
import { useApiResource } from "@/hooks/use-api-resource";
import { apiRequest, ApiRequestError } from "@/lib/api";
import type { Preferences } from "@/lib/types";

export function PreferenceEditor() {
  const router = useRouter();
  const preferences = useApiResource<Preferences>("/preferences");
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePhrase, setDeletePhrase] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!saved) return;
    const timeout = window.setTimeout(() => setSaved(false), 2400);
    return () => window.clearTimeout(timeout);
  }, [saved]);

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSaved(false);
    setActionError(null);
    const form = new FormData(event.currentTarget);
    try {
      const updated = await apiRequest<Preferences>("/preferences", {
        method: "PATCH",
        body: JSON.stringify({
          minimum_sleep_minutes: Number(form.get("minimum_sleep_hours")) * 60,
          preferred_sleep_minutes: Number(form.get("preferred_sleep_hours")) * 60,
          default_wake_time: form.get("default_wake_time"),
          default_sleep_time: form.get("default_sleep_time"),
          maximum_daily_focus_minutes: Number(form.get("maximum_daily_focus_minutes")),
          preferred_session_minutes: Number(form.get("preferred_session_minutes")),
          minimum_break_minutes: Number(form.get("minimum_break_minutes")),
          freeze_window_minutes: Number(form.get("freeze_window_hours")) * 60,
          preserve_free_time_percent: Number(form.get("preserve_free_time_percent")),
          auto_apply_low_impact_changes: form.get("auto_apply_low_impact_changes") === "on",
        }),
      });
      preferences.setData(updated);
      setSaved(true);
    } catch (error) {
      setActionError(error instanceof ApiRequestError ? error.message : "Could not save your preferences.");
    } finally {
      setSubmitting(false);
    }
  }

  function closeDeleteDialog() {
    if (deleting) return;
    setDeleteDialogOpen(false);
    setDeletePassword("");
    setDeletePhrase("");
    setDeleteError(null);
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deletePhrase !== "DELETE" || !deletePassword) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiRequest<void>("/auth/account", {
        method: "DELETE",
        body: JSON.stringify({ password: deletePassword, confirmation: deletePhrase }),
      });
      router.replace("/");
      router.refresh();
    } catch (error) {
      setDeleteError(error instanceof ApiRequestError ? error.message : "DoNext could not delete your account.");
      setDeleting(false);
    }
  }

  if (preferences.loading) return <main className="page-shell narrow-page"><div className="page-status" role="status"><LoaderCircle className="spin" size={20} /><span>Loading your boundaries</span></div></main>;
  if (preferences.error) return <main className="page-shell narrow-page"><section className="empty-state error-state"><h2>DoNext couldn’t load your settings.</h2><p>{preferences.error}</p><button className="secondary-button" type="button" onClick={() => void preferences.reload()}>Try again</button></section></main>;
  if (!preferences.data) return null;

  const value = preferences.data;

  return (
    <main className="page-shell narrow-page">
      <header className="page-heading"><div><p className="eyebrow">Your boundaries</p><h1>Planning preferences</h1><p>These rules constrain every generated schedule draft.</p></div></header>
      <form className="preference-form" onSubmit={savePreferences}>
        <section className="preference-section">
          <div className="preference-heading"><span><MoonStar size={20} /></span><div><h2>Sleep protection</h2><p>Sleep is a hard planning boundary, not spare capacity.</p></div></div>
          <div className="form-row"><label><span>Minimum sleep</span><select name="minimum_sleep_hours" defaultValue={value.minimum_sleep_minutes / 60}><option value="6">6 hours</option><option value="6.5">6.5 hours</option><option value="7">7 hours</option><option value="7.5">7.5 hours</option><option value="8">8 hours</option><option value="8.5">8.5 hours</option><option value="9">9 hours</option></select></label><label><span>Preferred sleep</span><select name="preferred_sleep_hours" defaultValue={value.preferred_sleep_minutes / 60}><option value="7">7 hours</option><option value="7.5">7.5 hours</option><option value="8">8 hours</option><option value="8.5">8.5 hours</option><option value="9">9 hours</option><option value="9.5">9.5 hours</option><option value="10">10 hours</option></select></label></div>
          <div className="form-row"><label><span>Typical bedtime</span><input name="default_sleep_time" type="time" defaultValue={value.default_sleep_time.slice(0, 5)} required /></label><label><span>Typical wake time</span><input name="default_wake_time" type="time" defaultValue={value.default_wake_time.slice(0, 5)} required /></label></div>
        </section>

        <section className="preference-section">
          <div className="preference-heading"><span><Clock3 size={20} /></span><div><h2>Focus rhythm</h2><p>Shape sessions around how you can actually concentrate.</p></div></div>
          <div className="form-row"><label><span>Preferred session</span><select name="preferred_session_minutes" defaultValue={value.preferred_session_minutes}><option value="25">25 minutes</option><option value="40">40 minutes</option><option value="45">45 minutes</option><option value="50">50 minutes</option><option value="60">60 minutes</option><option value="75">75 minutes</option><option value="90">90 minutes</option></select></label><label><span>Minimum break</span><select name="minimum_break_minutes" defaultValue={value.minimum_break_minutes}><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="20">20 minutes</option><option value="30">30 minutes</option></select></label></div>
          <label><span>Maximum focus per day</span><select name="maximum_daily_focus_minutes" defaultValue={value.maximum_daily_focus_minutes}><option value="180">3 hours</option><option value="240">4 hours</option><option value="300">5 hours</option><option value="360">6 hours</option><option value="420">7 hours</option><option value="480">8 hours</option><option value="600">10 hours</option></select></label>
        </section>

        <section className="preference-section">
          <div className="preference-heading"><span><ShieldCheck size={20} /></span><div><h2>Schedule stability</h2><p>Keep near-term commitments stable and preserve unscheduled breathing room.</p></div></div>
          <div className="form-row"><label><span>Freeze window</span><select name="freeze_window_hours" defaultValue={value.freeze_window_minutes / 60}><option value="0">No freeze window</option><option value="1">1 hour</option><option value="2">2 hours</option><option value="4">4 hours</option><option value="6">6 hours</option><option value="12">12 hours</option><option value="24">24 hours</option></select></label><label><span>Preserve as free time</span><select name="preserve_free_time_percent" defaultValue={value.preserve_free_time_percent}><option value="0">No minimum</option><option value="10">10%</option><option value="15">15%</option><option value="20">20%</option><option value="25">25%</option><option value="30">30%</option><option value="40">40%</option></select></label></div>
          <label className="checkbox-field"><input name="auto_apply_low_impact_changes" type="checkbox" defaultChecked={value.auto_apply_low_impact_changes} /><span><strong>Automatically apply low-impact changes</strong><small>Saved for a later phase. Phase 3 always requires your review.</small></span></label>
        </section>

        <section className="preference-section compact-section"><div className="preference-heading"><span><Bell size={20} /></span><div><h2>Reminders</h2><p>Notification controls will arrive with completion tracking.</p></div></div><span className="coming-soon-label">Phase 2</span></section>

        {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
        <div className="sticky-save"><span aria-live="polite">{saved ? <><Check size={16} /> Preferences saved</> : "Changes stay local to your DoNext account."}</span><button className="primary-button" disabled={submitting} type="submit">{submitting ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} {submitting ? "Saving" : "Save preferences"}</button></div>
      </form>

      <section className="preference-section danger-zone">
        <div className="preference-heading"><span><Trash2 size={20} /></span><div><h2>Delete account</h2><p>Permanently remove your account and everything you have added to DoNext.</p></div></div>
        <p className="danger-zone-copy">This deletes all semesters, courses, assignments, commitments, goals, preferences, and schedule history. It cannot be undone.</p>
        <button className="danger-button" type="button" onClick={() => setDeleteDialogOpen(true)}><Trash2 size={16} /> Delete my account</button>
      </section>

      <FormDialog open={deleteDialogOpen} onClose={closeDeleteDialog} title="Delete your DoNext account?" description="This permanently removes the account and all of its data.">
        <form className="stacked-form account-delete-form" onSubmit={deleteAccount}>
          <div className="account-delete-warning"><AlertTriangle size={19} /><div><strong>There is no recovery after this step.</strong><p>You will be signed out immediately and can create a new account to start over.</p></div></div>
          <label><span>Current password</span><input autoComplete="current-password" name="password" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.currentTarget.value)} required /></label>
          <label><span>Type DELETE to confirm</span><input autoComplete="off" name="confirmation" placeholder="DELETE" value={deletePhrase} onChange={(event) => setDeletePhrase(event.currentTarget.value)} required /></label>
          {deleteError ? <p className="form-error" role="alert">{deleteError}</p> : null}
          <div className="dialog-actions account-delete-actions"><button className="secondary-button" disabled={deleting} type="button" onClick={closeDeleteDialog}>Cancel</button><button className="danger-button" disabled={deleting || !deletePassword || deletePhrase !== "DELETE"} type="submit">{deleting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />} {deleting ? "Deleting account" : "Permanently delete account"}</button></div>
        </form>
      </FormDialog>
    </main>
  );
}
