# PostgreSQL Backup and Recovery Runbook

This runbook is an operator checklist for the current SentinelAI PostgreSQL database. Adapt retention, RPO, RTO, encryption, and access controls to the hosting provider and the organization's risk requirements before go-live.

## Scope and ownership

- Database: PostgreSQL 16 or later, used by the NestJS API through Prisma.
- Migration source of truth: `apps/api/prisma/migrations`.
- Assign a primary and backup operator before production use. Record the incident commander and escalation route in the deployment environment's private operations record; do not put personal contact details or credentials in this repository.
- Define and approve recovery point objective (RPO), recovery time objective (RTO), backup retention, and data residency requirements before enabling customer traffic.

## Required controls before go-live

- Prefer a managed PostgreSQL service with automated backups and point-in-time recovery (PITR).
- Enable provider-side encryption at rest and TLS in transit. Restrict database network ingress to application and operator networks.
- Use a dedicated least-privilege backup identity. Keep backup credentials in the provider secret manager, separate from application credentials.
- Encrypt exported backup artifacts before they leave the trusted database environment. Store encryption keys separately from backup objects.
- Store backups in a separate account/project or otherwise isolated storage location with access logging and deletion protection.
- Set retention to meet approved policy and legal requirements. Verify backup completion and alert on missed or failed backups.
- Never commit database URLs, passwords, access tokens, encryption keys, or real customer data.

## Logical backup (operator initiated)

Use a trusted operator workstation or isolated backup runner with PostgreSQL client tools compatible with the server version. The following example uses a custom-format dump; provide the connection string through a protected environment/secret mechanism rather than placing it in shell history.

```bash
umask 077
export DATABASE_URL='postgresql://<backup-user>:<secret>@<db-host>:5432/<database>?sslmode=require'
pg_dump --format=custom --no-owner --no-acl --dbname="$DATABASE_URL" --file="sentinelai-$(date -u +%Y%m%dT%H%M%SZ).dump"
unset DATABASE_URL
```

- Confirm the command exits successfully and the output file is non-empty.
- Encrypt the dump using the organization's approved encryption tooling before upload.
- Upload to the isolated backup location; verify object integrity using a cryptographic checksum and the storage provider's integrity/versioning controls.
- Record timestamp, database identifier (not its connection string), dump size, checksum, encryption key reference, and operator in the approved private backup register.
- Remove unencrypted temporary artifacts from the runner after verifying the encrypted copy. Ensure temporary storage is encrypted and access-restricted.

A logical dump is not a substitute for provider-managed physical backups/PITR. For production, enable both where supported and appropriate.

## Restore drill (isolated environment only)

Perform regular restore drills at the cadence set by the service owner and after material database/migration changes. Never test restoration over the live production database.

1. Select a recent backup and verify its checksum and encryption metadata.
2. Provision an isolated PostgreSQL instance with compatible major version, network restrictions, and no public ingress.
3. Decrypt the backup only in the restricted restore environment.
4. Create a fresh empty target database and restore the custom-format dump:

```bash
createdb --host=<restore-host> --username=<restore-operator> sentinelai_restore
pg_restore --host=<restore-host> --username=<restore-operator> --dbname=sentinelai_restore --no-owner --no-acl <verified-backup.dump>
```

5. Apply no migrations automatically during the restore itself. First inspect the restored schema and Prisma migration history; then follow the approved recovery plan to apply any required forward migrations.
6. Validate table counts and representative records using approved non-sensitive checks. Verify organization/tenant relationships, audit-log continuity, and authentication/session data integrity without exposing secrets or personal data in logs.
7. Start an isolated API configured to use the restored database. Verify `GET /api/v1/health/ready`, authentication integration smoke tests, and representative read-only application flows.
8. Record achieved recovery time, backup age/data loss estimate, validation results, issues, and corrective actions. Destroy the isolated environment and temporary decrypted artifacts securely.

## Point-in-time recovery

For a managed PostgreSQL provider, use its documented PITR workflow to create a new isolated instance at the approved recovery timestamp. Validate that instance using the restore-drill steps above before considering traffic cutover. Do not restore in place as the first response to an incident.

## Incident recovery and cutover

- Declare an incident and assign an incident commander and database operator.
- Preserve relevant logs and provider backup/PITR metadata. Avoid destructive actions until the recovery target and timestamp are agreed.
- Choose the newest verified recovery point that meets the incident objective; document expected data loss.
- Restore to a new isolated instance and complete validation.
- Obtain explicit approval from the service owner before changing the production database endpoint.
- Update the production secret/configuration through the hosting provider's secret manager, restart or roll the API safely, and verify readiness plus application smoke tests.
- Monitor error rates, database connections, authentication, audit writes, and queue/backlog indicators after cutover.
- Keep the previous database and incident evidence protected until the incident commander approves disposal, subject to retention policy.

## Recovery limitations and cautions

- PostgreSQL backups contain sensitive business and potentially personal data. Treat them at least as restrictively as production data.
- A successful dump or provider backup status does not prove restorability; only a completed restore drill provides evidence.
- Prisma migrations should be executed as a single controlled release step, not independently by every API replica.
- The API readiness endpoint confirms database connectivity, not backup health, data correctness, or end-to-end customer readiness.
- This repository does not configure a hosting provider's backup schedule, retention, PITR, encryption, alerts, or restore permissions. Those controls must be configured and tested in the chosen provider.
- Do not claim an RPO/RTO, compliance status, or backup coverage until the service owner has approved targets and a successful restore drill has been recorded.
