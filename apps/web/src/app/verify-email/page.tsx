"use client";

import { FormEvent, useEffect, useState } from "react";

const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1").replace(/\/$/, "");

export default function VerifyEmailPage() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("Checking your verification link…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("token") || "";
    setToken(value);
    if (!value) {
      setStatus("This verification link is missing its token. Request a fresh email below.");
      return;
    }
    let active = true;
    fetch(API + "/auth/email/verification/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: value }),
    }).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "This verification link is invalid or expired.");
      if (active) setStatus("Your email address is verified. You can now sign in.");
    }).catch(error => {
      if (active) setStatus(error instanceof Error ? error.message : "Verification could not be completed.");
    });
    return () => { active = false; };
  }, []);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(API + "/auth/email/verification/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "Unable to request a verification email.");
      setStatus(body.message || "If the account is eligible, an email with next steps will be sent.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to request a verification email.");
    } finally { setBusy(false); }
  }

  return (
    <main className="account-action-shell">
      <section className="account-action-card">
        <div className="account-action-kicker">SENTINELAI / ACCOUNT SECURITY</div>
        <h1>Email verification</h1>
        <p className="account-action-status" role="status">{status}</p>
        <form onSubmit={resend} className="account-action-form">
          <label htmlFor="verification-email">Need a fresh verification link?</label>
          <input id="verification-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@company.com" />
          <button type="submit" disabled={busy}>{busy ? "Sending…" : "Resend verification email"}</button>
        </form>
        <a className="account-action-link" href="/risk-assessments">Return to sign in</a>
      </section>
    </main>
  );
}
