"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Assessment = {
  id: string; title: string; status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED";
  residualLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; inherentScore: number; residualScore: number;
  scoringVersion: string; createdAt: string; submittedAt?: string | null; reviewRationale?: string | null;
  asset: { id: string; name: string; assetType: string };
};
type Profile = { user: { name: string; email: string }; organization: { name: string; slug: string }; role: string };
const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1").replace(/\/$/, "");

export default function RiskAssessmentsPage() {
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [items, setItems] = useState<Assessment[]>([]);
  const [status, setStatus] = useState("");
  const [level, setLevel] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const api = useCallback(async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `Request failed (${response.status})`);
    return body;
  }, [token]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (level) params.set("residualLevel", level);
    const result = await api(`/risk-assessments?${params.toString()}`);
    setItems(result.data || []);
  }, [api, status, level]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    api("/auth/me").then((data) => { if (active) setProfile(data); })
      .then(() => load())
      .catch((err: Error) => { if (active) { setError(err.message); setToken(""); setProfile(null); } });
    return () => { active = false; };
  }, [token, api, load]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await fetch(`${API}/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, ...(workspace ? { organizationSlug: workspace } : {}) }),
      });
      const data = await result.json().catch(() => ({}));
      if (!result.ok) throw new Error(data.message || "Unable to sign in.");
      setToken(data.accessToken); setPassword("");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to sign in."); }
    finally { setBusy(false); }
  }

  async function transition(id: string, action: "submit" | "decision", decision?: "APPROVED" | "REJECTED") {
    setBusy(true); setError(""); setMessage("");
    try {
      const body = action === "decision" ? { decision, rationale: decision === "APPROVED" ? "Approved after independent governance review." : "Rejected pending remediation and resubmission." } : undefined;
      await api(`/risk-assessments/${id}/${action}`, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
      await load(); setMessage(action === "submit" ? "Assessment submitted for independent review." : `Assessment ${decision?.toLowerCase()}.`);
    } catch (err) { setError(err instanceof Error ? err.message : "The action could not be completed."); }
    finally { setBusy(false); }
  }

  const counts = { open: items.filter(x => x.status === "DRAFT" || x.status === "IN_REVIEW").length, critical: items.filter(x => x.residualLevel === "CRITICAL").length, approved: items.filter(x => x.status === "APPROVED").length };
  return (
    <main className="risk-shell">
      <header className="risk-header">
        <a className="risk-brand" href="/"><span className="risk-logo">S</span><span>sentinel<span>ai</span><small>GOVERNANCE PLATFORM</small></span></a>
        <nav><a href="/">Overview</a><a className="selected" href="/risk-assessments">Risk intelligence</a></nav>
        <span className="risk-env"><i /> SECURE WORKSPACE</span>
      </header>
      <section className="risk-content">
        <div className="risk-heading"><div><div className="risk-kicker">GOVERNANCE / RISK INTELLIGENCE</div><h1>Risk assessment console</h1><p>Evidence-backed risk reviews, independent decisions, and traceable governance.</p></div>{profile && <div className="risk-user"><strong>{profile.user.name}</strong><span>{profile.organization.name} · {profile.role.replaceAll("_", " ")}</span><button onClick={() => { setToken(""); setProfile(null); setItems([]); }}>Sign out</button></div>}</div>
        {!token ? <section className="risk-login"><div className="risk-login-mark">↗</div><h2>Sign in to your workspace</h2><p>Use your SentinelAI account to view organization-scoped assessments. Your credentials are sent only to the configured API.</p><form onSubmit={login}><label>Email address<input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" /></label><label>Password<input type="password" required minLength={12} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your account password" /></label><label>Workspace slug <span>(only if you belong to multiple)</span><input value={workspace} onChange={e => setWorkspace(e.target.value)} placeholder="company-workspace" /></label><button className="risk-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in securely"}</button></form><small>API endpoint: {API}</small></section> :
        <>
          <div className="risk-summary"><article><span>ASSESSMENTS SHOWN</span><strong>{items.length}</strong><small>Current filtered view</small></article><article><span>OPEN WORK</span><strong>{counts.open}</strong><small>Draft or awaiting review</small></article><article><span>CRITICAL EXPOSURE</span><strong className="critical-number">{counts.critical}</strong><small>Residual risk · current view</small></article><article><span>APPROVED</span><strong>{counts.approved}</strong><small>Completed decisions</small></article></div>
          <div className="risk-toolbar"><div><h2>Assessment register</h2><p>Only records belonging to your authenticated workspace are returned.</p></div><div className="risk-filters"><select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option><option>DRAFT</option><option>IN_REVIEW</option><option>APPROVED</option><option>REJECTED</option></select><select value={level} onChange={e => setLevel(e.target.value)}><option value="">All risk levels</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select><button onClick={() => load().catch(e => setError(e.message))}>Refresh</button></div></div>
          <div className="risk-table-wrap"><table className="risk-table"><thead><tr><th>ASSESSMENT</th><th>AI ASSET</th><th>RESIDUAL RISK</th><th>SCORE</th><th>STATUS</th><th>CREATED</th><th>ACTIONS</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><strong>{item.title}</strong><small>{item.id.slice(0, 10)} · {item.scoringVersion}</small></td><td>{item.asset.name}<small>{item.asset.assetType.replaceAll("_", " ")}</small></td><td><span className={`risk-level ${item.residualLevel.toLowerCase()}`}>{item.residualLevel}</span></td><td><strong>{item.residualScore.toFixed(1)}</strong><small>Inherent {item.inherentScore.toFixed(1)}</small></td><td><span className={`risk-status ${item.status.toLowerCase()}`}>{item.status.replaceAll("_", " ")}</span></td><td>{new Date(item.createdAt).toLocaleDateString()}</td><td><div className="risk-actions">{item.status === "DRAFT" && <button disabled={busy} onClick={() => transition(item.id, "submit")}>Submit</button>}{item.status === "IN_REVIEW" && <><button disabled={busy} onClick={() => transition(item.id, "decision", "APPROVED")}>Approve</button><button className="reject" disabled={busy} onClick={() => transition(item.id, "decision", "REJECTED")}>Reject</button></>}</div></td></tr>)}</tbody></table>{items.length === 0 && <div className="risk-empty"><span>◇</span><strong>No assessments in this view</strong><p>Adjust filters or create an assessment through the authenticated API.</p></div>}</div>
          <div className="risk-footnote">Risk scores are versioned project-specific triage heuristics, not regulatory certifications or compliance determinations.</div>
        </>}
        {error && <div className="risk-alert error" role="alert">{error}</div>}{message && <div className="risk-alert success" role="status">{message}</div>}
      </section>
    </main>
  );
}
