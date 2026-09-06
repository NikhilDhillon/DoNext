import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return <div className="auth-card"><p className="eyebrow">Locked out</p><h1>Let’s get you back to your plan.</h1><p className="auth-intro">Tell us the email on your account and we’ll send a link to set a new password.</p><ForgotPasswordForm /></div>;
}
