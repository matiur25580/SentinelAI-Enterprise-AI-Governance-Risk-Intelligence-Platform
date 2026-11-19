import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { EvidenceFileStatus, MembershipRole } from "../generated/prisma/client.js";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { S3CompatibleStorage } from "./s3-compatible-storage.js";
import type { CreateEvidenceUploadDto } from "./dto/create-evidence-upload.dto.js";
import type { VerifyEvidenceDto } from "./dto/verify-evidence.dto.js";
import type { PurgeEvidenceDto } from "./dto/purge-evidence.dto.js";
import type { EvidenceLegalHoldDto } from "./dto/evidence-legal-hold.dto.js";
import { ClamAvScanner } from "./clamav-scanner.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"]);
const UPLOAD_ROLES = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AI_GOVERNANCE, MembershipRole.AI_ENGINEER];
const REVIEW_ROLES = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AI_GOVERNANCE, MembershipRole.SECURITY_ANALYST, MembershipRole.COMPLIANCE_OFFICER];

function validateFileSignature(bytes: Buffer, contentType: string) {
  const valid = contentType === "application/pdf" ? bytes.subarray(0, 5).toString("ascii") === "%PDF-"
    : contentType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : contentType === "image/jpeg" ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : (contentType === "text/plain" || contentType === "text/csv") && !bytes.includes(0) && isUtf8(bytes);
  if (!valid) throw new BadRequestException("File contents do not match the declared evidence type or contain invalid text encoding.");
}

function isUtf8(bytes: Buffer) {
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; }
  catch { return false; }
}

@Injectable()
export class EvidenceStorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3CompatibleStorage,
    private readonly scanner: ClamAvScanner,
    private readonly config: ConfigService,
  ) {}

  private retentionExpiry() {
    const days = Number(this.config.get<string>("EVIDENCE_RETENTION_DAYS") ?? "365");
    if (!Number.isInteger(days) || days < 0 || days > 36500) throw new Error("EVIDENCE_RETENTION_DAYS must be an integer between 0 and 36500.");
    return days === 0 ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private assertRole(auth: AuthenticatedUser, roles: MembershipRole[]) {
    if (!roles.includes(auth.role)) throw new ForbiddenException("Your workspace role does not allow this evidence action.");
  }

  async createUpload(auth: AuthenticatedUser, assessmentId: string, dto: CreateEvidenceUploadDto) {
    this.assertRole(auth, UPLOAD_ROLES);
    const contentType = dto.contentType.toLowerCase();
    if (!ALLOWED_TYPES.has(contentType)) throw new BadRequestException("File type is not allowed.");
    if (dto.sizeBytes > MAX_FILE_BYTES) throw new BadRequestException("Evidence files must be 20 MB or smaller.");
    if (dto.fileName.includes("/") || dto.fileName.includes("\\") || /[\u0000-\u001f\u007f]/.test(dto.fileName)) {
      throw new BadRequestException("File name must be a plain file name without path components.");
    }
    const assessment = await this.prisma.riskAssessment.findFirst({
      where: { id: assessmentId, organizationId: auth.organizationId },
      select: { id: true },
    });
    if (!assessment) throw new NotFoundException("Risk assessment was not found.");

    const id = randomUUID();
    const storageKey = auth.organizationId + "/" + assessmentId + "/" + id;
    const expiresSeconds = 300;
    const expiresAt = new Date(Date.now() + expiresSeconds * 1000);
    const checksum = dto.checksumSha256.toLowerCase();
    const checksumBase64 = Buffer.from(checksum, "hex").toString("base64");
    const signed = this.storage.presign("PUT", storageKey, expiresSeconds, contentType, checksumBase64);

    const evidence = await this.prisma.$transaction(async (tx) => {
      const created = await tx.evidenceFile.create({
        data: {
          id,
          organizationId: auth.organizationId,
          riskAssessmentId: assessmentId,
          createdByMembershipId: auth.membershipId,
          storageKey,
          originalFileName: dto.fileName,
          contentType,
          sizeBytes: BigInt(dto.sizeBytes),
          checksumSha256: checksum,
          uploadExpiresAt: expiresAt,
        },
        select: {
          id: true, originalFileName: true, contentType: true, sizeBytes: true,
          checksumSha256: true, status: true, uploadExpiresAt: true,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: auth.organizationId,
          actorId: auth.sub,
          action: "evidence.upload_intent",
          entityType: "EvidenceFile",
          entityId: id,
          metadata: { riskAssessmentId: assessmentId, contentType, sizeBytes: dto.sizeBytes, checksumSha256: checksum },
        },
      });
      return created;
    });

    return {
      evidence: { ...evidence, sizeBytes: evidence.sizeBytes.toString() },
      upload: { method: "PUT", url: signed.url, headers: signed.headers, expiresInSeconds: expiresSeconds },
    };
  }

  async completeUpload(auth: AuthenticatedUser, assessmentId: string, evidenceId: string) {
    const evidence = await this.prisma.evidenceFile.findFirst({
      where: { id: evidenceId, riskAssessmentId: assessmentId, organizationId: auth.organizationId },
    });
    if (!evidence) throw new NotFoundException("Evidence file was not found.");
    if (evidence.status === EvidenceFileStatus.UPLOADED || evidence.status === EvidenceFileStatus.VERIFIED) {
      return { id: evidence.id, status: evidence.status, uploadedAt: evidence.uploadedAt };
    }
    if (evidence.status !== EvidenceFileStatus.PENDING_UPLOAD) {
      throw new ConflictException("Evidence upload cannot be completed in its current state.");
    }
    if (evidence.uploadExpiresAt.getTime() < Date.now()) {
      throw new ConflictException("The upload URL expired; create a new upload intent.");
    }

    const stored = await this.storage.inspectObject(evidence.storageKey);
    if (!stored) throw new ConflictException("The evidence object has not been uploaded.");
    const expectedChecksum = Buffer.from(evidence.checksumSha256, "hex").toString("base64");
    if (
      stored.sizeBytes !== Number(evidence.sizeBytes) ||
      stored.checksumSha256 !== expectedChecksum ||
      stored.contentType !== evidence.contentType
    ) {
      throw new BadRequestException("Uploaded object size, checksum, or content type does not match the signed upload intent.");
    }

    const bytes = await this.storage.readObject(evidence.storageKey, MAX_FILE_BYTES);
    validateFileSignature(bytes, evidence.contentType);
    const scan = await this.scanner.scan(bytes);
    const nextStatus = scan.clean ? EvidenceFileStatus.UPLOADED : EvidenceFileStatus.QUARANTINED;

    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.evidenceFile.updateMany({
        where: { id: evidenceId, organizationId: auth.organizationId, status: EvidenceFileStatus.PENDING_UPLOAD },
        data: { status: nextStatus, uploadedAt: new Date(), retentionExpiresAt: this.retentionExpiry() },
      });
      if (changed.count !== 1) throw new ConflictException("Evidence state changed; reload and try again.");
      const result = await tx.evidenceFile.findUniqueOrThrow({ where: { id: evidenceId } });
      await tx.auditLog.create({
        data: {
          organizationId: auth.organizationId,
          actorId: auth.sub,
          action: scan.clean ? "evidence.malware_scan_clean" : "evidence.malware_quarantined",
          entityType: "EvidenceFile",
          entityId: evidenceId,
          metadata: {
            riskAssessmentId: assessmentId,
            sizeBytes: Number(result.sizeBytes),
            checksumSha256: result.checksumSha256,
            scanner: "ClamAV",
            ...(scan.clean ? {} : { signature: scan.signature }),
          },
        },
      });
      return { id: result.id, status: result.status, uploadedAt: result.uploadedAt };
    });
  }

  async list(auth: AuthenticatedUser, assessmentId: string) {
    const assessment = await this.prisma.riskAssessment.findFirst({
      where: { id: assessmentId, organizationId: auth.organizationId },
      select: { id: true },
    });
    if (!assessment) throw new NotFoundException("Risk assessment was not found.");
    const items = await this.prisma.evidenceFile.findMany({
      where: { riskAssessmentId: assessmentId, organizationId: auth.organizationId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, originalFileName: true, contentType: true, sizeBytes: true, checksumSha256: true,
        status: true, createdAt: true, uploadedAt: true, verifiedAt: true, verificationNote: true,
        retentionExpiresAt: true, legalHoldAt: true, legalHoldReason: true,
        createdByMembership: { select: { user: { select: { name: true } } } },
        verifiedByMembership: { select: { user: { select: { name: true } } } },
      },
    });
    return items.map(item => ({ ...item, sizeBytes: item.sizeBytes.toString() }));
  }

  async download(auth: AuthenticatedUser, assessmentId: string, evidenceId: string) {
    const evidence = await this.prisma.evidenceFile.findFirst({
      where: {
        id: evidenceId,
        riskAssessmentId: assessmentId,
        organizationId: auth.organizationId,
        status: { in: [EvidenceFileStatus.UPLOADED, EvidenceFileStatus.VERIFIED] },
      },
    });
    if (!evidence) throw new NotFoundException("Available evidence file was not found.");
    const expiresSeconds = 120;
    const signed = this.storage.presign("GET", evidence.storageKey, expiresSeconds);
    await this.prisma.auditLog.create({
      data: {
        organizationId: auth.organizationId,
        actorId: auth.sub,
        action: "evidence.download_url",
        entityType: "EvidenceFile",
        entityId: evidence.id,
        metadata: { riskAssessmentId: assessmentId, expiresInSeconds: expiresSeconds },
      },
    });
    return { url: signed.url, method: "GET", expiresInSeconds: expiresSeconds };
  }

  async decide(auth: AuthenticatedUser, assessmentId: string, evidenceId: string, dto: VerifyEvidenceDto) {
    this.assertRole(auth, REVIEW_ROLES);
    const existing = await this.prisma.evidenceFile.findFirst({
      where: { id: evidenceId, riskAssessmentId: assessmentId, organizationId: auth.organizationId },
    });
    if (!existing) throw new NotFoundException("Evidence file was not found.");
    if (existing.createdByMembershipId === auth.membershipId) {
      throw new ForbiddenException("Evidence submitters cannot verify their own files.");
    }
    if (existing.status !== EvidenceFileStatus.UPLOADED) {
      throw new ConflictException("Only uploaded evidence can be verified or rejected.");
    }
    const status = dto.decision === "VERIFIED" ? EvidenceFileStatus.VERIFIED : EvidenceFileStatus.REJECTED;
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.evidenceFile.updateMany({
        where: { id: evidenceId, organizationId: auth.organizationId, status: EvidenceFileStatus.UPLOADED },
        data: {
          status,
          verifiedByMembershipId: auth.membershipId,
          verifiedAt: new Date(),
          verificationNote: dto.note.trim(),
          retentionExpiresAt: this.retentionExpiry(),
        },
      });
      if (changed.count !== 1) throw new ConflictException("Evidence state changed; reload and try again.");
      const result = await tx.evidenceFile.findUniqueOrThrow({ where: { id: evidenceId } });
      await tx.auditLog.create({
        data: {
          organizationId: auth.organizationId,
          actorId: auth.sub,
          action: dto.decision === "VERIFIED" ? "evidence.verify" : "evidence.reject",
          entityType: "EvidenceFile",
          entityId: evidenceId,
          metadata: { riskAssessmentId: assessmentId, note: dto.note.trim(), checksumSha256: result.checksumSha256 },
        },
      });
      return {
        id: result.id,
        status: result.status,
        verifiedAt: result.verifiedAt,
        verificationNote: result.verificationNote,
      };
    });
  }
  async rescanQuarantined(auth: AuthenticatedUser, assessmentId: string, evidenceId: string) {
    this.assertRole(auth, REVIEW_ROLES);
    const evidence = await this.prisma.evidenceFile.findFirst({
      where: { id: evidenceId, riskAssessmentId: assessmentId, organizationId: auth.organizationId },
    });
    if (!evidence) throw new NotFoundException("Evidence file was not found.");
    if (evidence.status !== EvidenceFileStatus.QUARANTINED) {
      throw new ConflictException("Only quarantined evidence can be rescanned.");
    }

    const bytes = await this.storage.readObject(evidence.storageKey, MAX_FILE_BYTES);
    validateFileSignature(bytes, evidence.contentType);
    const scan = await this.scanner.scan(bytes);
    const nextStatus = scan.clean ? EvidenceFileStatus.UPLOADED : EvidenceFileStatus.QUARANTINED;
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.evidenceFile.updateMany({
        where: { id: evidenceId, organizationId: auth.organizationId, status: EvidenceFileStatus.QUARANTINED },
        data: { status: nextStatus, ...(scan.clean ? { retentionExpiresAt: this.retentionExpiry() } : {}) },
      });
      if (changed.count !== 1) throw new ConflictException("Evidence state changed; reload and try again.");
      await tx.auditLog.create({
        data: {
          organizationId: auth.organizationId,
          actorId: auth.sub,
          action: scan.clean ? "evidence.quarantine_released_after_rescan" : "evidence.quarantine_rescan_detected",
          entityType: "EvidenceFile",
          entityId: evidenceId,
          metadata: {
            riskAssessmentId: assessmentId,
            scanner: "ClamAV",
            previousStatus: "QUARANTINED",
            nextStatus,
            ...(scan.clean ? {} : { signature: scan.signature }),
          },
        },
      });
      return { id: evidenceId, status: nextStatus, scan: scan.clean ? "CLEAN" : "INFECTED" };
    });
  }

  async placeLegalHold(auth: AuthenticatedUser, assessmentId: string, evidenceId: string, dto: EvidenceLegalHoldDto) {
    this.assertRole(auth, [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.COMPLIANCE_OFFICER]);
    const evidence = await this.prisma.evidenceFile.findFirst({
      where: { id: evidenceId, riskAssessmentId: assessmentId, organizationId: auth.organizationId },
      select: { id: true, status: true },
    });
    if (!evidence) throw new NotFoundException("Evidence file was not found.");
    if ([EvidenceFileStatus.PURGED, EvidenceFileStatus.PENDING_UPLOAD].includes(evidence.status)) {
      throw new ConflictException("A legal hold can only be placed on uploaded evidence that has not been purged.");
    }
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.evidenceFile.updateMany({
        where: { id: evidenceId, organizationId: auth.organizationId, status: evidence.status },
        data: { legalHoldAt: new Date(), legalHoldReason: dto.reason.trim() },
      });
      if (changed.count !== 1) throw new ConflictException("Evidence state changed; reload and try again.");
      await tx.auditLog.create({ data: {
        organizationId: auth.organizationId, actorId: auth.sub, action: "evidence.legal_hold_placed",
        entityType: "EvidenceFile", entityId: evidenceId,
        metadata: { riskAssessmentId: assessmentId, reason: dto.reason.trim() },
      } });
      return { id: evidenceId, legalHold: true };
    });
  }

  async releaseLegalHold(auth: AuthenticatedUser, assessmentId: string, evidenceId: string, dto: EvidenceLegalHoldDto) {
    this.assertRole(auth, [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.COMPLIANCE_OFFICER]);
    const evidence = await this.prisma.evidenceFile.findFirst({
      where: { id: evidenceId, riskAssessmentId: assessmentId, organizationId: auth.organizationId },
      select: { id: true, legalHoldAt: true },
    });
    if (!evidence) throw new NotFoundException("Evidence file was not found.");
    if (!evidence.legalHoldAt) throw new ConflictException("Evidence does not have an active legal hold.");
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.evidenceFile.updateMany({
        where: { id: evidenceId, organizationId: auth.organizationId, legalHoldAt: { not: null }, status: { not: EvidenceFileStatus.PURGED } },
        data: { legalHoldAt: null, legalHoldReason: null },
      });
      if (changed.count !== 1) throw new ConflictException("Evidence state changed; reload and try again.");
      await tx.auditLog.create({ data: {
        organizationId: auth.organizationId, actorId: auth.sub, action: "evidence.legal_hold_released",
        entityType: "EvidenceFile", entityId: evidenceId,
        metadata: { riskAssessmentId: assessmentId, reason: dto.reason.trim() },
      } });
      return { id: evidenceId, legalHold: false };
    });
  }

  async purgeQuarantined(auth: AuthenticatedUser, assessmentId: string, evidenceId: string, dto: PurgeEvidenceDto) {
    this.assertRole(auth, [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.SECURITY_ANALYST]);
    const evidence = await this.prisma.evidenceFile.findFirst({
      where: { id: evidenceId, riskAssessmentId: assessmentId, organizationId: auth.organizationId },
      select: { id: true, storageKey: true, status: true, checksumSha256: true, originalFileName: true, legalHoldAt: true },
    });
    if (!evidence) throw new NotFoundException("Evidence file was not found.");
    if (evidence.status !== EvidenceFileStatus.QUARANTINED) {
      throw new ConflictException("Only quarantined evidence can be purged.");
    }
    if (evidence.legalHoldAt) throw new ConflictException("Evidence under legal hold cannot be purged.");

    return this.prisma.$transaction(async (tx) => {
      // Claim the quarantined row before touching object storage. The conditional update
      // serializes concurrent rescans/purges; a failed DELETE rolls the DB transition back.
      const changed = await tx.evidenceFile.updateMany({
        where: { id: evidenceId, organizationId: auth.organizationId, status: EvidenceFileStatus.QUARANTINED, legalHoldAt: null },
        data: { status: EvidenceFileStatus.PURGED },
      });
      if (changed.count !== 1) throw new ConflictException("Evidence state changed; reload and try again.");
      await this.storage.deleteObject(evidence.storageKey);
      await tx.auditLog.create({
        data: {
          organizationId: auth.organizationId,
          actorId: auth.sub,
          action: "evidence.quarantine_purged",
          entityType: "EvidenceFile",
          entityId: evidenceId,
          metadata: {
            riskAssessmentId: assessmentId,
            originalFileName: evidence.originalFileName,
            checksumSha256: evidence.checksumSha256,
            reason: dto.reason.trim(),
            storageObjectDeleted: true,
          },
        },
      });
      return { id: evidenceId, status: EvidenceFileStatus.PURGED };
    });
  }

}
