"use client";

import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { apiRequest, ApiRequestError } from "@/lib/api";

const MINIMUM_LENGTH = 12;

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");

    if (password !== String(form.get("confirmation") ?? "")) {
      setError("The two passwords do not match.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await apiRequest<{ message: string }>("/auth/password-reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      router.push("/login?reset=done");
    } catch (requestError) {
      setError(
        requestError instanceof ApiRequestError
          ? requestError.message
          : "The local API is unavailable. Start it and try again.",
      );
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-form">
        <p className="form-error" role="alert">
          This link is missing its reset token. Open the most recent link from your email, or ask
          for a new one.
        </p>
        <p className="auth-switch">
          <Link href="/forgot-password">Send another reset link</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label>
        <span>New password</span>
        <span className="password-field">
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            minLength={MINIMUM_LENGTH}
            placeholder={`At least ${MINIMUM_LENGTH} characters`}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </span>
      </label>
      <label>
        <span>Confirm new password</span>
        <input
          name="confirmation"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          minLength={MINIMUM_LENGTH}
          placeholder="Type it once more"
          required
        />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button auth-submit" type="submit" disabled={submitting}>
        {submitting ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}
        {submitting ? "Please wait" : "Set my new password"}
      </button>
      <p className="auth-switch">
        Setting a new password signs out every device.{" "}
        <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
