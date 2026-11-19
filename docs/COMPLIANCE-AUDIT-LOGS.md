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
