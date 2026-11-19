"use client";

import { useCallback, useEffect, useState } from "react";

type Bucket = { status?: string; severity?: string; residualLevel?: string; assetType?: string; count: number };
type Report = {
  generatedAt: string;
  period: { from: string | null; to: string | null; mode: "ALL_TIME" | "FILTERED" };
  assets: { total: number; byStatus: Bucket[]; byType: Bucket[] };
  assessments: { total: number; byStatus: Bucket[]; byResidualLevel: Bucket[]; averageResidualScore: number };
  incidents: { total: number; byStatus: Bucket[]; bySeverity: Bucket[] };
  evidence: { total: number; byStatus: Bucket[]; underLegalHold: number };
  audit: { total: number; recentActivity: Array<{ id: string; action: string; entityType: string; entityId: string | null; createdAt: string; actor: { name: string; email: string } | null }> };
  caveat: string;
};
type Api = (path: string, options?: RequestInit) => Promise<any>;

function Distribution({ title, rows }: { title: string; rows: Bucket[] }) {
  const max = Math.max(1, ...rows.map(row => row.count));
  return <div className="governance-distribution">
    <h3>{title}</h3>
    {rows.length ? rows.map((row, index) => {
      const label = row.status || row.severity || row.residualLevel || row.assetType || "Other";
      return <div className="governance-bar-row" key={label}>
        <div><span>{label.replaceAll("_", " ")}</span><strong>{row.count.toLocaleString()}</strong></div>
        <div className="governance-bar-track"><i style={{ width: (row.count / max * 100) + "%" }} /></div>
      </div>;
    }) : <p className="governance-no-data">No records in this period.</p>}
  </div>;
}

export default function GovernanceReportsPanel({ api, downloadUrl, token }: { api: Api; downloadUrl: string; token: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const params = () => {
    const query = new URLSearchParams();
    if (from) query.set("from", from + "T00:00:00.000Z");
    if (to) query.set("to", to + "T23:59:59.999Z");
    return query;
  };
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams();
      if (from) query.set("from", from + "T00:00:00.000Z");
      if (to) query.set("to", to + "T23:59:59.999Z");
      setReport(await api("/governance/reports/summary" + (query.size ? "?" + query.toString() : "")));
    } catch (err) { setError(err instanceof Error ? err.message : "Governance report could not be loaded."); }
    finally { setBusy(false); }
  }, [api, from, to]);

  useEffect(() => { load(); }, [load]);

  async function exportCsv() {
    setExporting(true); setError("");
    try {
      const query = params();
      const response = await fetch(downloadUrl + "/governance/reports/export.csv" + (query.size ? "?" + query.toString() : ""), {
        headers: { authorization: "Bearer " + token },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Report export failed (" + response.status + ").");
      }
      const url = window.URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "sentinelai-governance-report.csv";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err instanceof Error ? err.message : "Report export failed."); }
    finally { setExporting(false); }
  }

  return <section className="governance-report-panel" id="governance-reports">
    <div className="governance-report-heading">
      <div><div className="risk-kicker">EXECUTIVE / COMPLIANCE INTELLIGENCE</div><h2>Governance overview</h2><p>Organization-wide inventory, risk posture, incidents, evidence, and accountability activity.</p></div>
      <button className="risk-primary" disabled={!report || exporting} onClick={exportCsv}>{exporting ? "Preparing…" : "↓ Export report CSV"}</button>
    </div>
    <div className="governance-report-filters">
      <label>From<input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></label>
      <label>To<input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
      <button className="session-refresh" disabled={busy || (!!from && !!to && from > to)} onClick={load}>↻ Refresh report</button>
      <span>{report?.period.mode === "ALL_TIME" ? "All-time totals" : "Filtered by record creation date"}</span>
    </div>
    {error && <p className="governance-report-error" role="alert">{error}</p>}
    {busy && !report && <div className="session-empty"><strong>Building organization report…</strong></div>}
    {report && <>
      <div className="governance-kpis">
        <article><span>AI ASSETS</span><strong>{report.assets.total.toLocaleString()}</strong><small>Registered systems</small></article>
        <article><span>RISK ASSESSMENTS</span><strong>{report.assessments.total.toLocaleString()}</strong><small>Avg residual score {report.assessments.averageResidualScore.toFixed(2)}</small></article>
        <article><span>AI INCIDENTS</span><strong>{report.incidents.total.toLocaleString()}</strong><small>{report.incidents.byStatus.find(x => x.status === "OPEN")?.count || 0} currently open</small></article>
        <article><span>EVIDENCE FILES</span><strong>{report.evidence.total.toLocaleString()}</strong><small>{report.evidence.underLegalHold.toLocaleString()} under legal hold</small></article>
        <article><span>AUDIT EVENTS</span><strong>{report.audit.total.toLocaleString()}</strong><small>Append-only accountability records</small></article>
      </div>
      <div className="governance-report-grid">
        <Distribution title="Residual risk distribution" rows={report.assessments.byResidualLevel} />
        <Distribution title="Incident severity" rows={report.incidents.bySeverity} />
        <Distribution title="Assessment lifecycle" rows={report.assessments.byStatus} />
        <Distribution title="Incident lifecycle" rows={report.incidents.byStatus} />
        <Distribution title="AI asset status" rows={report.assets.byStatus} />
        <Distribution title="Evidence status" rows={report.evidence.byStatus} />
      </div>
      <div className="governance-recent-activity"><div><h3>Recent governance activity</h3><span>Latest 10 events in the selected period</span></div>
        {report.audit.recentActivity.length ? <div className="governance-activity-list">{report.audit.recentActivity.map(event => <article key={event.id}><strong>{event.action}</strong><span>{event.entityType}{event.entityId ? " · " + event.entityId.slice(0, 12) : ""}</span><small>{event.actor?.name || event.actor?.email || "System / unknown actor"} · {new Date(event.createdAt).toLocaleString()}</small></article>)}</div> : <p className="governance-no-data">No audit activity in this period.</p>}
      </div>
      <p className="governance-report-caveat">{report.caveat} Generated {new Date(report.generatedAt).toLocaleString()}.</p>
    </>}
  </section>;
}
