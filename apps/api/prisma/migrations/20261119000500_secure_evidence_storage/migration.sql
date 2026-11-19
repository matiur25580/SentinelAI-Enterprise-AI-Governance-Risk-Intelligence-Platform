-- Private S3-compatible evidence objects with explicit upload and human verification states.
CREATE TYPE "EvidenceFileStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'VERIFIED', 'REJECTED');

CREATE TABLE "EvidenceFile" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "riskAssessmentId" TEXT NOT NULL,
  "createdByMembershipId" TEXT NOT NULL,
  "verifiedByMembershipId" TEXT,
  "storageKey" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "status" "EvidenceFileStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
  "uploadExpiresAt" TIMESTAMP(3) NOT NULL,
  "uploadedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "verificationNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EvidenceFile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EvidenceFile_sizeBytes_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 20971520),
  CONSTRAINT "EvidenceFile_checksumSha256_check" CHECK ("checksumSha256" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "EvidenceFile_storageKey_key" ON "EvidenceFile"("storageKey");
CREATE INDEX "EvidenceFile_organizationId_riskAssessmentId_createdAt_idx" ON "EvidenceFile"("organizationId", "riskAssessmentId", "createdAt");
CREATE INDEX "EvidenceFile_organizationId_status_idx" ON "EvidenceFile"("organizationId", "status");
CREATE INDEX "EvidenceFile_uploadExpiresAt_status_idx" ON "EvidenceFile"("uploadExpiresAt", "status");

ALTER TABLE "EvidenceFile" ADD CONSTRAINT "EvidenceFile_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceFile" ADD CONSTRAINT "EvidenceFile_riskAssessmentId_fkey"
  FOREIGN KEY ("riskAssessmentId") REFERENCES "RiskAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceFile" ADD CONSTRAINT "EvidenceFile_createdByMembershipId_fkey"
  FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceFile" ADD CONSTRAINT "EvidenceFile_verifiedByMembershipId_fkey"
  FOREIGN KEY ("verifiedByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
