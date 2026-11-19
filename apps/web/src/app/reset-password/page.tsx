"use client";

import { FormEvent, useEffect, useState } from "react";

const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1").replace(/\/$/, "");

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState("Loading password reset link…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("token") || "";
    setToken(value);
    setStatus(value ? "Choose a new password. The link expires after 30 minutes." : "This reset link is missing its token. Request a new one.");
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      setStatus("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(API + "/auth/password/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(" ") : body.message || "Password reset failed.");
      setPassword("");
      setConfirmation("");
      setToken("");
      setStatus("Password updated. All existing sessions were revoked. Sign in again.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Password reset failed.");
    } finally { setBusy(false); }
  }

  return (
    <main className="account-action-shell">
      <section className="account-action-card">
        <div className="account-action-kicker">SENTINELAI / ACCOUNT SECURITY</div>
        <h1>Reset your password</h1>
        <p className="account-action-status" role="status">{status}</p>
        {token && <form onSubmit={submit} className="account-action-form">
          <label htmlFor="new-password">New password</label>
          <input id="new-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} />
          <label htmlFor="confirm-password">Confirm new password</label>
          <input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} />
          <button type="submit" disabled={busy}>{busy ? "Updating…" : "Update password"}</button>
        </form>}
        <a className="account-action-link" href="/forgot-password">Request another reset link</a>
        <a className="account-action-link" href="/risk-assessments">Return to sign in</a>
      </section>
    </main>
  );
}
