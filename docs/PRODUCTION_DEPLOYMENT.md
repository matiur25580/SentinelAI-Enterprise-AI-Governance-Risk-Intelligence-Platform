# Production Deployment Readiness

This guide describes the minimum operational setup for the current SentinelAI foundation. Passing CI does not mean the product is production-ready or certified.

## Current deployment shape
- **Web:** Next.js 15 (`apps/web`), build with `pnpm --filter @sentinelai/web build`, run with `pnpm --filter @sentinelai/web start`.
- **API:** NestJS (`apps/api`), build with `pnpm --filter @sentinelai/api build`, run with `pnpm --filter @sentinelai/api start`.
- **Database:** PostgreSQL 16+, managed or self-hosted. Prisma migrations live in `apps/api/prisma/migrations`.
- **AI engine:** FastAPI starter. It currently exposes health metadata only; it is not an authenticated inference service.
- Redis is present in local Compose for future background work but is not currently required by the API.

There is no checked-in production deployment manifest or container image definition. Choose a hosting platform and provision the web, API, and database as separate services; do not treat the development Compose file as a production deployment.

## Required production environment
Configure these values in the hosting provider secret/environment manager. Never commit real values.

| Variable | Requirement |
|---|---|
| `NODE_ENV` | `production` |
| `API_PORT` | Platform-assigned port or an integer from 1–65535 |
| `DATABASE_URL` | PostgreSQL connection URL; use TLS and least-privilege database credentials |
| `JWT_ACCESS_SECRET` | Unique cryptographically random secret, at least 32 characters |
| `JWT_REFRESH_SECRET` | Different unique cryptographically random secret, at least 32 characters |
| `WEB_ORIGIN` | Explicit comma-separated HTTPS origin(s), no paths |
| `TRUST_PROXY_HOPS` | Set only behind a known proxy; exact positive hop count |

Use a secret manager to generate independent JWT secrets (at least 32 random bytes each). Do not reuse development or CI secrets. Restrict who can read or rotate production secrets.

## Release procedure
1. Provision PostgreSQL with automated backups, point-in-time recovery, TLS, network restrictions, and a dedicated application role.
2. Configure required environment variables on the API service and the public web origin on the web service.
3. Build from the exact reviewed commit using Node.js 22 and pnpm 9.15.4: `pnpm install --frozen-lockfile`, `pnpm db:generate`, then `pnpm build`.
4. Before shifting traffic, run migrations once as a release step using the production `DATABASE_URL`: `pnpm db:deploy`. Do not run `prisma migrate dev` in production or concurrently from every API replica.
5. Start API and web services. Configure the platform health check to use `/api/v1/health/ready` for the API.
6. Verify the web UI, API readiness, authentication flows, CORS from the configured web origin, rate-limit behavior, and database connectivity.
7. Confirm backups and restore procedures, monitoring, log redaction, alert routing, and a rollback plan before enabling customer traffic.

## Health checks
- `GET /api/v1/health` is a liveness endpoint and does not prove the database is available.
- `GET /api/v1/health/ready` checks PostgreSQL connectivity and returns HTTP 503 when the database is unavailable.
- API responses include a server-generated `X-Request-Id`; use it to correlate client-reported failures with request-completion logs. Request logs omit raw URLs, query strings, headers, bodies, IP addresses, and user identifiers.
- The AI engine `GET /health` is metadata-only; do not expose it as a customer-facing inference endpoint.

## Go-live blockers and limitations
The repository remains early development. Before using it as a production identity/governance product, complete and independently verify at least:
- Email verification, password recovery, account lifecycle and administrator bootstrap controls.
- Cross-tenant authorization tests for every protected module, not only authentication integration tests.
- Secure headers, TLS enforcement, CSRF protections if cookie authentication is introduced, and production CORS review.
- Centralized structured logs with secret/PII redaction, metrics, tracing, alerting, and incident response ownership.
- Database backup restoration drills, migration rollback/forward-fix procedures, and capacity/load testing.
- Production security assessment and review of the AI engine future authorization, quotas, isolation, and audit context.

Do not advertise regulatory compliance or certification based solely on this software or its framework mappings.


## Automated post-deployment smoke check

The repository includes a dependency-free Node.js smoke check for the API and optional web origin. Run it from the repository root after deployment, using the exact deployed service origins:

```bash
API_BASE_URL=https://api.example.com \
WEB_ORIGIN=https://app.example.com \
node scripts/production-smoke-check.mjs
```

- `API_BASE_URL` is required and must be an HTTPS origin (HTTP is allowed only for localhost development).
- `WEB_ORIGIN` is optional; when supplied, the script verifies that the web root responds successfully.
- `SMOKE_TIMEOUT_MS` optionally sets the per-request timeout (1,000–30,000 ms; default 8,000 ms).
- The script checks API liveness and database readiness independently, validates their JSON payloads, and exits non-zero if any check fails.
- It does not authenticate, mutate data, run migrations, or verify business workflows. Use approved test accounts and a separate controlled smoke-test plan for those checks.
- Do not put credentials, query strings, or fragments in the supplied origins. Run from a trusted operator environment and avoid printing secrets in shell history.


## Scheduled GitHub Actions smoke monitoring

The `Production smoke monitoring` workflow runs daily at 06:17 UTC and can also be started manually from the Actions tab. It performs read-only GET requests through the production smoke-check script; a failed API, database-readiness, or configured web-origin check fails the workflow run.

Configure these repository-level Actions variables under **Settings → Secrets and variables → Actions → Variables**:

- `API_BASE_URL` (required): the public HTTPS origin of the deployed API, without a path, query, or credentials.
- `WEB_ORIGIN` (optional): the public HTTPS origin of the web application.

The workflow deliberately skips the smoke job and emits a notice when `API_BASE_URL` is not configured. This prevents an unconfigured workflow from being mistaken for a successful production check. Do not store secrets in these variables; the smoke checks require public service origins only.

GitHub Actions scheduled runs are best-effort and are not a substitute for a dedicated uptime-monitoring provider or an on-call alert route. Configure notification/alert ownership separately before production go-live.
