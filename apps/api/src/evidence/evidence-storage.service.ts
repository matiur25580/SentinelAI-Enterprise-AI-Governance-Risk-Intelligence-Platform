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
        select: { id: true, originalFileName: true, contentType: true, sizeBytes: true, checksumSha256: true, status: true, uploadExpiresAt: true },
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

