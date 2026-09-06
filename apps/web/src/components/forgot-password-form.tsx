"use client";

import { ArrowRight, LoaderCircle, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

import { apiRequest, ApiRequestError } from "@/lib/api";

export function ForgotPasswordForm() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    try {
      await apiRequest<{ message: string }>("/auth/password-reset", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email") }),
      });
      setRequested(true);
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : "The local API is unavailable. Start it and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (requested) {
    return (
      <div className="auth-form">
        <p className="form-notice">
          <MailCheck size={17} aria-hidden="true" />
          <span>
            <strong>Check your email.</strong>
            If that address has an account, a reset link is on its way. It expires in an hour and
            works once.
          </span>
        </p>
        <p className="auth-switch">
          Nothing arrived?{" "}
          <button type="button" className="link-button" onClick={() => setRequested(false)}>
            Try another address
          </button>
        </p>
        <p className="auth-switch">
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>
        <span>Email</span>
        <input name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button auth-submit" type="submit" disabled={submitting}>
        {submitting ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}
        {submitting ? "Please wait" : "Send me a reset link"}
      </button>
      <p className="auth-switch">
        Remembered it? <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
