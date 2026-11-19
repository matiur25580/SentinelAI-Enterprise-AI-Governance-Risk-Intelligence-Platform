import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EvidenceFileStatus } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { S3CompatibleStorage } from "./s3-compatible-storage.js";

const BATCH_SIZE = 20;
const ABANDONED_UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;
const RETAINABLE_STATUSES = [EvidenceFileStatus.VERIFIED, EvidenceFileStatus.REJECTED, EvidenceFileStatus.QUARANTINED];

@Injectable()
export class EvidenceRetentionService {
  private readonly logger = new Logger(EvidenceRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3CompatibleStorage,
    private readonly config: ConfigService,
  ) {}

  async runCleanup() {
    const configuredDays = this.config.get<string>("EVIDENCE_RETENTION_DAYS") ?? "365";
    const retentionDays = Number(configuredDays);
    if (!Number.isInteger(retentionDays) || retentionDays < 0 || retentionDays > 36500) {
      throw new Error("EVIDENCE_RETENTION_DAYS must be an integer between 0 and 36500.");
    }
    const now = new Date();
    const abandonedBefore = new Date(now.getTime() - ABANDONED_UPLOAD_GRACE_MS);
    const terminalFilter = retentionDays === 0 ? [] : [{
      status: { in: RETAINABLE_STATUSES },
      retentionExpiresAt: { lte: now },
      legalHoldAt: null,
    }];
    const candidates = await this.prisma.evidenceFile.findMany({
      where: {
        OR: [
          ...terminalFilter,
          { status: EvidenceFileStatus.PENDING_UPLOAD, uploadExpiresAt: { lte: abandonedBefore }, legalHoldAt: null },
        ],
      },
      orderBy: [{ uploadExpiresAt: "asc" }],
      take: BATCH_SIZE,
      select: {
        id: true, organizationId: true, riskAssessmentId: true, storageKey: true,
        originalFileName: true, checksumSha256: true, status: true,
      },
    });

    let purged = 0;
    let skipped = 0;
    for (const candidate of candidates) {
      const abandoned = candidate.status === EvidenceFileStatus.PENDING_UPLOAD;
      try {
        const changed = await this.prisma.$transaction(async (tx) => {
          const where = abandoned
            ? { id: candidate.id, organizationId: candidate.organizationId, status: EvidenceFileStatus.PENDING_UPLOAD, uploadExpiresAt: { lte: abandonedBefore }, legalHoldAt: null }
            : { id: candidate.id, organizationId: candidate.organizationId, status: candidate.status, retentionExpiresAt: { lte: now }, legalHoldAt: null };
          const claimed = await tx.evidenceFile.updateMany({ where, data: { status: EvidenceFileStatus.PURGED } });
          if (claimed.count !== 1) return false;
          await this.storage.deleteObject(candidate.storageKey);
          await tx.auditLog.create({
            data: {
              organizationId: candidate.organizationId,
              actorId: null,
              action: abandoned ? "evidence.abandoned_upload_expired" : "evidence.retention_purged",
              entityType: "EvidenceFile",
              entityId: candidate.id,
              metadata: {
                riskAssessmentId: candidate.riskAssessmentId,
                originalFileName: candidate.originalFileName,
                checksumSha256: candidate.checksumSha256,
                previousStatus: candidate.status,
                retentionDays: abandoned ? null : retentionDays,
                reason: abandoned ? "Upload intent expired and remained incomplete beyond the 24-hour cleanup grace period." : "Configured evidence retention period elapsed; no legal hold was active.",
                storageObjectDeleted: true,
                automated: true,
              },
            },
          });
          return true;
        });
        if (changed) purged += 1;
        else skipped += 1;
      } catch (error) {
        skipped += 1;
        this.logger.error("Evidence retention cleanup failed for an item; it will be retried on the next run.", error instanceof Error ? error.stack : String(error));
      }
    }
    return { enabled: retentionDays > 0, retentionDays, examined: candidates.length, purged, skipped, batchSize: BATCH_SIZE };
  }
}
