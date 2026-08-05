import type { Metadata } from "next";

import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return <div className="auth-card"><p className="eyebrow">Welcome back</p><h1>What should you do next?</h1><p className="auth-intro">Sign in to see today’s realistic plan.</p><AuthForm mode="login" /></div>;
}
