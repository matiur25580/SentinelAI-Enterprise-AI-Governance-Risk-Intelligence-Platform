# Governance Audit Package Export

## Overview

The authenticated Governance Reports API can generate a downloadable ZIP audit package containing a printable PDF, a JSON evidence manifest, a governance summary, and CSV inventories. This is an export of records available to the authenticated organization at generation time; it is not an immutable snapshot of external systems.

## Endpoint

`GET /api/v1/governance/reports/export.zip`

Optional query parameters:

- `from`: ISO-8601 timestamp; includes records created at or after this instant.
- `to`: ISO-8601 timestamp; includes records created at or before this instant.

If neither is supplied, the export covers all records available to the organization, subject to the record caps below. If both are supplied, `from` must not be later than `to`.

The endpoint uses the same JWT and workspace-role guards as the governance report summary and CSV endpoints. Permitted roles are OWNER, ADMIN, AI_GOVERNANCE, SECURITY_ANALYST, COMPLIANCE_OFFICER and AUDITOR. The organization scope is taken exclusively from the authenticated membership; callers cannot supply an organization ID.

Example:

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $SENTINELAI_ACCESS_TOKEN" \
  "https://YOUR_API_HOST/api/v1/governance/reports/export.zip?from=2026-01-01T00:00:00.000Z" \
  --output sentinelai-governance-audit-package.zip
```

## ZIP contents

| File | Contents |
|---|---|
| `report.pdf` | Printable multi-page executive report with asset, risk, evidence, incident and audit summaries |
| `manifest.json` | Package schema version, generation time, selected period, record counts, audit integrity result and limitations |
| `governance-summary.json` | Machine-readable summary, detailed inventories, audit chain metadata and framework mapping caveats |
| `assets.csv` | AI asset inventory and owner attribution |
| `risk-assessments.csv` | Assessment scope, scores, scoring version, status and review attribution |
| `evidence-inventory.csv` | Evidence metadata, verification state, retention dates and legal-hold details |
| `incidents.csv` | Incident severity, lifecycle, linked asset and resolution metadata |
| `audit-trail.csv` | Organization audit events, actor attribution, sequence and hash-chain references |
| `README.txt` | Package contents and handling notes |

The ZIP is generated using Node.js built-ins; no runtime PDF or ZIP package is required. CSV values are quoted and spreadsheet-formula-prefixed values are neutralized.

## Scope and safety limits

- Every database query is constrained by `organizationId` from the authenticated user context.
- Export caps: 1,000 assets, 1,000 risk assessments, 1,000 incidents, 2,000 evidence records and 5,000 audit events. Requests above a cap return HTTP 400 and should be narrowed using date filters.
- Export creation appends a `governance.audit_package_export` event to the organization audit chain. The package includes the chain-verification result at export time and the selected-period audit trail, including the export event when it falls within the chosen period.
- Evidence file bytes, storage keys, signed download URLs, storage credentials, environment secrets and password hashes are never included. Evidence exports contain metadata only.
- The PDF uses a built-in standard font and replaces unsupported non-ASCII glyphs; JSON and CSV retain UTF-8 data.
- Responses use ZIP content type, attachment disposition, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

## Interpretation limitations

Framework references to NIST AI RMF 1.0 and ISO/IEC 42001:2023 are indicative product-capability crosswalks only. This package is not a conformity assessment, certification, legal opinion, audit conclusion or proof of organizational compliance. Product capability does not establish that an organization has adopted, operated or independently tested a control.

Risk levels are calculated using the SentinelAI project-specific heuristic and scoring version recorded with each assessment. They are not official NIST/ISO scores, actuarial estimates or validated regulatory thresholds. Review the original records and the applicable framework edition before making governance decisions.

## Verification

The API integration suite validates ZIP structure and entry contents, PDF signature, JSON/CSV inventory presence, audit export event creation, audit integrity result, secret/storage-key exclusion and cross-tenant isolation.
