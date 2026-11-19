CREATE TYPE "RiskAssessmentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TABLE "RiskAssessment" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "createdByMembershipId" TEXT NOT NULL,
  "reviewedByMembershipId" TEXT,
  "title" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "intendedUse" TEXT NOT NULL,
  "dataSensitivity" INTEGER NOT NULL,
  "autonomyLevel" INTEGER NOT NULL,
  "impact" INTEGER NOT NULL,
  "likelihood" INTEGER NOT NULL,
  "exposure" INTEGER NOT NULL,
  "mitigationCoverage" INTEGER NOT NULL DEFAULT 0,
  "inherentScore" DOUBLE PRECISION NOT NULL,
  "residualScore" DOUBLE PRECISION NOT NULL,
  "inherentLevel" "RiskLevel" NOT NULL,
  "residualLevel" "RiskLevel" NOT NULL,
  "scoringVersion" TEXT NOT NULL DEFAULT 'sentinelai-risk-v1',
  "evidence" JSONB NOT NULL,
  "status" "RiskAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
  "reviewRationale" TEXT,
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RiskAssessment_dataSensitivity_check" CHECK ("dataSensitivity" BETWEEN 1 AND 5),
  CONSTRAINT "RiskAssessment_autonomyLevel_check" CHECK ("autonomyLevel" BETWEEN 1 AND 5),
  CONSTRAINT "RiskAssessment_impact_check" CHECK ("impact" BETWEEN 1 AND 5),
  CONSTRAINT "RiskAssessment_likelihood_check" CHECK ("likelihood" BETWEEN 1 AND 5),
  CONSTRAINT "RiskAssessment_exposure_check" CHECK ("exposure" BETWEEN 1 AND 5),
  CONSTRAINT "RiskAssessment_mitigationCoverage_check" CHECK ("mitigationCoverage" BETWEEN 0 AND 100)
);

CREATE INDEX "RiskAssessment_organizationId_status_createdAt_idx"
  ON "RiskAssessment"("organizationId", "status", "createdAt");
CREATE INDEX "RiskAssessment_organizationId_residualLevel_idx"
  ON "RiskAssessment"("organizationId", "residualLevel");
CREATE INDEX "RiskAssessment_assetId_createdAt_idx"
  ON "RiskAssessment"("assetId", "createdAt");
CREATE INDEX "RiskAssessment_createdByMembershipId_idx"
  ON "RiskAssessment"("createdByMembershipId");

ALTER TABLE "RiskAssessment"
  ADD CONSTRAINT "RiskAssessment_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RiskAssessment"
  ADD CONSTRAINT "RiskAssessment_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "AIAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RiskAssessment"
  ADD CONSTRAINT "RiskAssessment_createdByMembershipId_fkey"
  FOREIGN KEY ("createdByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RiskAssessment"
  ADD CONSTRAINT "RiskAssessment_reviewedByMembershipId_fkey"
  FOREIGN KEY ("reviewedByMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
