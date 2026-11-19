# Monitoring, Alerting, and Incident Operations

This is a provider-neutral operations plan for SentinelAI. It documents what an operator should configure in the chosen hosting, database, and observability platforms. It does not install an agent, create dashboards, or prove that alerts are active.

## Current signals and limitations

- API liveness: `GET /api/v1/health`. Use this to detect whether the API process responds; it is not a dependency check.
- API readiness: `GET /api/v1/health/ready`. Use this for traffic readiness and database-connectivity monitoring. It returns HTTP 503 when PostgreSQL is unavailable.
- Request telemetry: each API response includes a server-generated `X-Request-Id`; the API emits one JSON `http.request` event on response completion with the request ID, method, route template, status code, and duration.
- CI: GitHub Actions runs the repository Quality and Security workflows on their configured events.
- PostgreSQL and Redis are defined for local development in Docker Compose. Production database/Redis monitoring must be configured in the selected provider.
- The repository does not currently define a production metrics exporter, tracing backend, centralized log pipeline, pager integration, or alert rules. Do not assume these are enabled.

## Minimum telemetry before customer traffic

Configure the following in the hosting/observability provider, with access restricted to authorized operators:

### API service
- Request count and rate, grouped by route template and status class (avoid raw URLs containing identifiers).
- Request latency percentiles (p50, p95, p99) and 4xx/5xx rates.
- Process restarts, memory/CPU utilization, event-loop saturation, and instance availability.
- PostgreSQL connection acquisition failures, query latency, pool saturation, and timeout counts.
- Authentication outcomes and rate-limit responses (aggregate counts only; never log passwords, tokens, authorization headers, or raw IP addresses).
- Audit-write failures and transaction rollback counts. Alert on failures without logging sensitive event payloads.

### PostgreSQL
- Availability and connection saturation.
- CPU, memory, storage utilization, IOPS/throughput, and replication lag where applicable.
- Query latency, lock waits, deadlocks, transaction age, and connection errors.
- Backup/PITR job outcomes, backup age, storage integrity checks, and restore-drill results.

### Web and external dependencies
- Web availability, page/API error rates, and latency from an external synthetic check.
- DNS/TLS certificate expiry and domain resolution.
- Redis availability only if a production feature depends on it.
- Hosting-provider status and upstream dependency failures.

## Starter alert policy

These are conservative initial suggestions, not measured service-level objectives. Tune them after collecting baseline traffic and agreeing service objectives.

| Signal | Initial trigger | Suggested response |
|---|---|---|
| API readiness | 3 consecutive failures over 2 minutes | Page on-call; inspect API and PostgreSQL |
| API 5xx rate | Above 5% for 5 minutes with meaningful traffic | Page on-call; inspect recent release and dependencies |
| API latency | p95 above 1 second for 10 minutes | Investigate route latency, DB pool and query performance |
| PostgreSQL availability | Any sustained failed health check | Page database and API owner |
| DB connections | Above 80% of configured limit for 10 minutes | Investigate leaks/pool sizing; prepare capacity action |
| DB storage | Above 80% warning; above 90% critical | Expand capacity or safely reduce usage |
| Backup freshness | Latest successful backup older than approved RPO | Page database owner; verify backup/PITR pipeline |
| Audit persistence | Any sustained audit-write failure | Treat as security-relevant; investigate immediately |
| TLS certificate | Expires within 14 days | Renew and verify certificate chain |
| CI security checks | Required CodeQL or dependency audit fails on release candidate | Block release; triage and remediate |

Avoid paging on a single transient sample. Use consecutive failures, minimum traffic thresholds, deduplication, and recovery notifications. Define severity and escalation ownership in the private on-call system.

## Logging and privacy

- Emit structured logs with timestamp, severity, service, environment, route template, status, duration, and a generated correlation/request ID. The API baseline emits JSON request-completion events and returns the server-generated ID in `X-Request-Id` (also exposed to browser clients through CORS). Use that ID to correlate a client report with the corresponding API log.
- Redact authorization headers, cookies, passwords, access/refresh tokens, secrets, database URLs, and request bodies by default. The built-in request event intentionally excludes headers, bodies, query strings, raw URLs, IP addresses, and user identifiers; preserve this allowlist when extending telemetry.
- Do not log raw IP addresses or unfiltered user-provided prompts unless a documented, approved need and retention policy exist.
- Keep audit records separate from diagnostic logs. Never mutate or use operational log retention as a substitute for the append-only application audit trail.
- Restrict log access, encrypt transport and storage, set retention limits, and audit operator access.
- Ensure error reporting does not attach environment variables, secrets, or full request payloads.

## On-call response checklist

1. Acknowledge the alert and record incident start time, affected service, severity, and incident commander.
2. Determine customer impact using readiness, error rate, latency, and provider status. Compare against the most recent deployment.
3. Preserve relevant redacted logs, metrics, traces, CI run links, and database/provider events.
4. For an API issue, check process health, recent release, environment validation, database connectivity, pool saturation, and rate-limit behavior.
5. For a database issue, check provider status, connections, storage, locks, backup/PITR status, and replication health. Follow `docs/DATABASE_BACKUP_RECOVERY.md` for recovery; never improvise a destructive restore.
6. Mitigate using a reviewed rollback, capacity adjustment, or failover procedure. Obtain the required change approval and record actions.
7. Verify readiness and representative application flows after mitigation. Monitor for recurrence before resolving the incident.
8. Write a blameless post-incident review with timeline, impact, root cause, contributing factors, detection gap, and tracked corrective actions.

## Release and change monitoring

- Before release, require green Quality/Integration, CodeQL, and dependency audit checks on the exact candidate commit.
- During rollout, watch API 5xx, p95 latency, process restarts, DB connections, and readiness.
- Stop or roll back the rollout if agreed error/latency thresholds are exceeded or data integrity is uncertain.
- Run schema migrations once as a controlled release step, not from every API replica.
- After release, verify audit writes and authentication flows with approved test accounts; do not use real customer credentials in smoke tests.

## Ownership and go-live checklist

- [ ] Named primary/backup on-call owners and escalation path recorded privately.
- [ ] Metrics, logs, and (where supported) traces are flowing and access-controlled.
- [ ] Alerts are routed, deduplicated, tested, and have documented responders.
- [ ] Synthetic checks cover web availability and API readiness.
- [ ] Backup freshness alert and restore-drill evidence are available.
- [ ] Dashboard includes API health, latency/errors, database health, and release markers.
- [ ] Log redaction and retention have been tested with representative errors.
- [ ] Incident and rollback exercises have been completed.

Do not claim monitoring coverage, an SLA/SLO, or 24/7 response until the provider configuration, alert routing, ownership, and test evidence are in place.
