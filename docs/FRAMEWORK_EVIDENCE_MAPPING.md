# Compliance Framework Evidence Crosswalk

## Purpose

This document is a product-level navigation aid connecting selected implemented SentinelAI capabilities to indicative outcomes in:

- **NIST AI Risk Management Framework (AI RMF) 1.0** — GOVERN, MAP, MEASURE and MANAGE functions.
- **ISO/IEC 42001:2023** — selected management-system clauses.

The same crosswalk is available in the authenticated Governance overview. Use **Print / Save as PDF** to create a printable copy of the control index.

## Important limitations

This crosswalk is **not** a conformity assessment, legal opinion, certification, audit conclusion, or proof of organizational compliance. It does not establish that a customer has adopted, operated, monitored or independently tested any control. Product functionality alone is not organizational evidence.

References are concise, indicative navigation aids. They are not verbatim framework text and should be validated against the official, licensed edition and the organization's defined scope. Applicability depends on system context, risk, jurisdiction, sector, contractual obligations and operating procedures.

Before using this crosswalk in an audit or procurement response:

1. Confirm the applicable framework edition and clause/control interpretation with qualified practitioners.
2. Define the organization's AI management system scope, policies, risk appetite, roles and accountable owners.
3. Collect organization-specific evidence: approved policies, operating records, meeting decisions, risk treatment plans, monitoring outputs, training records and independent test results.
4. Verify that evidence is current, complete, attributable, retained appropriately and representative of actual operation.
5. Record gaps, compensating controls, owners, due dates and management acceptance explicitly.
6. Obtain independent legal, security and conformity-assessment advice where required.

## Control-to-evidence index

| SentinelAI control | NIST AI RMF 1.0 (indicative) | ISO/IEC 42001:2023 (indicative) | Implemented capability | Product evidence pointers |
|---|---|---|---|---|
| GOVERN-1 — Governance ownership | GOVERN 1.1–1.5 | 5.1–5.3 | Organization memberships and role-protected governance actions | Authenticated membership context, server-side role guards and audit events |
| GOVERN-2 — Accountability and competence | GOVERN 2.1–2.3 | 7.2–7.5 | Actor attribution and independent assessment review | Assessment creator/reviewer separation and append-only audit history |
| MAP-1 — Context and intended use | MAP 1.1–1.6 | 4.1–4.4 | AI asset inventory and lifecycle context | Organization-scoped AI asset register and linked assessments |
| MAP-2 — Risk identification | MAP 2.1–2.3 | 6.1–6.2 | Structured AI risk assessments | Scope, intended use, sensitivity, autonomy, impact, likelihood and exposure |
| MAP-3 — Impact and stakeholder context | MAP 3.1–3.5 | 8.1 | Assessment context and impact capture | Assessment scope, intended use, impact and evidence references |
| MEASURE-1 — Measurement and evaluation | MEASURE 1.1–1.3 | 9.1 | Versioned inherent/residual risk heuristic and aggregate reporting | Risk scores, residual bands and executive aggregates |
| MEASURE-2 — Evidence and traceability | MEASURE 2.1–2.6 | 7.5, 9.1 | Private evidence lifecycle | Checksums, malware scanning, verification, quarantine and audit history |
| MANAGE-1 — Risk treatment | MANAGE 1.1–1.4 | 6.1, 8.2 | Mitigation coverage and independent review decisions | Mitigation coverage, reviewer identity and rationale |
| MANAGE-2 — Incident response | MANAGE 2.1–2.4 | 8.4, 10.1 | Severity-based incident intake and controlled lifecycle | Assignment, investigation, resolution, closure and audit events |
| MANAGE-3 — Monitoring and accountability | MANAGE 3.1–3.2 | 7.5, 9.2 | Audit-chain verification, session revocation and operational metrics | Integrity endpoint, session security controls and report exports |

## Product evidence versus organizational evidence

SentinelAI can help record and organize selected artifacts, but it does not automatically produce the full evidence needed for an AI management system or risk management framework.

| Product artifact | What it can support | What still requires organization-specific evidence |
|---|---|---|
| AI asset and risk assessment records | Inventory and documented risk analysis | Completeness of inventory, stakeholder consultation, approved risk criteria and accountable sign-off |
| Evidence vault and verification history | Integrity and review traceability for uploaded artifacts | Source authenticity, evidence sufficiency, retention policy approval and operational use |
| Incident records | Incident intake, triage and resolution history | Tested response plans, external reporting decisions, lessons learned and corrective-action effectiveness |
| Audit trail and governance reports | Traceability and management visibility | Independent audit, management review, control operating effectiveness and remediation closure |
| Session and role controls | Application-level access governance | Organization-wide access policy, periodic access reviews and identity lifecycle procedures |

## Risk score disclaimer

SentinelAI's current risk score is a project-specific heuristic for triage and workflow support. It is not a NIST AI RMF score, an ISO/IEC 42001 maturity rating, a legal classification, or a validated actuarial model.

## Official sources

- NIST, [AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) and [AI RMF 1.0 publication](https://doi.org/10.6028/NIST.AI.100-1).
- ISO, [ISO/IEC 42001:2023 — Artificial intelligence management system](https://www.iso.org/standard/81230.html).

Consult the official publications for authoritative requirements and interpretation.
