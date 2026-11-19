# Security Baseline

This document is an engineering baseline, not a security certification.

## Identity and access

- Passwords: Argon2id with parameters appropriate to the deployment environment.
- Sessions: short-lived access tokens and rotating refresh tokens; revoke token families on reuse detection.
- Authorization: server-side RBAC with organization-scoped membership checks on every protected operation.
- Administrative actions: require explicit permissions and create audit events.

## Application security

- Validate all request bodies, query parameters, and uploaded files.
- Apply database-backed, per-client-IP rate limits to authentication endpoints: registration (5), login (10), refresh (30), and logout (30) requests per 15-minute window.
- Rate-limit buckets use hashed client identifiers and are shared across API replicas through PostgreSQL. Requests fail closed if the limiter store is unavailable.
- Behind a reverse proxy, configure TRUST_PROXY_HOPS to the exact number of trusted proxy hops. Do not enable proxy trust for arbitrary/untrusted proxies; otherwise clients may spoof their IP and bypass IP-based limits.
- Use secure headers, TLS, restrictive CORS, and CSRF protection where cookie-based auth is used.
- Use parameterized database access; never concatenate user input into SQL.
- Redact credentials, tokens, and sensitive personal data from logs.
- Store secrets in environment/secret managers, never in source control.

## AI-specific security

- Treat prompts, retrieved documents, model outputs, and tool results as untrusted.
- Separate system policy from user-controlled content.
- Apply least privilege to agent tools and require approval for consequential actions.
- Run adversarial tests only against systems and datasets the operator is authorized to test.
- Do not execute generated code or arbitrary tools on the API host.
- Record test scope, version, and evidence for each security assessment.

## Tenant isolation

- Resolve organization context from the authenticated membership, not from an untrusted request field alone.
- Scope every read/write by organization ID.
- Add automated cross-tenant access tests for each organization-scoped module.
- Avoid leaking resource existence through error messages.

## Incident response

- Preserve relevant audit records.
- Rotate affected credentials and revoke sessions.
- Record incident timeline, impact, remediation, and post-incident actions.
