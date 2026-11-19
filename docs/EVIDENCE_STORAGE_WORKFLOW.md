# Private Evidence Storage and Verification

## Overview

Risk assessment evidence can be uploaded to a private S3-compatible object store using short-lived SigV4 presigned URLs. The API stores organization-scoped metadata and verifies the uploaded object's size, content type, and SHA-256 checksum before marking it `UPLOADED`. A separate authorized reviewer must then explicitly mark it `VERIFIED` or `REJECTED` with a rationale.

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
- The API's media-type allowlist is not malware scanning or deep file-format validation. Production deployments should add an antivirus/content-disarm scanning pipeline before evidence is eligible for human verification. Do not upload executable files or secrets.

## Lifecycle

`PENDING_UPLOAD → UPLOADED → VERIFIED | REJECTED`

1. An OWNER, ADMIN, AI_GOVERNANCE, or AI_ENGINEER requests an upload intent for an assessment in their organization.
2. The API creates a private metadata row and a five-minute presigned PUT URL with signed content type and checksum headers.
3. The browser uploads bytes directly to object storage, then calls the completion endpoint.
4. The API performs a signed HEAD request and compares object size, media type, and S3-validated SHA-256 checksum with the intent. Only then does it transition to `UPLOADED`.
5. A different authorized reviewer (OWNER, ADMIN, AI_GOVERNANCE, SECURITY_ANALYST, or COMPLIANCE_OFFICER) records a rationale and makes the final `VERIFIED` or `REJECTED` decision.
6. Upload intent, completion, download URL issuance, and verification decisions are written to the append-only organization audit log.

Evidence creators cannot verify their own files. Completed decisions cannot be overwritten through this API. Rejected objects are retained in private storage pending a documented retention/deletion policy; the API does not silently delete audit-relevant evidence.

## API

All routes require a bearer token and are prefixed by `/api/v1`.

| Method | Route | Purpose |
|---|---|---|
| POST | `/risk-assessments/:assessmentId/evidence/upload-intents` | Create a presigned upload intent |
| POST | `/risk-assessments/:assessmentId/evidence/:evidenceId/complete` | Verify stored object metadata and complete upload |
| GET | `/risk-assessments/:assessmentId/evidence` | List evidence metadata |
| POST | `/risk-assessments/:assessmentId/evidence/:evidenceId/download` | Issue a 120-second private download URL |
| POST | `/risk-assessments/:assessmentId/evidence/:evidenceId/decision` | Record independent verification or rejection |

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
- Malware scanning, content disarm/reconstruction, automated evidence classification, retention automation, and legal hold workflows are not implemented.
