import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreateAssetDto } from "./dto/create-asset.dto.js";
import type { UpdateAssetDto } from "./dto/update-asset.dto.js";

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(auth: AuthenticatedUser, dto: CreateAssetDto) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.aIAsset.create({
        data: {
          organizationId: auth.organizationId,
          ownerId: auth.membershipId,
          name: dto.name.trim(),
          description: dto.description?.trim(),
          assetType: dto.assetType,
          provider: dto.provider?.trim(),
          modelIdentifier: dto.modelIdentifier?.trim(),
          version: dto.version?.trim(),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: auth.organizationId,
          actorId: auth.sub,
          action: "asset.create",
          entityType: "AIAsset",
          entityId: asset.id,
          metadata: { name: asset.name, assetType: asset.assetType },
        },
      });
      return asset;
    });
  }

  list(auth: AuthenticatedUser) {
    return this.prisma.aIAsset.findMany({
      where: { organizationId: auth.organizationId },
      orderBy: { createdAt: "desc" },
    });
  }

  async get(auth: AuthenticatedUser, assetId: string) {
    const asset = await this.prisma.aIAsset.findFirst({
      where: { id: assetId, organizationId: auth.organizationId },
    });
    if (!asset) throw new NotFoundException("AI asset was not found.");
    return asset;
  }

  async update(auth: AuthenticatedUser, assetId: string, dto: UpdateAssetDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.aIAsset.findFirst({
        where: { id: assetId, organizationId: auth.organizationId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException("AI asset was not found.");

      const asset = await tx.aIAsset.update({
        where: { id: existing.id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description?.trim() } : {}),
          ...(dto.provider !== undefined ? { provider: dto.provider?.trim() } : {}),
          ...(dto.modelIdentifier !== undefined ? { modelIdentifier: dto.modelIdentifier?.trim() } : {}),
          ...(dto.version !== undefined ? { version: dto.version?.trim() } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: auth.organizationId,
          actorId: auth.sub,
          action: "asset.update",
          entityType: "AIAsset",
          entityId: asset.id,
          metadata: { updatedFields: Object.keys(dto) },
        },
      });
      return asset;
    });
  }

  async remove(auth: AuthenticatedUser, assetId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.aIAsset.findFirst({
        where: { id: assetId, organizationId: auth.organizationId },
        select: { id: true, name: true },
      });
      if (!existing) throw new NotFoundException("AI asset was not found.");

      const assessmentCount = await tx.riskAssessment.count({ where: { assetId: existing.id } });
      if (assessmentCount > 0) {
        throw new ConflictException("Assets with risk assessment history cannot be deleted; retire the asset instead.");
      }
      await tx.aIAsset.delete({ where: { id: existing.id } });
      await tx.auditLog.create({
        data: {
          organizationId: auth.organizationId,
          actorId: auth.sub,
          action: "asset.delete",
          entityType: "AIAsset",
          entityId: existing.id,
          metadata: { name: existing.name },
        },
      });
      return { success: true };
    });
  }
}
