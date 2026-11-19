import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { IncidentStatus } from "../generated/prisma/client.js";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreateIncidentDto } from "./dto/create-incident.dto.js";
import type { IncidentQueryDto } from "./dto/incident-query.dto.js";
import type { UpdateIncidentDto } from "./dto/update-incident.dto.js";

const TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  [IncidentStatus.OPEN]: [IncidentStatus.TRIAGED],
  [IncidentStatus.TRIAGED]: [IncidentStatus.INVESTIGATING],
  [IncidentStatus.INVESTIGATING]: [IncidentStatus.RESOLVED],
  [IncidentStatus.RESOLVED]: [IncidentStatus.INVESTIGATING, IncidentStatus.CLOSED],
  [IncidentStatus.CLOSED]: [],
};

@Injectable()
export class IncidentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(auth: AuthenticatedUser, dto: CreateIncidentDto) {
    if (dto.assetId) {
      const asset = await this.prisma.aIAsset.findFirst({
        where: { id: dto.assetId, organizationId: auth.organizationId },
        select: { id: true },
      });
      if (!asset) throw new NotFoundException("AI asset was not found in this workspace.");
    }
    return this.prisma.$transaction(async (tx) => {
      const incident = await tx.incident.create({
        data: {
          organizationId: auth.organizationId,
          createdByMembershipId: auth.membershipId,
          ...(dto.assetId ? { assetId: dto.assetId } : {}),
          title: dto.title.trim(),
          description: dto.description.trim(),
          severity: dto.severity,
          source: dto.source?.trim() || null,
          occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        },
        include: { asset: { select: { id: true, name: true } } },
      });
      await tx.auditLog.create({
        data: {
          organizationId: auth.organizationId,
          actorId: auth.sub,
          action: "incident.create",
          entityType: "Incident",
          entityId: incident.id,
          metadata: { severity: incident.severity, status: incident.status, assetId: incident.assetId },
        },
      });
      return incident;
    });
  }

  async list(auth: AuthenticatedUser, query: IncidentQueryDto) {
    const where = {
      organizationId: auth.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [data, total] = await this.prisma.$transaction([
      this.prisma.incident.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: query.limit,
        include: {
          asset: { select: { id: true, name: true } },
          createdByMembership: { select: { user: { select: { name: true, email: true } } } },
          assignedToMembership: { select: { id: true, user: { select: { name: true, email: true } } } },
        },
      }),
      this.prisma.incident.count({ where }),
    ]);
    return { data, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  async get(auth: AuthenticatedUser, id: string) {
    const incident = await this.prisma.incident.findFirst({
      where: { id, organizationId: auth.organizationId },
      include: {
        asset: { select: { id: true, name: true, assetType: true } },
        createdByMembership: { select: { id: true, role: true, user: { select: { id: true, name: true, email: true } } } },
        assignedToMembership: { select: { id: true, role: true, user: { select: { id: true, name: true, email: true } } } },
      },
    });
    if (!incident) throw new NotFoundException("Incident was not found.");
    return incident;
  }

  async update(auth: AuthenticatedUser, id: string, dto: UpdateIncidentDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.incident.findFirst({
        where: { id, organizationId: auth.organizationId },
        select: { id: true, status: true, resolution: true, assignedToMembershipId: true },
      });
      if (!existing) throw new NotFoundException("Incident was not found.");
      if (dto.status && dto.status !== existing.status && !TRANSITIONS[existing.status].includes(dto.status)) {
        throw new ConflictException(`Invalid incident transition: ${existing.status} → ${dto.status}.`);
      }
      const nextStatus = dto.status ?? existing.status;
      if (nextStatus === IncidentStatus.RESOLVED && !(dto.resolution ?? existing.resolution)?.trim()) {
        throw new BadRequestException("A resolution summary is required before resolving an incident.");
      }
      if (nextStatus === IncidentStatus.CLOSED && existing.status !== IncidentStatus.RESOLVED) {
        throw new ConflictException("Only resolved incidents may be closed.");
      }
      if (dto.assignedToMembershipId) {
        const member = await tx.membership.findFirst({
          where: { id: dto.assignedToMembershipId, organizationId: auth.organizationId, isActive: true },
          select: { id: true },
        });
        if (!member) throw new BadRequestException("Assignee must be an active member of this workspace.");
      }
      const updated = await tx.incident.updateMany({
        where: { id, organizationId: auth.organizationId, status: existing.status },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.resolution !== undefined ? { resolution: dto.resolution.trim() } : {}),
          ...(dto.assignedToMembershipId !== undefined ? { assignedToMembershipId: dto.assignedToMembershipId || null } : {}),
          ...(nextStatus === IncidentStatus.RESOLVED ? { resolvedAt: new Date() } : {}),
          ...(nextStatus === IncidentStatus.CLOSED ? { closedAt: new Date() } : {}),
          ...(existing.status === IncidentStatus.RESOLVED && nextStatus === IncidentStatus.INVESTIGATING ? { resolvedAt: null, closedAt: null } : {}),
        },
      });
      if (updated.count !== 1) throw new ConflictException("Incident changed; reload and try again.");
      const incident = await tx.incident.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({
        data: {
          organizationId: auth.organizationId,
          actorId: auth.sub,
          action: "incident.update",
          entityType: "Incident",
          entityId: id,
          metadata: {
            previousStatus: existing.status,
            status: incident.status,
            assignedToMembershipId: incident.assignedToMembershipId,
            resolutionChanged: dto.resolution !== undefined,
          },
        },
      });
      return incident;
    });
  }
}
