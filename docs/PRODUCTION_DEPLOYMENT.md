# Production Deployment Readiness

This guide describes the minimum operational setup for the current SentinelAI foundation. Passing CI does not mean the product is production-ready or certified.

## Current deployment shape
- **Web:** Next.js 15 (`apps/web`), build with `pnpm --filter @sentinelai/web build`, run with `pnpm --filter @sentinelai/web start`.
- **API:** NestJS (`apps/api`), build with `pnpm --filter @sentinelai/api build`, run with `pnpm --filter @sentinelai/api start`.
- **Database:** PostgreSQL 16+, managed or self-hosted. Prisma migrations live in `apps/api/prisma/migrations`.
- **AI engine:** FastAPI starter. It currently exposes health metadata only; it is not an authenticated inference service.
- Redis is present in local Compose for future background work but is not currently required by the API.

Provider-neutral production Dockerfiles are now checked in for the web and API services. There is still no provider-specific deployment manifest or production Compose stack: choose a hosting platform and provision the web, API, and database as separate services. Do not treat the development Compose file as a production deployment.

## Build and run the production container images

Build both images from the repository root (the Docker build context must be the repository root so pnpm can resolve the workspace):

```bash
docker build --pull -f Dockerfile.api -t sentinelai-api:<git-sha> .
docker build --pull -f Dockerfile.web -t sentinelai-web:<git-sha> .
```

The API image uses a multi-stage build, installs only API production dependencies in its runtime stage, includes the generated Prisma client, runs as the unprivileged `node` user, removes the unused bundled npm CLI from the runtime image, and exposes port 4000 by default. Its built-in health check calls the liveness endpoint. The web image uses Next.js standalone output, runs as the unprivileged `node` user, removes the unused bundled npm CLI from the runtime image, and exposes port 3000. Both images use Node.js 22 and pnpm 9.15.4 for reproducible workspace builds. CI builds both images on every pull request; it does not publish or deploy them.

Supply API configuration through the hosting platform's secret manager (or a protected env file outside the repository). At minimum, configure `NODE_ENV=production`, `API_PORT`, `DATABASE_URL`, independent `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, and `WEB_ORIGIN`. Set `TRUST_PROXY_HOPS` only when the exact trusted proxy chain is known. Do not bake secrets into image build arguments or image layers.

Example local smoke start commands (replace the env-file path with a protected file containing the required API settings):

```bash
docker run -d --name sentinelai-api \
  --env-file /secure/path/sentinelai-api.env \
  -p 127.0.0.1:4000:4000 sentinelai-api:<git-sha>
docker run -d --name sentinelai-web \
  -p 127.0.0.1:3000:3000 sentinelai-web:<git-sha>
```

These commands assume the API's PostgreSQL host in `DATABASE_URL` is reachable from the container. In a real deployment, attach both services to the provider's private network, route public HTTPS traffic through its managed ingress/reverse proxy, and restrict direct API/database access. The web container currently has no provider-specific API URL wiring; configure the frontend/API origin in the hosting architecture before enabling real user flows.

Database migrations are deliberately not run by API container startup. Run `pnpm db:deploy` exactly once as a controlled release step from the reviewed source revision with the production `DATABASE_URL`, before routing traffic. Do not run migrations from every API replica. The runtime API image omits the Prisma CLI and migration source tree.

CI scans both locally built production images with Trivy 0.58.1 and fails on fixable HIGH or CRITICAL vulnerability findings. The scan also generates CycloneDX SBOM files for the API and web images and uploads them as the `sentinelai-container-sboms` workflow artifact for 30 days. Run the same check locally after building both `sentinelai-api:ci` and `sentinelai-web:ci`:

```bash
bash scripts/scan-container-images.sh
```

The scan uses the current Trivy vulnerability database; results can change as that database is updated. `--ignore-unfixed` avoids blocking on findings without an available fix, not on fixable high-severity issues. Review SBOMs and vulnerability results for each release; this CI check is not a substitute for rescanning images in the registry or monitoring newly disclosed vulnerabilities.

Use immutable commit-SHA image tags for releases, scan images in the chosen registry, and retain the previous known-good image for rollback. These Dockerfiles are build artifacts only: no registry, hosting service, database, DNS, TLS certificate, or production secret has been configured by this repository.

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
| `METRICS_BEARER_TOKEN` | Optional; at least 32 random characters. Configure only when a private Prometheus scraper is used; protect it as a secret |

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
- Optional Prometheus scrape endpoint: `GET /api/v1/metrics`. Set `METRICS_BEARER_TOKEN` to a unique secret of at least 32 characters; the endpoint returns 404 when unset or invalid and requires `Authorization: Bearer ...`. Keep the endpoint private and do not expose the token to browsers. Metrics are process-local and reset on restart; aggregate replica data in an external Prometheus-compatible backend.
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


## Account email security

Email verification is enabled by default when `NODE_ENV=production`. The API then requires `RESEND_API_KEY`, `EMAIL_FROM`, and an HTTPS `APP_PUBLIC_URL` origin. Configure a verified sender/domain with Resend before enabling production registration. Verification links expire after 24 hours; password-reset links expire after 30 minutes. Both use random one-time tokens stored only as SHA-256 hashes. A successful password reset revokes every refresh-token family for the account, immediately invalidating existing access sessions. The email request endpoints return generic responses to reduce account-enumeration risk. In non-production environments, email verification can be enabled explicitly with `AUTH_REQUIRE_VERIFIED_EMAIL=true`.


## First administrator bootstrap

Self-service registration defaults to enabled in development and disabled in production. Production startup keeps it disabled unless an operator explicitly sets `ALLOW_SELF_SERVICE_REGISTRATION=true`. For a new production database, run the one-time owner bootstrap from a controlled release environment **before exposing the API**:

1. Apply the Prisma migrations to the empty production database.
2. Set `NODE_ENV=production`, `DATABASE_URL`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_PASSWORD` (at least 16 characters), and `BOOTSTRAP_ORGANIZATION_NAME` in the one-off job environment.
3. Run `pnpm --filter @sentinelai/api bootstrap:admin` from the repository root.
4. Confirm the command reports the first verified workspace owner, then remove the `BOOTSTRAP_ADMIN_*` variables from the job and runtime environment.
5. Start the API with the normal production secrets and email-delivery configuration.

The command takes a PostgreSQL advisory lock, refuses to run outside production, and aborts if **any** user already exists. It creates the first organization, a verified `OWNER` membership, an Argon2id password hash, and an audit event in one transaction. It never prints the supplied password. It is not an account-recovery or administrator-promotion command and must not be rerun against an initialized database.
