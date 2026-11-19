"use client";

import { FormEvent, useState } from "react";

const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1").replace(/\/$/, "");

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(API + "/auth/password/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "Unable to request a password reset.");
      setStatus(body.message || "If the account is eligible, an email with next steps will be sent.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to request a password reset.");
    } finally { setBusy(false); }
  }

  return (
    <main className="account-action-shell">
      <section className="account-action-card">
        <div className="account-action-kicker">SENTINELAI / ACCOUNT SECURITY</div>
        <h1>Forgot your password?</h1>
        <p>Enter your account email. If it is eligible, we will send a one-time reset link that expires after 30 minutes.</p>
        <form onSubmit={submit} className="account-action-form">
          <label htmlFor="reset-email">Email address</label>
          <input id="reset-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" />
          <button type="submit" disabled={busy}>{busy ? "Requesting…" : "Send reset link"}</button>
        </form>
        {status && <p className="account-action-status" role="status">{status}</p>}
        <a className="account-action-link" href="/risk-assessments">Return to sign in</a>
      </section>
    </main>
  );
}
