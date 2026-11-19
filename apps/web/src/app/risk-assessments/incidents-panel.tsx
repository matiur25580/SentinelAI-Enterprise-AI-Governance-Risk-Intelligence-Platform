"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Incident = {
  id: string; title: string; description: string; severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "TRIAGED" | "INVESTIGATING" | "RESOLVED" | "CLOSED";
  source?: string | null; occurredAt: string; resolution?: string | null;
  asset?: { id: string; name: string } | null;
  createdByMembership?: { user: { name: string; email: string } };
};
type Asset = { id: string; name: string; assetType: string };
type Api = (path: string, options?: RequestInit) => Promise<any>;

const nextStatus: Partial<Record<Incident["status"], Incident["status"]>> = {
  OPEN: "TRIAGED", TRIAGED: "INVESTIGATING", INVESTIGATING: "RESOLVED", RESOLVED: "CLOSED",
};

export default function IncidentsPanel({ api, assets, canManage }: { api: Api; assets: Asset[]; canManage: boolean }) {
  const [items, setItems] = useState<Incident[]>([]);
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [incidentSeverity, setIncidentSeverity] = useState("MEDIUM");
  const [source, setSource] = useState("");
  const [assetId, setAssetId] = useState("");
  const [resolutionId, setResolutionId] = useState("");
  const [resolution, setResolution] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (severity) params.set("severity", severity);
    if (status) params.set("status", status);
    const result = await api("/incidents?" + params.toString());
    setItems(result.data || []);
  }, [api, severity, status]);

  useEffect(() => { load().catch(err => setError(err.message)); }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await api("/incidents", { method: "POST", body: JSON.stringify({
        title, description, severity: incidentSeverity, ...(source.trim() ? { source: source.trim() } : {}),
        ...(assetId ? { assetId } : {}),
      }) });
      setTitle(""); setDescription(""); setSource(""); setAssetId(""); setIncidentSeverity("MEDIUM");
      setShowCreate(false); await load(); setMessage("Incident registered and audit event recorded.");
    } catch (err) { setError(err instanceof Error ? err.message : "Incident could not be created."); }
    finally { setBusy(false); }
  }

  async function advance(incident: Incident, target: Incident["status"]) {
    setBusy(true); setError(""); setMessage("");
    try {
      await api("/incidents/" + incident.id, { method: "PATCH", body: JSON.stringify({
        status: target, ...(target === "RESOLVED" ? { resolution: resolution.trim() } : {}),
      }) });
      setResolutionId(""); setResolution(""); await load();
      setMessage("Incident moved to " + target.replaceAll("_", " ").toLowerCase() + "; change recorded in the audit trail.");
    } catch (err) { setError(err instanceof Error ? err.message : "Incident update failed."); }
    finally { setBusy(false); }
  }

  return <section className="incident-panel" id="incidents">
    <div className="incident-heading">
      <div><div className="risk-kicker">OPERATIONS / HUMAN RESPONSE</div><h2>AI incident management</h2><p>Record AI-related events, coordinate triage, and preserve resolution history in the organization audit chain.</p></div>
      {canManage && <button className="risk-primary incident-new" onClick={() => setShowCreate(v => !v)}>{showCreate ? "Cancel" : "+ Report incident"}</button>}
    </div>
    {showCreate && canManage && <form className="incident-create" onSubmit={create}>
      <label>Incident title<input required minLength={3} maxLength={180} value={title} onChange={e => setTitle(e.target.value)} placeholder="Unexpected sensitive output in assistant response" /></label>
      <label>Severity<select value={incidentSeverity} onChange={e => setIncidentSeverity(e.target.value)}>{["LOW","MEDIUM","HIGH","CRITICAL"].map(v => <option key={v}>{v}</option>)}</select></label>
      <label>Related AI asset <select value={assetId} onChange={e => setAssetId(e.target.value)}><option value="">Not linked to an asset</option>{assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Detection source<input maxLength={120} value={source} onChange={e => setSource(e.target.value)} placeholder="Monitoring alert, user report, review…" /></label>
      <label className="incident-full">Description<textarea required minLength={10} maxLength={5000} rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe observed behavior, affected workflow, impact, and immediate containment…" /></label>
      <div className="incident-full incident-form-actions"><button type="button" className="risk-secondary" onClick={() => setShowCreate(false)}>Cancel</button><button className="risk-primary" disabled={busy || title.trim().length < 3 || description.trim().length < 10}>{busy ? "Saving…" : "Create incident"}</button></div>
    </form>}
    <div className="incident-filters"><label>Severity<select value={severity} onChange={e => setSeverity(e.target.value)}><option value="">All severities</option>{["LOW","MEDIUM","HIGH","CRITICAL"].map(v => <option key={v}>{v}</option>)}</select></label><label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{["OPEN","TRIAGED","INVESTIGATING","RESOLVED","CLOSED"].map(v => <option key={v}>{v}</option>)}</select></label><button className="session-refresh" disabled={busy} onClick={() => load().catch(err => setError(err.message))}>↻ Refresh</button><span>{items.length} incident{items.length === 1 ? "" : "s"} in this view</span></div>
    {error && <p className="incident-error" role="alert">{error}</p>}{message && <p className="incident-message" role="status">{message}</p>}
    <div className="incident-list">{items.map(item => <article className="incident-card" key={item.id}>
      <div className="incident-card-top"><span className={"incident-severity " + item.severity.toLowerCase()}>{item.severity}</span><span className={"incident-status " + item.status.toLowerCase()}>{item.status.replaceAll("_"," ")}</span><time>{new Date(item.occurredAt).toLocaleString()}</time></div>
      <h3>{item.title}</h3><p>{item.description}</p>
      <div className="incident-meta"><span>{item.asset?.name || "Unlinked AI asset"}</span><span>{item.source || "Source not specified"}</span><span>Reported by {item.createdByMembership?.user.name || "Workspace member"}</span></div>
      {item.resolution && <div className="incident-resolution"><strong>Resolution</strong><p>{item.resolution}</p></div>}
      {canManage && nextStatus[item.status] && <div className="incident-actions">
        {item.status === "INVESTIGATING" && resolutionId === item.id ? <><input aria-label="Resolution summary" minLength={10} maxLength={3000} value={resolution} onChange={e => setResolution(e.target.value)} placeholder="Document containment, remediation, and validation…" /><button className="risk-primary" disabled={busy || resolution.trim().length < 10} onClick={() => advance(item, "RESOLVED")}>Confirm resolution</button><button className="risk-secondary" onClick={() => {setResolutionId("");setResolution("");}}>Cancel</button></> :
        <button className="session-refresh" disabled={busy} onClick={() => item.status === "INVESTIGATING" ? setResolutionId(item.id) : advance(item, nextStatus[item.status]!)}>{item.status === "INVESTIGATING" ? "Resolve incident" : item.status === "RESOLVED" ? "Close incident" : "Move to " + nextStatus[item.status]!.toLowerCase()}</button>}
      </div>}
    </article>)}</div>
    {!items.length && <div className="incident-empty"><strong>No incidents in this view</strong><span>Report an AI incident or change the filters to review other records.</span></div>}
    <p className="session-note">Lifecycle: Open → Triaged → Investigating → Resolved → Closed. Resolved incidents may be reopened for investigation; closed incidents are terminal. All changes are tenant-scoped and audited.</p>
  </section>;
}
