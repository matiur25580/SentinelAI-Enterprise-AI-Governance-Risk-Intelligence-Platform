import {
  ConflictException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { RiskAssessmentStatus, RiskLevel } from "../generated/prisma/client.js";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreateRiskAssessmentDto } from "./dto/create-risk-assessment.dto.js";
import type { RiskAssessmentQueryDto } from "./dto/risk-assessment-query.dto.js";
import type { ReviewRiskAssessmentDto } from "./dto/review-risk-assessment.dto.js";

const SCORING_VERSION = "sentinelai-risk-v1";

function riskLevel(score: number): RiskLevel {
  if (score <= 40) return RiskLevel.LOW;
  if (score <= 100) return RiskLevel.MEDIUM;
  if (score <= 175) return RiskLevel.HIGH;
  return RiskLevel.CRITICAL;
}

function scoreRisk(input: Pick<CreateRiskAssessmentDto,
  "dataSensitivity" | "autonomyLevel" | "impact" | "likelihood" | "exposure" | "mitigationCoverage"
>) {
  const contextMultiplier = 1 + ((input.dataSensitivity - 1) + (input.autonomyLevel - 1)) * 0.125;
  const inherentScore = Number((input.likelihood * input.impact * input.exposure * contextMultiplier).toFixed(2));
  const residualScore = Number((inherentScore * (1 - input.mitigationCoverage / 100)).toFixed(2));
  return {
    inherentScore,
    residualScore,
    inherentLevel: riskLevel(inherentScore),
    residualLevel: riskLevel(residualScore),
    scoringVersion: SCORING_VERSION,
  };
}

@Injectable()
export class RiskAssessmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(auth: AuthenticatedUser, assetId: string, dto: CreateRiskAssessmentDto) {
    const asset = await this.prisma.aIAsset.findFirst({
      where: { id: assetId, organizationId: auth.organizationId },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException("AI asset was not found.");

    const scores = scoreRisk(dto);
    return this.prisma.$transaction(async (tx) => {
      const assessment = await tx.riskAssessment.create({
        data: {
          organizationId: auth.organizationId,
          assetId,
          createdByMembershipId: auth.membershipId,
          title: dto.title.trim(),
          scope: dto.scope.trim(),
          intendedUse: dto.intendedUse.trim(),
          dataSensitivity: dto.dataSensitivity,
          autonomyLevel: dto.autonomyLevel,
          impact: dto.impact,
          likelihood: dto.likelihood,
          exposure: dto.exposure,
          mitigationCoverage: dto.mitigationCoverage,
          evidence: dto.evidence.map((item) => item.trim()).filter(Boolean),
          ...scores,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: auth.organizationId,
          actorId: auth.sub,
          action: "risk_assessment.create",
          entityType: "RiskAssessment",
          entityId: assessment.id,
          metadata: {
            assetId,
            inherentScore: scores.inherentScore,
            residualScore: scores.residualScore,
            residualLevel: scores.residualLevel,
            scoringVersion: SCORING_VERSION,
          },
        },
      });
      return assessment;
    });
  }

  async list(auth: AuthenticatedUser, query: RiskAssessmentQueryDto) {
    const where = {
      organizationId: auth.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.residualLevel ? { residualLevel: query.residualLevel } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.riskAssessment.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: query.limit,
        include: { asset: { select: { id: true, name: true, assetType: true } } },
      }),
      this.prisma.riskAssessment.count({ where }),
    ]);
    return {
      data: items,
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  async get(auth: AuthenticatedUser, id: string) {
    const assessment = await this.prisma.riskAssessment.findFirst({
      where: { id, organizationId: auth.organizationId },
      include: {
        asset: { select: { id: true, name: true, assetType: true, provider: true, modelIdentifier: true } },
        createdByMembership: { select: { id: true, role: true, user: { select: { id: true, name: true, email: true } } } },
        reviewedByMembership: { select: { id: true, role: true, user: { select: { id: true, name: true, email: true } } } },
      },
    });
    if (!assessment) throw new NotFoundException("Risk assessment was not found.");
    return assessment;
  }

  async submit(auth: AuthenticatedUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.riskAssessment.findFirst({
        where: { id, organizationId: auth.organizationId },
        select: { id: true, status: true, createdByMembershipId: true },
      });
      if (!existing) throw new NotFoundException("Risk assessment was not found.");
      if (existing.createdByMembershipId !== auth.membershipId) {
        throw new ForbiddenException("Only the assessment creator may submit it for review.");
      }
      if (existing.status !== RiskAssessmentStatus.DRAFT) {
        throw new ConflictException("Only draft assessments can be submitted.");
      }
      const updated = await tx.riskAssessment.updateMany({
        where: { id, organizationId: auth.organizationId, status: RiskAssessmentStatus.DRAFT },
        data: { status: RiskAssessmentStatus.IN_REVIEW, submittedAt: new Date() },
      });
      if (updated.count !== 1) throw new ConflictException("Assessment state changed; reload and try again.");
      const assessment = await tx.riskAssessment.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({
        data: {
          organizationId: auth.organizationId,
          actorId: auth.sub,
          action: "risk_assessment.submit",
          entityType: "RiskAssessment",
          entityId: id,
          metadata: { status: assessment.status },
        },
      });
      return assessment;
    });
  }

  async review(auth: AuthenticatedUser, id: string, dto: ReviewRiskAssessmentDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.riskAssessment.findFirst({
        where: { id, organizationId: auth.organizationId },
        select: { id: true, status: true, createdByMembershipId: true },
      });
      if (!existing) throw new NotFoundException("Risk assessment was not found.");
      if (existing.createdByMembershipId === auth.membershipId) {
        throw new ForbiddenException("A reviewer cannot approve or reject their own assessment.");
      }
      if (existing.status !== RiskAssessmentStatus.IN_REVIEW) {
        throw new ConflictException("Only submitted assessments can be reviewed.");
      }
      const status = dto.decision === "APPROVED" ? RiskAssessmentStatus.APPROVED : RiskAssessmentStatus.REJECTED;
      const updated = await tx.riskAssessment.updateMany({
        where: { id, organizationId: auth.organizationId, status: RiskAssessmentStatus.IN_REVIEW },
        data: {
          status,
          reviewRationale: dto.rationale.trim(),
          reviewedByMembershipId: auth.membershipId,
          reviewedAt: new Date(),
        },
      });
      if (updated.count !== 1) throw new ConflictException("Assessment state changed; reload and try again.");
      const assessment = await tx.riskAssessment.findUniqueOrThrow({ where: { id } });
      await tx.auditLog.create({
        data: {
          organizationId: auth.organizationId,
          actorId: auth.sub,
          action: dto.decision === "APPROVED" ? "risk_assessment.approve" : "risk_assessment.reject",
          entityType: "RiskAssessment",
          entityId: id,
          metadata: { status, rationale: dto.rationale.trim(), residualScore: assessment.residualScore },
        },
      });
      return assessment;
    });
  }
}
