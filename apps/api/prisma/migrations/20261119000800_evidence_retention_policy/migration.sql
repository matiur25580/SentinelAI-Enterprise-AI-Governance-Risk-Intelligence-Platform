ALTER TABLE "EvidenceFile"
  ADD COLUMN "retentionExpiresAt" TIMESTAMP(3),
  ADD COLUMN "legalHoldAt" TIMESTAMP(3),
  ADD COLUMN "legalHoldReason" TEXT;

CREATE INDEX "EvidenceFile_status_retentionExpiresAt_legalHoldAt_idx"
  ON "EvidenceFile"("status", "retentionExpiresAt", "legalHoldAt");
