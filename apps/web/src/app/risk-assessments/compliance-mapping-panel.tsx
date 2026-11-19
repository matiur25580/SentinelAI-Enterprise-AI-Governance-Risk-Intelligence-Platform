"use client";

const CONTROLS = [
  { id: "GOVERN-1", nist: "GOVERN 1.1–1.5", iso: "5.1–5.3", domain: "Governance ownership", capability: "Organization roles, active memberships and role-protected governance actions.", evidence: "Authenticated membership context; server-side role guards; audit events.", references: "apps/api/src/auth · apps/api/src/audit-logs" },
  { id: "GOVERN-2", nist: "GOVERN 2.1–2.3", iso: "7.2–7.5", domain: "Accountability & competence", capability: "Actor attribution, independent assessment review and recorded reviewer rationale.", evidence: "Risk assessment creator/reviewer separation; append-only audit history.", references: "docs/RISK_ASSESSMENT_WORKFLOW.md · docs/COMPLIANCE-AUDIT-LOGS.md" },
  { id: "MAP-1", nist: "MAP 1.1–1.6", iso: "4.1–4.4", domain: "Context & intended use", capability: "AI asset inventory captures asset type, provider, model identifier and lifecycle context.", evidence: "Organization-scoped AI asset register and linked risk assessments.", references: "apps/api/src/assets · apps/api/src/risk-assessments" },
  { id: "MAP-2", nist: "MAP 2.1–2.3", iso: "6.1–6.2", domain: "Risk identification", capability: "Risk assessments record intended use, scope, data sensitivity, autonomy, impact, likelihood and exposure.", evidence: "Versioned server-side risk calculation and assessment records.", references: "docs/RISK_ASSESSMENT_WORKFLOW.md" },
  { id: "MAP-3", nist: "MAP 3.1–3.5", iso: "8.1", domain: "Impact & stakeholder context", capability: "Assessment scope and intended-use fields support documenting affected contexts and expected impacts.", evidence: "Assessment scope, intended-use and impact fields; evidence references.", references: "apps/api/src/risk-assessments" },
  { id: "MEASURE-1", nist: "MEASURE 1.1–1.3", iso: "9.1", domain: "Measurement & evaluation", capability: "Transparent inherent/residual risk heuristic with a stored scoring version and portfolio aggregation.", evidence: "Risk scores, residual risk bands and executive governance aggregates.", references: "apps/api/src/risk-assessments · apps/api/src/governance-reports" },
  { id: "MEASURE-2", nist: "MEASURE 2.1–2.6", iso: "7.5 · 9.1", domain: "Evidence & traceability", capability: "Private evidence uploads, SHA-256 checksums, malware scanning and independent verification.", evidence: "Evidence metadata, verification decisions, quarantine status and audit records.", references: "docs/EVIDENCE_STORAGE_WORKFLOW.md" },
  { id: "MANAGE-1", nist: "MANAGE 1.1–1.4", iso: "6.1 · 8.2", domain: "Risk treatment", capability: "Mitigation coverage, review decisions and controlled approval/rejection lifecycle.", evidence: "Assessment mitigation coverage, reviewer identity and rationale.", references: "docs/RISK_ASSESSMENT_WORKFLOW.md" },
  { id: "MANAGE-2", nist: "MANAGE 2.1–2.4", iso: "8.4 · 10.1", domain: "Incident response", capability: "Severity-based AI incident intake, assignment, investigation, resolution and closure.", evidence: "Tenant-scoped incident lifecycle and corresponding audit events.", references: "apps/api/src/incidents" },
  { id: "MANAGE-3", nist: "MANAGE 3.1–3.2", iso: "7.5 · 9.2", domain: "Monitoring & accountability", capability: "Audit-chain integrity verification, session revocation, metrics and governance reporting.", evidence: "Audit integrity endpoint, session security controls and report exports.", references: "apps/api/src/audit-logs · apps/api/src/auth · ops/" },
];

export default function ComplianceMappingPanel() {
  return <section className="compliance-mapping-panel" id="sentinelai-compliance-mapping">
    <div className="compliance-mapping-heading">
      <div><div className="risk-kicker">CONTROL CROSSWALK / EVIDENCE INDEX</div><h2>Compliance framework mapping</h2><p>Indicative alignment of implemented SentinelAI capabilities to selected framework outcomes.</p></div>
      <button className="risk-primary compliance-print-button" onClick={() => window.print()}>Print / Save as PDF</button>
    </div>
    <div className="compliance-mapping-note"><strong>Read this mapping correctly:</strong> This is an engineering crosswalk, not a legal opinion, conformity assessment, certification, or proof that an organization meets any framework. References are indicative and must be validated against the official framework edition, organizational scope, operating procedures and independently collected evidence. A listed product capability is not evidence that a customer has implemented or operated that control.</div>
    <div className="compliance-framework-legend"><span><b>NIST AI RMF 1.0</b> · GOVERN / MAP / MEASURE / MANAGE</span><span><b>ISO/IEC 42001:2023</b> · indicative clause references</span></div>
    <div className="compliance-table-wrap"><table className="compliance-mapping-table">
      <thead><tr><th>Control</th><th>Framework reference</th><th>Governance domain</th><th>SentinelAI capability</th><th>Evidence / repository reference</th></tr></thead>
      <tbody>{CONTROLS.map(row => <tr key={row.id}>
        <td><strong>{row.id}</strong></td>
        <td><span>NIST: {row.nist}</span><span>ISO: {row.iso}</span></td>
        <td>{row.domain}</td><td>{row.capability}</td><td><p>{row.evidence}</p><small>{row.references}</small></td>
      </tr>)}</tbody>
    </table></div>
    <p className="compliance-mapping-footnote">Framework references are concise navigation aids, not verbatim quotations. Always consult the licensed/official framework text and obtain qualified compliance review before relying on this crosswalk.</p>
  </section>;
}
