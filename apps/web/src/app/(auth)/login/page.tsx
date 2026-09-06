import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";

import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const justReset = (await searchParams).reset === "done";
  return <div className="auth-card"><p className="eyebrow">Welcome back</p><h1>What should you do next?</h1><p className="auth-intro">Sign in to see today’s realistic plan.</p>{justReset && <p className="form-notice"><CheckCircle2 size={17} aria-hidden="true" /><span><strong>Your password is set.</strong>Sign in with it to pick up where you left off.</span></p>}<AuthForm mode="login" /></div>;
}
