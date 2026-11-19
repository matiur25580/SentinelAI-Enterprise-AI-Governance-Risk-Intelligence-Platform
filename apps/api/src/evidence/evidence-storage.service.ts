import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { EvidenceFileStatus, MembershipRole } from "../generated/prisma/client.js";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { S3CompatibleStorage } from "./s3-compatible-storage.js";
import type { CreateEvidenceUploadDto } from "./dto/create-evidence-upload.dto.js";
import type { VerifyEvidenceDto } from "./dto/verify-evidence.dto.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"]);
const UPLOAD_ROLES = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AI_GOVERNANCE, MembershipRole.AI_ENGINEER];
const REVIEW_ROLES = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AI_GOVERNANCE, MembershipRole.SECURITY_ANALYST, MembershipRole.COMPLIANCE_OFFICER];

@Injectable()
export class EvidenceStorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3CompatibleStorage,
  ) {}

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

    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.evidenceFile.updateMany({
        where: { id: evidenceId, organizationId: auth.organizationId, status: EvidenceFileStatus.PENDING_UPLOAD },
        data: { status: EvidenceFileStatus.UPLOADED, uploadedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException("Evidence state changed; reload and try again.");
      const result = await tx.evidenceFile.findUniqueOrThrow({ where: { id: evidenceId } });
      await tx.auditLog.create({
        data: {
          organizationId: auth.organizationId,
          actorId: auth.sub,
          action: "evidence.upload_complete",
          entityType: "EvidenceFile",
          entityId: evidenceId,
          metadata: {
            riskAssessmentId: assessmentId,
            sizeBytes: Number(result.sizeBytes),
            checksumSha256: result.checksumSha256,
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
}
