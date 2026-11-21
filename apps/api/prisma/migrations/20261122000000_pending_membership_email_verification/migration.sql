ALTER TABLE "Membership"
ADD COLUMN "pendingEmailVerification" BOOLEAN NOT NULL DEFAULT false;
