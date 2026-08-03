import type { Metadata } from "next";

import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create an account" };

export default function RegisterPage() {
  return <div className="auth-card"><p className="eyebrow">Start calmly</p><h1>Build a plan around your actual life.</h1><p className="auth-intro">Your first workspace stays local while we build Phase 1.</p><AuthForm mode="register" /></div>;
}
