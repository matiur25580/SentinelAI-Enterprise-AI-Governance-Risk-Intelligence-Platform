# SentinelAI

**Govern Every AI. Monitor Every Risk. Trust Every Decision.**

SentinelAI is an enterprise-oriented AI governance and risk intelligence platform for registering, evaluating, monitoring, and governing AI models, LLM applications, and autonomous agents.

> **Project status:** Foundation / early development. Features are being implemented incrementally. Metrics and integrations are not represented as live until connected and verified.

## Vision

Organizations are adopting AI faster than they can inventory, assess, secure, and monitor it. SentinelAI aims to provide one auditable control plane for:

- AI asset and model inventory
- Risk assessments with evidence and mitigation actions
- LLM evaluation and quality benchmarking
- AI security testing in controlled environments
- Policy, approval, and compliance evidence workflows
- Usage, latency, reliability, and cost observability
- Human oversight and incident response

## Architecture (initial target)

| Layer | Technology | Responsibility |
|---|---|---|
| Web | Next.js, React, TypeScript | Enterprise console and user workflows |
| API | NestJS, TypeScript | Authentication, tenancy, RBAC, business APIs |
| AI engine | Python, FastAPI | Evaluation, risk analysis, provider adapters |
| Data | PostgreSQL, Prisma | Transactional data and audit records |
| Jobs/cache | Redis, BullMQ | Asynchronous evaluation and monitoring jobs |
| Operations | Docker, GitHub Actions | Local development and CI |

The initial implementation is a modular monorepo. Separate services are introduced only where they provide a clear operational boundary.

## Repository layout

```text
apps/
  web/          Next.js frontend
  api/          NestJS backend
  ai-engine/    FastAPI AI services
packages/
  shared-types/ Shared contracts
  config/       Shared tooling configuration
docs/           Architecture, security, and operations docs
infrastructure/ Local and deployment infrastructure
```

## Getting started

The repository foundation is being assembled. The first milestone provides workspace conventions, local PostgreSQL/Redis services, environment templates, and architecture documentation. Application packages and migrations will be added in subsequent milestones.

### Prerequisites

- Node.js 22+
- pnpm 9+
- Python 3.12+
- Docker Desktop / Docker Engine with Compose

### Environment

Copy `.env.example` to `.env` and replace development secrets before running services. Never commit real credentials.

## Security principles

- Enforce organization/tenant isolation in the API and database access layer.
- Enforce permissions server-side; hiding frontend controls is not authorization.
- Hash passwords with Argon2id and rotate refresh tokens.
- Validate inputs, rate-limit sensitive endpoints, and redact secrets/PII from logs.
- Treat model output and retrieved content as untrusted input.
- Run agent tools and red-team tests only in explicitly authorized, isolated environments.
- Keep audit events attributable and tamper-evident.

## Roadmap

- [x] Repository foundation and architecture baseline
- [ ] Application workspace and health endpoints
- [ ] Authentication, organizations, and server-side RBAC
- [ ] AI asset registry and audit trail
- [ ] Risk assessment and evaluation pipelines
- [ ] Security testing, approvals, and incident workflows
- [ ] Observability, FinOps, CI, and deployment hardening

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Security baseline](docs/SECURITY.md)
- [Development plan](docs/ROADMAP.md)

## Disclaimer

SentinelAI is a software project, not legal advice or a certification product. Framework mappings (such as NIST AI RMF, ISO/IEC 42001, or GDPR-related controls) are intended to support evidence tracking and must not be presented as proof of compliance.

## License

License selection is pending. Until a license is added, all rights are reserved by the repository owner.
