# Compliance Audit Log API

The API exposes workspace-scoped audit history at `GET /api/v1/audit-logs`.

## Authorization

Requests require a valid bearer access token and an active workspace membership. Access is limited to the following workspace roles:

- `OWNER`
- `ADMIN`
- `AI_GOVERNANCE`
- `SECURITY_ANALYST`
- `COMPLIANCE_OFFICER`
- `AUDITOR`

The `MEMBER` and `AI_ENGINEER` roles do not receive audit-log read access by default.

## Query parameters

| Parameter | Description |
| --- | --- |
| `action` | Exact audit action, for example `asset.create` |
| `entityType` | Exact entity type, for example `AIAsset` |
| `from` | Inclusive ISO-8601 lower timestamp |
| `to` | Inclusive ISO-8601 upper timestamp |
| `page` | 1-based page number; defaults to `1` |
| `limit` | Page size; defaults to `25`, maximum `100` |

The API rejects invalid ISO-8601 timestamps and ranges where `from` is later than `to`.

## Example

```http
GET /api/v1/audit-logs?action=asset.create&entityType=AIAsset&page=1&limit=25
Authorization: Bearer <access-token>
```

The response contains a `data` array and `pagination` metadata (`page`, `limit`, `total`, and `totalPages`). Entries are ordered newest-first and include the actor's ID, email, and display name when the actor still exists.

Every query is constrained by the organization ID resolved from the authenticated active membership. Clients cannot supply or override the organization scope.

## CSV export

Authorized compliance roles can export matching audit events as CSV:

```http
GET /api/v1/audit-logs/export.csv?entityType=AIAsset&from=2026-01-01T00:00:00Z&to=2026-12-31T23:59:59Z
Authorization: Bearer <access-token>
```

The export uses the same filters and organization scope as the JSON endpoint. It is ordered newest-first and includes event identifiers, timestamps, actor identity, action, entity information, and metadata. The endpoint returns an attachment with `Cache-Control: no-store` and a maximum of 10,000 records; requests exceeding that limit must narrow their filters. CSV cells are quoted and spreadsheet formula prefixes are neutralized to reduce CSV injection risk. Exports are generated on demand and are not stored by the API.

## Append-only integrity chain

A database migration adds a per-workspace SHA-256 hash chain. Each inserted event receives a monotonically increasing workspace sequence, the previous event hash, and its own record hash. A transaction-scoped row lock on the workspace chain head serializes concurrent inserts so events cannot silently fork the chain.

PostgreSQL triggers reject direct updates and deletes of audit rows. The audit actor and organization foreign keys use restrictive delete behavior so deleting a user or workspace cannot silently rewrite or cascade-delete compliance history. Existing audit rows are backfilled in deterministic timestamp/ID order during migration.

Authorized compliance roles can verify the active workspace chain:

```http
GET /api/v1/audit-logs/integrity
Authorization: Bearer <access-token>
```

The response reports whether the sequence, previous-hash links, record hashes, and stored chain head match. Verification is scoped to the authenticated workspace; clients cannot select another organization.

### Important security boundary

This provides database-enforced append-only behavior and tamper-evidence against ordinary application/database-role mutations. It is not cryptographic proof against a database superuser or an attacker who can alter triggers, functions, and chain-head data together. For stronger regulatory assurance, periodically anchor signed chain-head hashes in independently controlled immutable/WORM storage, protect signing keys in KMS/HSM, and retain independent backups. No automatic retention deletion or purge job is enabled; retention periods and legal holds must be approved and implemented as an explicit policy.
