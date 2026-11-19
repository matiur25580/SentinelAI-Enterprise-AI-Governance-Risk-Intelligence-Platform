CREATE TABLE "ApiRateLimitBucket" (
  "bucketKey" TEXT NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApiRateLimitBucket_pkey" PRIMARY KEY ("bucketKey")
);

CREATE INDEX "ApiRateLimitBucket_expiresAt_idx"
  ON "ApiRateLimitBucket"("expiresAt");
