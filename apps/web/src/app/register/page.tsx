"use client";

import { FormEvent, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
const API = API_URL.endsWith("/") ? API_URL.slice(0, -1) : API_URL;

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStatus("");
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(API + "/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password, organizationName }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(Array.isArray(body.message) ? body.message.join(" ") : body.message || "Account registration failed.");
      }
      setPassword("");
      setConfirmation("");
      setStatus(body.emailVerificationRequired
        ? "Your account was created. Check your email for a verification link before signing in."
        : "Your account was created. Return to sign in to continue.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Account registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="account-action-shell">
      <section className="account-action-card">
        <div className="account-action-kicker">SENTINELAI / SECURE ONBOARDING</div>
        <h1>Create your workspace</h1>
        <p>Register an owner account for your organization. In production, email verification is required before sign-in.</p>
        <form onSubmit={submit} className="account-action-form">
          <label htmlFor="register-name">Full name</label>
          <input id="register-name" autoComplete="name" required minLength={2} maxLength={100} value={name} onChange={event => setName(event.target.value)} />
          <label htmlFor="register-email">Work email</label>
          <input id="register-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} />
          <label htmlFor="register-organization">Organization name</label>
          <input id="register-organization" required minLength={2} maxLength={100} value={organizationName} onChange={event => setOrganizationName(event.target.value)} />
          <label htmlFor="register-password">Password (at least 12 characters)</label>
          <input id="register-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} />
          <label htmlFor="register-confirm">Confirm password</label>
          <input id="register-confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} />
          <button type="submit" disabled={busy}>{busy ? "Creating workspace…" : "Create secure account"}</button>
        </form>
        {error && <p className="account-action-status" role="alert">{error}</p>}
        {status && <p className="account-action-status" role="status">{status}</p>}
        <a className="account-action-link" href="/risk-assessments">Return to sign in</a>
        <a className="account-action-link" href="/verify-email">Resend verification email</a>
      </section>
    </main>
  );
}
