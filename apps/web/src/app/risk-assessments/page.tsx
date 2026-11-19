"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import IncidentsPanel from "./incidents-panel";
import GovernanceReportsPanel from "./governance-reports-panel";

type Asset = { id: string; name: string; assetType: string };
type Assessment = {
  id: string; title: string; scope?: string; intendedUse?: string; status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED";
  residualLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; inherentScore: number; residualScore: number; scoringVersion: string;
  createdAt: string; evidence?: string[]; dataSensitivity?: number; autonomyLevel?: number; impact?: number;
  likelihood?: number; exposure?: number; mitigationCoverage?: number; reviewRationale?: string | null;
  asset: { id: string; name: string; assetType: string };
  createdByMembership?: { user: { name: string } }; reviewedByMembership?: { user: { name: string } } | null;
};
type Profile = { user: { name: string }; organization: { name: string }; role: string };
type Session = { sessionId: string; createdAt: string; lastUsedAt: string; activeTokenCount: number };
type AuditLog = { id: string; createdAt: string; action: string; entityType: string; entityId: string | null; chainSequence: string; actorId: string | null; actor?: { id: string; email: string; name: string } | null; metadata?: unknown };
type EvidenceFile = { id: string; originalFileName: string; contentType: string; sizeBytes: string; checksumSha256: string; status: "PENDING_UPLOAD" | "UPLOADED" | "QUARANTINED" | "PURGED" | "VERIFIED" | "REJECTED"; createdAt: string; uploadedAt?: string | null; verifiedAt?: string | null; verificationNote?: string | null; retentionExpiresAt?: string | null; legalHoldAt?: string | null; legalHoldReason?: string | null; createdByMembership?: { user: { name: string } }; verifiedByMembership?: { user: { name: string } } | null };
type FormState = { assetId: string; title: string; scope: string; intendedUse: string; dataSensitivity: number; autonomyLevel: number; impact: number; likelihood: number; exposure: number; mitigationCoverage: number; evidenceText: string };
const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1").replace(/\/$/, "");
const initialForm: FormState = { assetId: "", title: "", scope: "", intendedUse: "", dataSensitivity: 3, autonomyLevel: 2, impact: 3, likelihood: 3, exposure: 3, mitigationCoverage: 0, evidenceText: "" };

export default function RiskAssessmentsPage() {
  const [token, setToken] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [items, setItems] = useState<Assessment[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditTotalPages, setAuditTotalPages] = useState(0);
  const [auditAction, setAuditAction] = useState("");
  const [auditEntityType, setAuditEntityType] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditIntegrity, setAuditIntegrity] = useState<{ verified: boolean; recordsChecked: number; reason?: string } | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [status, setStatus] = useState("");
  const [level, setLevel] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const [detail, setDetail] = useState<Assessment | null>(null);
  const [review, setReview] = useState<{ id: string; decision: "APPROVED" | "REJECTED" } | null>(null);
  const [rationale, setRationale] = useState("");
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceFile[]>([]);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceDecision, setEvidenceDecision] = useState<{ id: string; decision: "VERIFIED" | "REJECTED" } | null>(null);
  const [evidenceNote, setEvidenceNote] = useState("");
  const [purgeTarget, setPurgeTarget] = useState<string | null>(null);
  const [purgeReason, setPurgeReason] = useState("");
  const [legalHoldTarget, setLegalHoldTarget] = useState<{ id: string; action: "PLACE" | "RELEASE" } | null>(null);
  const [legalHoldReason, setLegalHoldReason] = useState("");

  const api = useCallback(async (path: string, options: RequestInit = {}) => {
    const response = await fetch(API + path, { ...options, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}), ...options.headers } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join(" ") : body.message || "Request failed (" + response.status + ")");
    return body;
  }, [token]);

  const loadAuditLogs = useCallback(async () => {
    setAuditBusy(true);
    try {
      const params = new URLSearchParams({ page: String(auditPage), limit: "25" });
      if (auditAction.trim()) params.set("action", auditAction.trim());
      if (auditEntityType.trim()) params.set("entityType", auditEntityType.trim());
      if (auditFrom) params.set("from", auditFrom + "T00:00:00.000Z");
      if (auditTo) params.set("to", auditTo + "T23:59:59.999Z");
      const result = await api("/audit-logs?" + params.toString());
      setAuditLogs(result.data || []);
      setAuditTotal(result.pagination?.total || 0);
      setAuditTotalPages(result.pagination?.totalPages || 0);
    } finally { setAuditBusy(false); }
  }, [api, auditPage, auditAction, auditEntityType, auditFrom, auditTo]);

  async function verifyAuditIntegrity() {
    setAuditBusy(true); setError("");
    try {
      const result = await api("/audit-logs/integrity");
      setAuditIntegrity(result);
      setMessage(result.verified ? "Audit chain integrity verified." : "Audit chain verification reported an integrity issue.");
    } catch (err) { setError(err instanceof Error ? err.message : "Audit integrity verification failed."); }
    finally { setAuditBusy(false); }
  }

  async function exportAuditCsv() {
    setAuditBusy(true); setError("");
    try {
      const params = new URLSearchParams();
      if (auditAction.trim()) params.set("action", auditAction.trim());
      if (auditEntityType.trim()) params.set("entityType", auditEntityType.trim());
      if (auditFrom) params.set("from", auditFrom + "T00:00:00.000Z");
      if (auditTo) params.set("to", auditTo + "T23:59:59.999Z");
      const response = await fetch(API + "/audit-logs/export.csv?" + params.toString(), { headers: { authorization: "Bearer " + token } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Audit export failed (" + response.status + ").");
      }
      const url = window.URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "sentinelai-audit-logs.csv";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.URL.revokeObjectURL(url);
      setMessage("Filtered audit log CSV exported.");
    } catch (err) { setError(err instanceof Error ? err.message : "Audit export failed."); }
    finally { setAuditBusy(false); }
  }

  const loadSessions = useCallback(async () => {
    const result = await api("/auth/sessions");
    setSessions(result.data || []);
  }, [api]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (level) params.set("residualLevel", level);
    const result = await api("/risk-assessments?" + params.toString());
    setItems(result.data || []);
  }, [api, status, level]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    Promise.all([api("/auth/me"), api("/assets")]).then(([user, list]) => {
      if (active) { setProfile(user); setAssets(list || []); }
    }).catch((err: Error) => { if (active) { setError(err.message); setToken(""); setProfile(null); } });
    return () => { active = false; };
  }, [token, api]);

  useEffect(() => {
    if (!token) return;
    loadSessions().catch((err: Error) => setError(err.message));
  }, [token, loadSessions]);

  useEffect(() => {
    if (!token) return;
    loadAuditLogs().catch((err: Error) => setError(err.message));
  }, [token, loadAuditLogs]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    load().catch((err: Error) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [token, load]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(API + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, ...(workspace ? { organizationSlug: workspace } : {}) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to sign in.");
      setToken(data.accessToken); setPassword("");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to sign in."); }
    finally { setBusy(false); }
  }

  async function revokeSession(sessionId: string) {
    if (!window.confirm("Revoke this login session? Its access and refresh tokens will stop working immediately.")) return;
    setSessionBusy(true); setError(""); setMessage("");
    try {
      await api("/auth/sessions/" + sessionId, { method: "DELETE" });
      setSessions(current => current.filter(session => session.sessionId !== sessionId));
      let activeSessionId = "";
      try {
        const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
        activeSessionId = JSON.parse(window.atob(payload)).sessionId || "";
      } catch { /* Token payload is opaque to the UI if it cannot be decoded. */ }
      if (activeSessionId === sessionId) {
        setToken(""); setProfile(null); setItems([]); setAssets([]); setSessions([]);
        setMessage("This session was revoked. Sign in again to continue.");
      } else {
        setMessage("Session revoked. Its access and refresh tokens are now invalid.");
        await loadSessions();
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Session revocation failed."); }
    finally { setSessionBusy(false); }
  }

  async function createAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const evidence = form.evidenceText.split("\n").map(v => v.trim()).filter(Boolean);
      if (evidence.length > 30) throw new Error("Add no more than 30 evidence references.");
      await api("/assets/" + form.assetId + "/risk-assessments", { method: "POST", body: JSON.stringify({
        title: form.title, scope: form.scope, intendedUse: form.intendedUse, dataSensitivity: form.dataSensitivity,
        autonomyLevel: form.autonomyLevel, impact: form.impact, likelihood: form.likelihood, exposure: form.exposure,
        mitigationCoverage: form.mitigationCoverage, evidence
      }) });
      setShowCreate(false); setForm(initialForm); await load();
      setMessage("Draft created. Risk scores were calculated by the authoritative API.");
    } catch (err) { setError(err instanceof Error ? err.message : "Assessment could not be created."); }
    finally { setBusy(false); }
  }

  async function openDetail(id: string) {
    try {
      const [record, files] = await Promise.all([api("/risk-assessments/" + id), api("/risk-assessments/" + id + "/evidence")]);
      setDetail(record); setEvidenceFiles(files || []);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to load assessment."); }
  }

  async function uploadEvidence(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file || !detail) return;
    setEvidenceBusy(true); setError(""); setMessage("");
    try {
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const checksumSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      const intent = await api("/risk-assessments/" + detail.id + "/evidence/upload-intents", { method: "POST", body: JSON.stringify({ fileName: file.name, contentType: file.type, sizeBytes: file.size, checksumSha256 }) });
      const uploaded = await fetch(intent.upload.url, { method: "PUT", headers: intent.upload.headers, body: file });
      if (!uploaded.ok) throw new Error("Private object storage rejected the upload (" + uploaded.status + ").");
      const completed = await api("/risk-assessments/" + detail.id + "/evidence/" + intent.evidence.id + "/complete", { method: "POST" });
      setEvidenceFiles(await api("/risk-assessments/" + detail.id + "/evidence"));
      setMessage(completed.status === "QUARANTINED" ? "Malware detected. The evidence file has been quarantined and is unavailable for review or download." : "Evidence passed file validation and ClamAV scanning. Independent human review is still required.");
    } catch (err) { setError(err instanceof Error ? err.message : "Evidence upload failed."); }
    finally { setEvidenceBusy(false); event.target.value = ""; }
  }

  async function downloadEvidence(id: string) {
    if (!detail) return;
    try {
      const result = await api("/risk-assessments/" + detail.id + "/evidence/" + id + "/download", { method: "POST" });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to issue private download link."); }
  }

  async function rescanEvidence(id: string) {
    if (!detail) return;
    setEvidenceBusy(true); setError(""); setMessage("");
    try {
      const result = await api("/risk-assessments/" + detail.id + "/evidence/" + id + "/rescan", { method: "POST" });
      setEvidenceFiles(await api("/risk-assessments/" + detail.id + "/evidence"));
      setMessage(result.scan === "CLEAN" ? "A fresh ClamAV scan passed. Evidence is available for independent human review." : "Malware is still detected. Evidence remains quarantined.");
    } catch (err) { setError(err instanceof Error ? err.message : "Evidence rescan failed."); }
    finally { setEvidenceBusy(false); }
  }

  async function submitLegalHold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!detail || !legalHoldTarget) return;
    setEvidenceBusy(true); setError(""); setMessage("");
    try {
      const route = legalHoldTarget.action === "PLACE" ? "/legal-hold" : "/legal-hold/release";
      await api("/risk-assessments/" + detail.id + "/evidence/" + legalHoldTarget.id + route, { method: "POST", body: JSON.stringify({ reason: legalHoldReason }) });
      setEvidenceFiles(await api("/risk-assessments/" + detail.id + "/evidence"));
      setLegalHoldTarget(null); setLegalHoldReason("");
      setMessage(legalHoldTarget.action === "PLACE" ? "Legal hold placed. Automated and manual deletion are blocked." : "Legal hold released. Expired evidence may be removed by the next retention run.");
    } catch (err) { setError(err instanceof Error ? err.message : "Legal hold update failed."); }
    finally { setEvidenceBusy(false); }
  }

  async function purgeEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!detail || !purgeTarget) return;
    setEvidenceBusy(true); setError(""); setMessage("");
    try {
      await api("/risk-assessments/" + detail.id + "/evidence/" + purgeTarget + "/purge", { method: "POST", body: JSON.stringify({ reason: purgeReason }) });
      setEvidenceFiles(await api("/risk-assessments/" + detail.id + "/evidence"));
      setPurgeTarget(null); setPurgeReason("");
      setMessage("Quarantined object securely deleted. Its metadata and purge rationale remain in the audit trail.");
    } catch (err) { setError(err instanceof Error ? err.message : "Evidence purge failed."); }
    finally { setEvidenceBusy(false); }
  }

  async function decideEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!detail || !evidenceDecision) return;
    setEvidenceBusy(true); setError("");
    try {
      await api("/risk-assessments/" + detail.id + "/evidence/" + evidenceDecision.id + "/decision", { method: "POST", body: JSON.stringify({ decision: evidenceDecision.decision, note: evidenceNote }) });
      const decision = evidenceDecision.decision;
      setEvidenceDecision(null); setEvidenceNote("");
      setEvidenceFiles(await api("/risk-assessments/" + detail.id + "/evidence"));
      setMessage("Evidence " + decision.toLowerCase() + " with an audit rationale.");
    } catch (err) { setError(err instanceof Error ? err.message : "Evidence review failed."); }
    finally { setEvidenceBusy(false); }
  }

  async function submitDraft(id: string) {
    setBusy(true); setError(""); setMessage("");
    try { await api("/risk-assessments/" + id + "/submit", { method: "POST" }); await load(); if (detail?.id === id) await openDetail(id); setMessage("Assessment submitted for independent review."); }
    catch (err) { setError(err instanceof Error ? err.message : "Submission failed."); }
    finally { setBusy(false); }
  }

  async function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!review) return; setBusy(true); setError(""); setMessage("");
    try {
      await api("/risk-assessments/" + review.id + "/decision", { method: "POST", body: JSON.stringify({ decision: review.decision, rationale }) });
      const decision = review.decision; setReview(null); setRationale(""); await load();
      if (detail?.id) await openDetail(detail.id);
      setMessage("Assessment " + decision.toLowerCase() + "; reviewer rationale recorded.");
    } catch (err) { setError(err instanceof Error ? err.message : "Review decision failed."); }
    finally { setBusy(false); }
  }

  const setField = (key: keyof FormState, value: string | number) => setForm(current => ({ ...current, [key]: value }));
  const counts = { open: items.filter(x => x.status === "DRAFT" || x.status === "IN_REVIEW").length, critical: items.filter(x => x.residualLevel === "CRITICAL").length, approved: items.filter(x => x.status === "APPROVED").length };

  return <main className="risk-shell">
    <header className="risk-header"><a className="risk-brand" href="/"><span className="risk-logo">S</span><span>sentinel<span>ai</span><small>GOVERNANCE PLATFORM</small></span></a><nav><a href="/">Overview</a><a className="selected" href="/risk-assessments">Risk intelligence</a>{token && <><a href="#sessions">Security sessions</a><a href="#incidents">Incidents</a><a href="#governance-reports">Reports</a><a href="#audit-logs">Audit trail</a></>}</nav><span className="risk-env"><i /> SECURE WORKSPACE</span></header>
    <section className="risk-content">
      <div className="risk-heading"><div><div className="risk-kicker">GOVERNANCE / RISK INTELLIGENCE</div><h1>Risk assessment console</h1><p>Evidence-backed risk reviews, independent decisions, and traceable governance.</p></div>{profile && <div className="risk-user"><strong>{profile.user.name}</strong><span>{profile.organization.name} · {profile.role.replaceAll("_", " ")}</span><button onClick={() => { setToken(""); setProfile(null); setItems([]); setAssets([]); }}>Sign out</button></div>}</div>
      {!token ? <section className="risk-login"><div className="risk-login-mark">↗</div><h2>Sign in to your workspace</h2><p>Use your SentinelAI account to view organization-scoped assessments.</p><form onSubmit={login}><label>Email address<input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password<input type="password" required minLength={12} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label><label>Workspace slug <span>(if required)</span><input value={workspace} onChange={e => setWorkspace(e.target.value)} /></label><button className="risk-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in securely"}</button></form><div className="risk-login-links"><a className="risk-forgot-password" href="/forgot-password">Forgot password?</a><a className="risk-forgot-password" href="/register">Create an account</a><a className="risk-forgot-password" href="/verify-email">Resend verification email</a></div><small>API endpoint: {API}</small></section> :
      <>
        <div className="risk-summary"><article><span>ASSESSMENTS SHOWN</span><strong>{items.length}</strong><small>Current filtered view</small></article><article><span>OPEN WORK</span><strong>{counts.open}</strong><small>Draft or awaiting review</small></article><article><span>CRITICAL EXPOSURE</span><strong className="critical-number">{counts.critical}</strong><small>Residual risk · current view</small></article><article><span>APPROVED</span><strong>{counts.approved}</strong><small>Completed decisions</small></article></div>
        <div className="risk-toolbar"><div><h2>Assessment register</h2><p>Organization-scoped records from the authenticated API.</p></div><div className="risk-filters"><select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option><option>DRAFT</option><option>IN_REVIEW</option><option>APPROVED</option><option>REJECTED</option></select><select value={level} onChange={e => setLevel(e.target.value)}><option value="">All risk levels</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select><button onClick={() => load().catch(e => setError(e.message))}>Refresh</button><button className="risk-create-button" onClick={() => { setError(""); setShowCreate(true); }}>＋ New assessment</button></div></div>
        <div className="risk-table-wrap"><table className="risk-table"><thead><tr><th>ASSESSMENT</th><th>AI ASSET</th><th>RESIDUAL RISK</th><th>SCORE</th><th>STATUS</th><th>CREATED</th><th>ACTIONS</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><td><button className="risk-link-button" onClick={() => openDetail(item.id)}><strong>{item.title}</strong></button><small>{item.id.slice(0, 10)} · {item.scoringVersion}</small></td><td>{item.asset.name}<small>{item.asset.assetType.replaceAll("_", " ")}</small></td><td><span className={"risk-level " + item.residualLevel.toLowerCase()}>{item.residualLevel}</span></td><td><strong>{item.residualScore.toFixed(1)}</strong><small>Inherent {item.inherentScore.toFixed(1)}</small></td><td><span className={"risk-status " + item.status.toLowerCase()}>{item.status.replaceAll("_", " ")}</span></td><td>{new Date(item.createdAt).toLocaleDateString()}</td><td><div className="risk-actions">{item.status === "DRAFT" && <button disabled={busy} onClick={() => submitDraft(item.id)}>Submit</button>}{item.status === "IN_REVIEW" && <><button disabled={busy} onClick={() => { setReview({ id: item.id, decision: "APPROVED" }); setRationale(""); }}>Approve</button><button className="reject" disabled={busy} onClick={() => { setReview({ id: item.id, decision: "REJECTED" }); setRationale(""); }}>Reject</button></>}</div></td></tr>)}</tbody></table>{items.length === 0 && <div className="risk-empty"><span>◇</span><strong>No assessments in this view</strong><p>Create an assessment for an AI asset or adjust the filters.</p></div>}</div>
        <div className="risk-footnote">Risk scores are project-specific triage heuristics, not regulatory certifications or compliance determinations.</div>
        <section className="session-panel" id="sessions">
          <div className="session-panel-heading">
            <div><div className="risk-kicker">ACCOUNT SECURITY</div><h2>Active login sessions</h2><p>Review and revoke access across your active sign-ins. Device and location details are not collected.</p></div>
            <button className="session-refresh" disabled={sessionBusy} onClick={() => loadSessions().catch(err => setError(err.message))}>↻ Refresh</button>
          </div>
          {sessions.length ? <div className="session-list">{sessions.map(session => <article className="session-card" key={session.sessionId}>
            <div className="session-icon">⌘</div>
            <div className="session-details"><strong>SentinelAI session · {session.sessionId.slice(0, 8)}</strong><span>Started {new Date(session.createdAt).toLocaleString()}</span><span>Last token activity {new Date(session.lastUsedAt).toLocaleString()} · {session.activeTokenCount} active refresh token{session.activeTokenCount === 1 ? "" : "s"}</span></div>
            <button className="session-revoke" disabled={sessionBusy} onClick={() => revokeSession(session.sessionId)}>Revoke session</button>
          </article>)}</div> : <div className="session-empty"><strong>No active sessions found</strong><span>Refresh to check again. Your current session may have expired.</span></div>}
          <p className="session-note">Revocation invalidates the session’s refresh-token family and associated access tokens immediately. The action is recorded in the organization audit log.</p>
        </section>
        <IncidentsPanel api={api} assets={assets} canManage={["OWNER","ADMIN","AI_GOVERNANCE","SECURITY_ANALYST","COMPLIANCE_OFFICER"].includes(profile?.role || "")} />
        {["OWNER","ADMIN","AI_GOVERNANCE","SECURITY_ANALYST","COMPLIANCE_OFFICER","AUDITOR"].includes(profile?.role || "") && <GovernanceReportsPanel api={api} downloadUrl={API} token={token} />}
        <section className="audit-panel" id="audit-logs">
          <div className="audit-heading"><div><div className="risk-kicker">GOVERNANCE / ACCOUNTABILITY</div><h2>Immutable audit trail</h2><p>Organization-scoped events with chain sequence, actor attribution, and integrity verification.</p></div><div className="audit-actions"><button className="session-refresh" disabled={auditBusy} onClick={verifyAuditIntegrity}>Verify chain</button><button className="session-refresh" disabled={auditBusy} onClick={exportAuditCsv}>Export CSV</button></div></div>
          {auditIntegrity && <div className={"audit-integrity " + (auditIntegrity.verified ? "verified" : "failed")} role="status"><strong>{auditIntegrity.verified ? "Chain verified" : "Integrity check failed"}</strong><span>{auditIntegrity.recordsChecked.toLocaleString()} records checked{auditIntegrity.reason ? " · " + auditIntegrity.reason : ""}</span></div>}
          <div className="audit-filters">
            <label>Action contains<input value={auditAction} maxLength={100} onChange={e => {setAuditAction(e.target.value);setAuditPage(1);}} placeholder="e.g. RISK_ASSESSMENT_APPROVED" /></label>
            <label>Entity type<input value={auditEntityType} maxLength={100} onChange={e => {setAuditEntityType(e.target.value);setAuditPage(1);}} placeholder="e.g. RiskAssessment" /></label>
            <label>From<input type="date" value={auditFrom} onChange={e => {setAuditFrom(e.target.value);setAuditPage(1);}} /></label>
            <label>To<input type="date" value={auditTo} onChange={e => {setAuditTo(e.target.value);setAuditPage(1);}} /></label>
            <button className="session-refresh" disabled={auditBusy || (!!auditFrom && !!auditTo && auditFrom > auditTo)} onClick={() => loadAuditLogs().catch(err => setError(err.message))}>Apply filters</button>
          </div>
          <div className="audit-meta"><span>{auditTotal.toLocaleString()} matching events</span><span>25 events per page</span></div>
          <div className="audit-list">
            {auditLogs.map(log => <article className="audit-entry" key={log.id}>
              <div className="audit-sequence">#{log.chainSequence}</div>
              <div className="audit-event"><strong>{log.action}</strong><span>{log.entityType}{log.entityId ? " · " + log.entityId : ""}</span><small>{log.actor?.name || log.actor?.email || log.actorId || "System / unknown actor"} · {new Date(log.createdAt).toLocaleString()}</small></div>
              <button className="audit-detail-toggle" onClick={e => { const node = e.currentTarget.nextElementSibling as HTMLElement | null; if (node) node.hidden = !node.hidden; }}>Metadata</button>
              <pre className="audit-metadata" hidden>{JSON.stringify(log.metadata ?? {}, null, 2)}</pre>
            </article>)}
            {!auditBusy && auditLogs.length === 0 && <div className="session-empty"><strong>No audit events match these filters</strong><span>Try a wider date range or remove an action/entity filter.</span></div>}
            {auditBusy && <div className="session-empty"><strong>Loading audit events…</strong></div>}
          </div>
          <div className="audit-pagination"><span>Page {auditPage} of {Math.max(1,auditTotalPages)}</span><div><button className="session-refresh" disabled={auditBusy || auditPage <= 1} onClick={() => setAuditPage(p => Math.max(1,p-1))}>Previous</button><button className="session-refresh" disabled={auditBusy || auditPage >= auditTotalPages} onClick={() => setAuditPage(p => p+1)}>Next</button></div></div>
          <p className="session-note">Audit records are read-only here. Export is capped by the API at 10,000 matching records and protects spreadsheet cells against formula injection.</p>
        </section>


      </>}
      {error && <div className="risk-alert error" role="alert">{error}</div>}{message && <div className="risk-alert success" role="status">{message}</div>}
    </section>

    {showCreate && <div className="risk-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowCreate(false); }}><section className="risk-modal risk-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title"><div className="risk-modal-heading"><div><div className="risk-kicker">NEW GOVERNANCE RECORD</div><h2 id="create-title">Create risk assessment</h2><p>Capture intended use, risk context, and supporting evidence.</p></div><button className="risk-close" onClick={() => setShowCreate(false)} aria-label="Close">×</button></div>
      <form onSubmit={createAssessment}>
        <label className="risk-field full">AI asset<select required value={form.assetId} onChange={e => setField("assetId", e.target.value)}><option value="">Select an organization asset…</option>{assets.map(a => <option key={a.id} value={a.id}>{a.name} · {a.assetType.replaceAll("_", " ")}</option>)}</select>{assets.length === 0 && <small>Create an AI asset before assessing its risk.</small>}</label>
        <label className="risk-field full">Assessment title<input required minLength={3} maxLength={160} value={form.title} onChange={e => setField("title", e.target.value)} placeholder="Production customer support assistant" /></label>
        <label className="risk-field full">Assessment scope<textarea required minLength={10} maxLength={3000} rows={3} value={form.scope} onChange={e => setField("scope", e.target.value)} placeholder="Systems, users, data flows, boundaries, and exclusions…" /></label>
        <label className="risk-field full">Intended use<textarea required minLength={10} maxLength={2000} rows={3} value={form.intendedUse} onChange={e => setField("intendedUse", e.target.value)} placeholder="What the AI system does and who relies on it…" /></label>
        <div className="risk-form-section">RISK DIMENSIONS <span>Validated and scored by the API</span></div>
        <label className="risk-field">Data sensitivity<select value={form.dataSensitivity} onChange={e => setField("dataSensitivity", Number(e.target.value))}>{[1,2,3,4,5].map(v => <option key={v} value={v}>{v} · {["Public","Internal","Confidential","Sensitive","Highly sensitive"][v-1]}</option>)}</select></label>
        <label className="risk-field">Autonomy level<select value={form.autonomyLevel} onChange={e => setField("autonomyLevel", Number(e.target.value))}>{[1,2,3,4,5].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
        {(["impact","likelihood","exposure"] as const).map(key => <label className="risk-field" key={key}>{key[0].toUpperCase()+key.slice(1)} (1–5)<select value={form[key]} onChange={e => setField(key, Number(e.target.value))}>{[1,2,3,4,5].map(v => <option key={v} value={v}>{v}</option>)}</select></label>)}
        <label className="risk-field">Mitigation coverage (%)<input type="number" min={0} max={100} required value={form.mitigationCoverage} onChange={e => setField("mitigationCoverage", Number(e.target.value))} /></label>
        <label className="risk-field full">Evidence references <span className="risk-field-hint">One URL or document identifier per line, maximum 30. References only; no file upload or verification is implied.</span><textarea rows={4} value={form.evidenceText} onChange={e => setField("evidenceText", e.target.value)} placeholder={"https://example.com/model-card\nGRC-2026-014"} /></label>
        <div className="risk-modal-actions"><button type="button" className="risk-secondary" onClick={() => setShowCreate(false)}>Cancel</button><button className="risk-primary" disabled={busy || !form.assetId || assets.length === 0}>{busy ? "Creating…" : "Create draft assessment"}</button></div>
      </form></section></div>}

    {detail && <div className="risk-modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setDetail(null); }}><section className="risk-modal risk-detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><div className="risk-modal-heading"><div><div className="risk-kicker">ASSESSMENT RECORD · {detail.id.slice(0, 12)}</div><h2 id="detail-title">{detail.title}</h2><p>{detail.asset.name} · {detail.asset.assetType.replaceAll("_", " ")}</p></div><button className="risk-close" onClick={() => setDetail(null)} aria-label="Close">×</button></div>
      <div className="risk-detail-grid"><article><span>RESIDUAL RISK</span><strong className={"risk-level " + detail.residualLevel.toLowerCase()}>{detail.residualLevel}</strong></article><article><span>RESIDUAL SCORE</span><strong>{detail.residualScore.toFixed(2)}</strong></article><article><span>INHERENT SCORE</span><strong>{detail.inherentScore.toFixed(2)}</strong></article><article><span>LIFECYCLE</span><strong>{detail.status.replaceAll("_", " ")}</strong></article></div>
      <div className="risk-detail-section"><h3>Scope</h3><p>{detail.scope || "Not provided."}</p></div><div className="risk-detail-section"><h3>Intended use</h3><p>{detail.intendedUse || "Not provided."}</p></div>
      <div className="risk-detail-section"><h3>Risk dimensions</h3><div className="risk-dimension-list">{[["Data sensitivity",detail.dataSensitivity],["Autonomy level",detail.autonomyLevel],["Impact",detail.impact],["Likelihood",detail.likelihood],["Exposure",detail.exposure],["Mitigation coverage",detail.mitigationCoverage === undefined ? "—" : detail.mitigationCoverage + "%"]].map(([label,value]) => <span key={String(label)}>{label}<strong>{value ?? "—"}</strong></span>)}</div></div>
      <div className="risk-detail-section"><h3>Evidence references ({detail.evidence?.length || 0})</h3>{detail.evidence?.length ? <ul className="risk-evidence-list">{detail.evidence.map((entry,index) => <li key={index}>{/^https?:\/\//i.test(entry) ? <a href={entry} target="_blank" rel="noreferrer">{entry}</a> : <code>{entry}</code>}</li>)}</ul> : <p>No evidence references attached.</p>}</div>
      {detail.reviewRationale && <div className="risk-detail-section"><h3>Reviewer rationale</h3><p>{detail.reviewRationale}</p></div>}
      <div className="risk-detail-section"><h3>Private evidence files ({evidenceFiles.length})</h3><p>Uploads are checksum-checked; independent human review is required.</p>
        <label className="risk-evidence-upload">＋ Upload evidence file<input type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,application/pdf,image/png,image/jpeg,text/plain,text/csv" disabled={evidenceBusy} onChange={uploadEvidence} /></label>
        {evidenceFiles.length > 0 ? <div className="risk-evidence-files">{evidenceFiles.map(file => <article key={file.id}><div><strong>{file.originalFileName}</strong><small>{file.contentType} · {(Number(file.sizeBytes)/1024).toFixed(1)} KB · SHA-256 {file.checksumSha256.slice(0,12)}…</small><span className={"risk-status " + file.status.toLowerCase()}>{file.status.replaceAll("_"," ")}</span>{file.legalHoldAt && <small>LEGAL HOLD · {file.legalHoldReason || "Reason recorded"}</small>}{file.retentionExpiresAt && <small>Retention expiry · {new Date(file.retentionExpiresAt).toLocaleDateString()}</small>}{file.verificationNote && <p>{file.verificationNote}</p>}<small>Uploaded by {file.createdByMembership?.user.name || "—"}{file.verifiedByMembership ? " · reviewed by " + file.verifiedByMembership.user.name : ""}</small></div><div className="risk-actions">{(file.status === "UPLOADED" || file.status === "VERIFIED") && <button onClick={() => downloadEvidence(file.id)}>Download</button>}{file.status === "UPLOADED" && ["OWNER","ADMIN","AI_GOVERNANCE","SECURITY_ANALYST","COMPLIANCE_OFFICER"].includes(profile?.role || "") && <><button onClick={() => { setEvidenceDecision({id:file.id,decision:"VERIFIED"}); setEvidenceNote(""); }}>Verify</button><button className="reject" onClick={() => { setEvidenceDecision({id:file.id,decision:"REJECTED"}); setEvidenceNote(""); }}>Reject</button></>}{file.status === "QUARANTINED" && ["OWNER","ADMIN","AI_GOVERNANCE","SECURITY_ANALYST","COMPLIANCE_OFFICER"].includes(profile?.role || "") && <><button disabled={evidenceBusy} onClick={() => rescanEvidence(file.id)}>Rescan</button>{["OWNER","ADMIN","SECURITY_ANALYST"].includes(profile?.role || "") && <button className="reject" disabled={evidenceBusy} onClick={() => { setPurgeTarget(file.id); setPurgeReason(""); }}>Purge</button>}</>}{file.status !== "PENDING_UPLOAD" && file.status !== "PURGED" && ["OWNER","ADMIN","COMPLIANCE_OFFICER"].includes(profile?.role || "") && <button disabled={evidenceBusy} onClick={() => { setLegalHoldTarget({id:file.id,action:file.legalHoldAt ? "RELEASE" : "PLACE"}); setLegalHoldReason(""); }}>{file.legalHoldAt ? "Release legal hold" : "Place legal hold"}</button>}</div></article>)}</div> : <p>No private evidence files uploaded.</p>}
        {legalHoldTarget && <form className="risk-evidence-review" onSubmit={submitLegalHold}><label className="risk-field">{legalHoldTarget.action === "PLACE" ? "Legal hold reason" : "Reason for releasing legal hold"}<textarea required minLength={10} maxLength={1000} rows={3} value={legalHoldReason} onChange={e => setLegalHoldReason(e.target.value)} placeholder="Record the legal matter, authority, or release decision…" /></label><div className="risk-modal-actions"><button type="button" className="risk-secondary" onClick={() => { setLegalHoldTarget(null); setLegalHoldReason(""); }}>Cancel</button><button className="risk-primary" disabled={evidenceBusy || legalHoldReason.trim().length < 10}>{evidenceBusy ? "Saving…" : legalHoldTarget.action === "PLACE" ? "Confirm legal hold" : "Confirm release"}</button></div></form>}
        {purgeTarget && <form className="risk-evidence-review" onSubmit={purgeEvidence}><label className="risk-field">Permanent deletion reason<textarea required minLength={10} maxLength={1000} rows={3} value={purgeReason} onChange={e => setPurgeReason(e.target.value)} placeholder="Record the incident/ticket, authorization, and reason for deleting the quarantined object…" /></label><div className="risk-modal-actions"><button type="button" className="risk-secondary" onClick={() => { setPurgeTarget(null); setPurgeReason(""); }}>Cancel</button><button className="risk-primary reject" disabled={evidenceBusy || purgeReason.trim().length < 10}>{evidenceBusy ? "Deleting…" : "Confirm permanent purge"}</button></div></form>}
        {evidenceDecision && <form className="risk-evidence-review" onSubmit={decideEvidence}><label className="risk-field">Verification rationale<textarea required minLength={10} maxLength={3000} rows={3} value={evidenceNote} onChange={e => setEvidenceNote(e.target.value)} placeholder="Record provenance, relevance, integrity, and review findings…" /></label><div className="risk-modal-actions"><button type="button" className="risk-secondary" onClick={() => setEvidenceDecision(null)}>Cancel</button><button className="risk-primary" disabled={evidenceBusy || evidenceNote.trim().length < 10}>{evidenceBusy ? "Saving…" : "Confirm " + evidenceDecision.decision.toLowerCase()}</button></div></form>}
      </div>
      <div className="risk-detail-meta"><span>Scoring version <strong>{detail.scoringVersion}</strong></span><span>Created by <strong>{detail.createdByMembership?.user.name || "—"}</strong></span><span>Reviewed by <strong>{detail.reviewedByMembership?.user.name || "—"}</strong></span></div>
      <div className="risk-modal-actions"><button className="risk-secondary" onClick={() => setDetail(null)}>Close</button>{detail.status === "DRAFT" && <button className="risk-primary" disabled={busy} onClick={() => submitDraft(detail.id)}>Submit for review</button>}</div>
    </section></div>}

    {review && <div className="risk-modal-backdrop"><section className="risk-modal risk-review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><div className="risk-modal-heading"><div><div className="risk-kicker">INDEPENDENT GOVERNANCE REVIEW</div><h2 id="review-title">{review.decision === "APPROVED" ? "Approve assessment" : "Reject assessment"}</h2><p>Your rationale is retained in the assessment and audit trail.</p></div><button className="risk-close" onClick={() => setReview(null)} aria-label="Close">×</button></div><form onSubmit={decide}><label className="risk-field full">Reviewer rationale<textarea required minLength={10} maxLength={3000} rows={6} value={rationale} onChange={e => setRationale(e.target.value)} placeholder={review.decision === "APPROVED" ? "Explain the evidence and controls supporting approval…" : "Describe the gaps, risks, and remediation required…"} /><span className="risk-field-hint">{rationale.length}/3000 characters · minimum 10</span></label><div className="risk-modal-actions"><button type="button" className="risk-secondary" onClick={() => setReview(null)}>Cancel</button><button className="risk-primary" disabled={busy || rationale.trim().length < 10}>{busy ? "Saving…" : "Confirm " + review.decision.toLowerCase()}</button></div></form></section></div>}
  </main>;
}
