import type { Metadata } from "next";
import { Suspense } from "react";

import { ResetPasswordForm } from "@/components/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return <div className="auth-card"><p className="eyebrow">Almost there</p><h1>Choose a new password.</h1><p className="auth-intro">Pick something you have not used elsewhere. This link works once.</p><Suspense fallback={<p className="auth-intro">Checking your link…</p>}><ResetPasswordForm /></Suspense></div>;
}
