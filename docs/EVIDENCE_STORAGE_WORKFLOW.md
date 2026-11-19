# Private Evidence Storage and Verification

## Overview

Risk assessment evidence can be uploaded to a private S3-compatible object store using short-lived SigV4 presigned URLs. The API stores organization-scoped metadata and verifies the uploaded object's size, content type, and SHA-256 checksum, validates its file signature/encoding, and submits the bytes to ClamAV before making it available to reviewers. Clean files become `UPLOADED`; detected malware is moved to `QUARANTINED`. A separate authorized reviewer can then mark clean files `VERIFIED` or `REJECTED` with a rationale.

Evidence is never made public. Download URLs are generated only after an authenticated, organization-scoped lookup and expire after 120 seconds. Upload URLs expire after 300 seconds.

## Storage configuration

Configure all of the following together in the API environment:

- `EVIDENCE_S3_ENDPOINT`: S3-compatible endpoint origin, optionally with a base path (HTTPS required in production).
- `EVIDENCE_S3_BUCKET`: private bucket name.
- `EVIDENCE_S3_REGION`: signing region.
- `EVIDENCE_S3_ACCESS_KEY_ID`: least-privilege service identity.
- `EVIDENCE_S3_SECRET_ACCESS_KEY`: secret access key.
- `EVIDENCE_S3_SESSION_TOKEN`: optional temporary credential session token.

The API does not create buckets or change their ACLs. Provision a private bucket with public access blocked, encryption at rest, versioning or an appropriate retention policy, lifecycle cleanup for abandoned uploads, and provider-side access logging. Grant the API identity only the required object operations on the evidence bucket/prefix. Keep credentials in the deployment secret manager, never in source control.

For browser uploads, configure bucket CORS to allow only the deployed web origin, `PUT` and `GET`, and the `content-type` and `x-amz-checksum-sha256` request headers. Do not enable public object reads. Configure CORS response exposure only if your browser client needs additional response headers.

## File policy

- Maximum file size: 20 MiB.
- Accepted declared media types: PDF, PNG, JPEG, plain text, and CSV.
- The client supplies a SHA-256 hex digest. The digest is converted to S3's base64 checksum header and cryptographically bound to the presigned upload request. S3 validates the bytes against this checksum; the API then compares checksum, byte length, and content type on object HEAD.
- Original file names are metadata only. Object keys are generated UUIDs scoped under organization and assessment IDs; user-provided names never become storage paths.
- No arbitrary URL fetches, public object URLs, or user-controlled storage keys are accepted.
- The API checks PDF, PNG, and JPEG magic bytes; text and CSV must be valid UTF-8 without NUL bytes. This is format-signature validation, not a full parser or content-disarm/reconstruction engine.
- Every completed upload is downloaded through a short-lived private URL and scanned by ClamAV using the INSTREAM protocol. Scanner outages, timeouts, or malformed responses fail closed: the file is not marked clean or made available for download/review.
- A ClamAV `FOUND` result moves the file to `QUARANTINED`; quarantined files cannot be downloaded or human-verified through the API. The scanner signature is recorded in the audit event. Do not upload executable files or secrets.

## Lifecycle

`PENDING_UPLOAD → UPLOADED (ClamAV clean) → VERIFIED | REJECTED`  
`PENDING_UPLOAD → QUARANTINED (malware detected) → UPLOADED (clean rescan) → VERIFIED | REJECTED`  
`QUARANTINED → PURGED (authorized deletion; audit metadata retained)`  
`UPLOADED | VERIFIED | REJECTED | QUARANTINED → PURGED (retention expiry; legal holds excluded)`

1. An OWNER, ADMIN, AI_GOVERNANCE, or AI_ENGINEER requests an upload intent for an assessment in their organization.
2. The API creates a private metadata row and a five-minute presigned PUT URL with signed content type and checksum headers.
3. The browser uploads bytes directly to object storage, then calls the completion endpoint.
4. The API performs a signed HEAD request and compares object size, media type, and S3-validated SHA-256 checksum with the intent. It then retrieves the object (maximum 20 MiB), validates the file signature/encoding, and scans it with ClamAV. Only a clean scan transitions to `UPLOADED`; a detection transitions to `QUARANTINED`. Scanner errors fail closed.
5. A different authorized reviewer (OWNER, ADMIN, AI_GOVERNANCE, SECURITY_ANALYST, or COMPLIANCE_OFFICER) records a rationale and makes the final `VERIFIED` or `REJECTED` decision on clean `UPLOADED` evidence only.
6. Security reviewers can request a fresh ClamAV scan of quarantined evidence. A clean result releases the file to `UPLOADED`; a detection keeps it quarantined. No manual override can bypass scanning.
7. OWNER, ADMIN, or SECURITY_ANALYST can permanently delete a quarantined object by supplying a 10–1000 character rationale. The API deletes the private object, marks its metadata `PURGED`, and retains the checksum, original file name, actor, and reason in the audit log.
8. Upload intent, completion, download URL issuance, scan/release/purge actions, and verification decisions are written to the append-only organization audit log.

Evidence creators cannot verify their own files. Quarantined files are unavailable for download and review. Completed decisions cannot be overwritten through this API. Rejected objects are retained in private storage pending a documented retention/deletion policy. Manual purging is restricted to quarantined objects; automated retention cleanup applies only to expired terminal evidence and never to legal-held records. Audit-relevant metadata is retained with status `PURGED` after the bytes are removed.

## API

All routes require a bearer token and are prefixed by `/api/v1`.

| Method | Route | Purpose |
|---|---|---|
| POST | `/risk-assessments/:assessmentId/evidence/upload-intents` | Create a presigned upload intent |
| POST | `/risk-assessments/:assessmentId/evidence/:evidenceId/complete` | Verify stored object metadata and complete upload |
| GET | `/risk-assessments/:assessmentId/evidence` | List evidence metadata |
| POST | `/risk-assessments/:assessmentId/evidence/:evidenceId/download` | Issue a 120-second private download URL |
| POST | `/risk-assessments/:assessmentId/evidence/:evidenceId/decision` | Record independent verification or rejection |
| POST | `/risk-assessments/:assessmentId/evidence/:evidenceId/rescan` | Re-scan quarantined evidence; release only on a clean scan |
| POST | `/risk-assessments/:assessmentId/evidence/:evidenceId/purge` | Permanently delete quarantined bytes with an audited rationale |\n| POST | `/risk-assessments/:assessmentId/evidence/:evidenceId/legal-hold` | Place a legal hold (OWNER, ADMIN, COMPLIANCE_OFFICER) |\n| POST | `/risk-assessments/:assessmentId/evidence/:evidenceId/legal-hold/release` | Release a legal hold with an audited rationale |\n| POST | `/internal/evidence-retention/run` | Run scheduled cleanup; requires `x-evidence-retention-token` |

Upload intent body:

```json
{
  "fileName": "model-card.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 24576,
  "checksumSha256": "<64-character-lowercase-sha256-hex>"
}
```

Verification body:

```json
{
  "decision": "VERIFIED",
  "note": "Reviewed provenance, checksum, and relevance to the assessment."
}
```

## Operational limitations

- Storage is disabled until all required storage environment variables are configured; endpoints return service unavailable rather than falling back to local disk or public storage.
- The S3-compatible endpoint must support AWS Signature Version 4 presigned PUT/GET requests, signed HEAD requests, and checksum-mode HEAD responses.
- Configure object-store CORS and bucket policy separately; the API does not provision infrastructure.
- A HEAD metadata match proves the uploaded bytes match the supplied SHA-256 checksum and declared metadata; it does not establish that the document is truthful, safe, or substantively adequate.
- Configure `CLAMAV_HOST` and optional `CLAMAV_PORT` (default `3310`) to reach a maintained ClamAV daemon. In production, the API refuses to start with evidence storage enabled if `CLAMAV_HOST` is missing.
- For local development, run a ClamAV daemon bound to loopback with `docker run --rm -d --name sentinelai-clamav -p 127.0.0.1:3310:3310 clamav/clamav:stable`, then set `CLAMAV_HOST=127.0.0.1` and `CLAMAV_PORT=3310`. Wait for the signature database initialization and daemon readiness before uploading evidence.
- Keep ClamAV signatures updated and isolate the scanner on a private network. The integration suite uses a local protocol-compatible test double; it does not replace deployment validation against a real ClamAV service.
- Rescan is a manual, explicitly authorized action; no scheduler or automatic signature-update callback is configured.
- `EVIDENCE_RETENTION_DAYS` defaults to 365; set it to `0` to disable expiry of terminal evidence. The API validates values from 0 to 36500 days. Retention begins when an upload passes malware scanning or is quarantined. A clean rescan resets the expiry from the rescan time; a later verification decision resets it again.\n- The scheduled GitHub Actions workflow runs daily and can be invoked manually. Configure repository variable `SENTINELAI_API_URL` (API origin, without a trailing slash) and secret `EVIDENCE_RETENTION_CRON_TOKEN` (at least 32 random non-whitespace characters); configure the same secret and `EVIDENCE_RETENTION_DAYS` in the API runtime. The internal endpoint uses constant-time token comparison and returns 401 when the token is not configured.\n- Each cleanup run processes at most 100 records. Failed object deletions roll back the metadata transition and are retried on a later run. Missing objects are treated as already deleted. Legal holds block both automated cleanup and manual quarantine purge.\n- Cleanup deletes current object bytes only; provider-side object versions, replicas, backups, legal discovery exports, and storage-provider lifecycle rules require separate retention coordination. Audit metadata is intentionally not deleted.
- Full document parsing, content disarm/reconstruction, and automated evidence classification are not implemented.
