# SentinelAI API

NestJS API boundary for identity, tenancy, AI asset metadata, governance workflows, and audit records.

## Local run

```bash
pnpm install
pnpm --filter @sentinelai/api dev
```

Health endpoint: `GET http://localhost:4000/api/v1/health`.

Protected business endpoints will be added after the authentication and organization-membership foundation is in place.
