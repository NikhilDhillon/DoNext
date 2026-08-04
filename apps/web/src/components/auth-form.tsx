"use client";

import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { apiRequest, ApiRequestError } from "@/lib/api";
import type { User } from "@/lib/types";

type AuthMode = "login" | "register";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    const body =
      mode === "register"
        ? {
            name: form.get("name"),
            email: form.get("email"),
            password: form.get("password"),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }
        : { email: form.get("email"), password: form.get("password") };

    try {
      const user = await apiRequest<User>(mode === "register" ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
      });
      router.push(user.onboarding_completed_at ? "/today" : "/onboarding");
      router.refresh();
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

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      {mode === "register" && (
        <label>
          <span>Name</span>
          <input name="name" type="text" autoComplete="name" placeholder="Nikhil Dhillon" required />
        </label>
      )}
      <label>
        <span>Email</span>
        <input name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
      </label>
      <label>
        <span>Password</span>
        <span className="password-field">
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            minLength={mode === "register" ? 12 : undefined}
            placeholder={mode === "register" ? "At least 12 characters" : "Your password"}
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
      {mode === "login" ? <p className="forgot-link">Password reset is coming after local authentication.</p> : null}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button auth-submit" type="submit" disabled={submitting}>
        {submitting ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}
        {submitting ? "Please wait" : mode === "register" ? "Create my workspace" : "Continue to my plan"}
      </button>
      <p className="auth-switch">
        {mode === "register" ? "Already have an account?" : "New to DoNext?"}{" "}
        <Link href={mode === "register" ? "/login" : "/register"}>
          {mode === "register" ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
