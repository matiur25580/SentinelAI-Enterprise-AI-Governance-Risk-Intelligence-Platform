# SentinelAI API

NestJS API for identity, organization tenancy, AI asset metadata, governance workflows, and audit records.

## Local setup

From the repository root:

```bash
cp .env.example .env
# Edit .env and replace all development secrets.
pnpm install
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm --filter @sentinelai/api dev
```

Health endpoint: `GET http://localhost:4000/api/v1/health`.

## Authentication endpoints

All routes are prefixed with `/api/v1`.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/register` | Create a user and a new organization workspace |
| POST | `/auth/login` | Authenticate with email/password and optional workspace slug |
| POST | `/auth/refresh` | Rotate a refresh token and issue a new token pair |
| POST | `/auth/logout` | Revoke a refresh token (idempotent) |
| GET | `/auth/me` | Return the authenticated user and active workspace |

Registration example:

```bash
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Workspace Owner",
    "email": "owner@example.com",
    "password": "Use-A-Unique-Password-123!",
    "organizationName": "Example Organization"
  }'
```

Use the returned access token as `Authorization: Bearer <accessToken>` for `GET /api/v1/auth/me`.

## Data model

The first migration creates organizations, users, memberships, refresh-token sessions, AI asset inventory, and audit logs. Memberships are organization-scoped and carry a role. Protected API queries must always use the authenticated organization context.

## Security notes

- Passwords are hashed with Argon2id.
- Access tokens are short-lived (15 minutes).
- Refresh tokens are stored only as Argon2id hashes and rotated on use.
- JWT access and refresh secrets must be independent random values of at least 32 characters.
- Registration assigns the creator the workspace OWNER role.
- Email verification, rate limiting, account recovery, SSO, and invitation workflows are not implemented yet; do not expose this foundation as a production identity service until those controls and tests are completed.


## AI incident management

All incident endpoints require an authenticated bearer token and operate within the caller's active organization.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/incidents` | Register an AI incident (workspace incident-manager roles) |
| GET | `/incidents` | List incidents with optional `status`, `severity`, `page`, and `limit` filters |
| GET | `/incidents/:id` | Retrieve one incident within the active organization |
| PATCH | `/incidents/:id` | Advance lifecycle, assign an active workspace member, or record resolution (workspace incident-manager roles) |

Lifecycle transitions are `OPEN → TRIAGED → INVESTIGATING → RESOLVED → CLOSED`. A resolved incident may be reopened to `INVESTIGATING`; a closed incident is terminal. A resolution summary is required before resolution. Every create/update is recorded in the append-only organization audit chain. Supported incident-manager roles: `OWNER`, `ADMIN`, `AI_GOVERNANCE`, `SECURITY_ANALYST`, and `COMPLIANCE_OFFICER`.
