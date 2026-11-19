# SentinelAI

**Govern Every AI. Monitor Every Risk. Trust Every Decision.**

SentinelAI is an enterprise-oriented AI governance and risk intelligence platform for registering, evaluating, monitoring, and governing AI models, LLM applications, and autonomous agents.

> **Project status:** Early development. Metrics and integrations are not represented as live until connected and verified.

## Current foundation

- Next.js 15 + TypeScript enterprise console
- NestJS API with organization-aware authentication
- PostgreSQL + Prisma ORM 7
- Redis local infrastructure for upcoming background jobs
- FastAPI AI-engine starter
- GitHub Actions build checks

## Quick start

### Prerequisites

- Node.js 22+
- pnpm 9+
- Python 3.12+
- Docker Desktop / Docker Engine with Compose

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env`. Replace the PostgreSQL password and both JWT secrets. Use two independent random secrets of at least 32 characters. Never commit `.env`.

### 2. Install and start infrastructure

```bash
pnpm install
pnpm infra:up
```

### 3. Generate Prisma client and apply database migration

```bash
pnpm db:generate
pnpm db:migrate
```

### 4. Start web and API

```bash
pnpm dev
```

- Web console: http://localhost:3000
- API liveness: http://localhost:4000/api/v1/health
- API readiness (includes PostgreSQL): http://localhost:4000/api/v1/health/ready
- AI engine (run separately): from `apps/ai-engine`, install `requirements.txt` and start Uvicorn on port 8000.

## Authentication API

All endpoints use the `/api/v1` prefix.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Create account and organization workspace |
| POST | `/auth/login` | Sign in to a workspace |
| POST | `/auth/refresh` | Rotate refresh token |
| POST | `/auth/logout` | Revoke refresh token |
| GET | `/auth/me` | Get current user and workspace (Bearer token) |

See [API setup and examples](apps/api/README.md).

## Architecture

```text
apps/
  web/          Next.js frontend
  api/          NestJS API, Prisma schema and migrations
  ai-engine/    FastAPI AI services
packages/
  shared-types/ Shared contracts (upcoming)
  config/       Shared tooling configuration (upcoming)
docs/           Architecture, security, and operations docs
infrastructure/ Deployment infrastructure (upcoming)
```

- [Architecture](docs/ARCHITECTURE.md)
- [Security baseline](docs/SECURITY.md)
- [Production deployment readiness](docs/PRODUCTION_DEPLOYMENT.md)
- [Development roadmap](docs/ROADMAP.md)

## Security principles

- Passwords are hashed with Argon2id.
- Access tokens are short-lived; refresh tokens are hashed at rest and rotated.
- Organization membership and role are embedded in access claims; protected operations must still verify active membership server-side.
- Tenant-scoped data access must always include the authenticated organization ID.
- AI prompts, retrieved content, and model outputs are untrusted inputs.
- Never commit credentials, tokens, or production data.

## Roadmap

- [x] Repository and workspace foundation
- [x] Initial PostgreSQL schema and Prisma migration
- [x] Registration, login, refresh-token rotation, logout, and current-user endpoint
- [ ] Automated auth and tenant-isolation tests
- [ ] AI asset registry APIs and UI integration
- [ ] Risk assessments, evaluation pipelines, and security testing
- [ ] Governance approvals, incident management, and audit reporting
- [ ] Production hardening and deployment

## Disclaimer

SentinelAI is a software project, not legal advice or a certification product. Framework mappings (such as NIST AI RMF, ISO/IEC 42001, or GDPR-related controls) are intended to support evidence tracking and must not be presented as proof of compliance.

## License

License selection is pending. Until a license is added, all rights are reserved by the repository owner.
