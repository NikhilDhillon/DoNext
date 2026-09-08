"use client";

import { AlertTriangle, ArrowRight, LoaderCircle, SlidersHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { FormDialog } from "@/components/form-dialog";
import { apiRequest, ApiRequestError } from "@/lib/api";

export function PreferenceEditor() {
  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletePhrase, setDeletePhrase] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
      setDeleteError(
        error instanceof ApiRequestError ? error.message : "DoNext could not delete your account.",
      );
      setDeleting(false);
    }
  }

  return (
    <main className="page-shell narrow-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Your account</p>
          <h1>Settings</h1>
          <p>Account controls live here. Planning boundaries moved into My Life.</p>
        </div>
      </header>

      <Link href="/my-life?tab=focus" className="preference-section settings-link-card">
        <div className="preference-heading">
          <span>
            <SlidersHorizontal size={20} />
          </span>
          <div>
            <h2>Focus &amp; boundaries</h2>
            <p>Focus hours, session length, sleep, freeze window, and remembered preferences.</p>
          </div>
        </div>
        <span className="settings-link-cta">
          Open My Life <ArrowRight size={16} />
        </span>
      </Link>

      <section className="preference-section danger-zone">
        <div className="preference-heading">
          <span>
            <Trash2 size={20} />
          </span>
          <div>
            <h2>Delete account</h2>
            <p>Permanently remove your account and everything you have added to DoNext.</p>
          </div>
        </div>
        <p className="danger-zone-copy">
          This deletes all semesters, courses, assignments, commitments, goals, preferences, and
          schedule history. It cannot be undone.
        </p>
        <button className="danger-button" type="button" onClick={() => setDeleteDialogOpen(true)}>
          <Trash2 size={16} /> Delete my account
        </button>
      </section>

      <FormDialog
        open={deleteDialogOpen}
        onClose={closeDeleteDialog}
        title="Delete your DoNext account?"
        description="This permanently removes the account and all of its data."
      >
        <form className="stacked-form account-delete-form" onSubmit={deleteAccount}>
          <div className="account-delete-warning">
            <AlertTriangle size={19} />
            <div>
              <strong>There is no recovery after this step.</strong>
              <p>You will be signed out immediately and can create a new account to start over.</p>
            </div>
          </div>
          <label>
            <span>Current password</span>
            <input
              autoComplete="current-password"
              name="password"
              type="password"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.currentTarget.value)}
              required
            />
          </label>
          <label>
            <span>Type DELETE to confirm</span>
            <input
              autoComplete="off"
              name="confirmation"
              placeholder="DELETE"
              value={deletePhrase}
              onChange={(event) => setDeletePhrase(event.currentTarget.value)}
              required
            />
          </label>
          {deleteError ? (
            <p className="form-error" role="alert">
              {deleteError}
            </p>
          ) : null}
          <div className="dialog-actions account-delete-actions">
            <button className="secondary-button" disabled={deleting} type="button" onClick={closeDeleteDialog}>
              Cancel
            </button>
            <button
              className="danger-button"
              disabled={deleting || !deletePassword || deletePhrase !== "DELETE"}
              type="submit"
            >
              {deleting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
              {deleting ? "Deleting account" : "Permanently delete account"}
            </button>
          </div>
        </form>
      </FormDialog>
    </main>
  );
}
