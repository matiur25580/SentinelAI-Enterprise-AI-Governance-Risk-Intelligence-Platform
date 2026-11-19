import { BadRequestException, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { GovernanceReportQueryDto } from "./dto/governance-report-query.dto.js";

@Injectable()
export class GovernanceReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private range(query: GovernanceReportQueryDto) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      throw new BadRequestException("Report dates must be valid ISO date strings.");
    }
    if (from && to && from > to) throw new BadRequestException("Report start date must be before the end date.");
    return {
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
  }

  async summary(auth: AuthenticatedUser, query: GovernanceReportQueryDto) {
    const range = this.range(query);
    const organizationId = auth.organizationId;
    const assetWhere = { organizationId, ...range };
    const assessmentWhere = { organizationId, ...range };
    const incidentWhere = { organizationId, ...range };
    const evidenceWhere = { organizationId, ...range };
    const auditWhere = { organizationId, ...range };

    const [
      assetTotal, assetStatus, assetType,
      assessmentTotal, assessmentStatus, assessmentLevel, assessmentAverage,
      incidentTotal, incidentStatus, incidentSeverity,
      evidenceTotal, evidenceStatus, evidenceLegalHold,
      auditTotal, recentActivity,
    ] = await Promise.all([
      this.prisma.aIAsset.count({ where: assetWhere }),
      this.prisma.aIAsset.groupBy({ by: ["status"], where: assetWhere, _count: { _all: true } }),
      this.prisma.aIAsset.groupBy({ by: ["assetType"], where: assetWhere, _count: { _all: true } }),
      this.prisma.riskAssessment.count({ where: assessmentWhere }),
      this.prisma.riskAssessment.groupBy({ by: ["status"], where: assessmentWhere, _count: { _all: true } }),
      this.prisma.riskAssessment.groupBy({ by: ["residualLevel"], where: assessmentWhere, _count: { _all: true } }),
      this.prisma.riskAssessment.aggregate({ where: assessmentWhere, _avg: { residualScore: true } }),
      this.prisma.incident.count({ where: incidentWhere }),
      this.prisma.incident.groupBy({ by: ["status"], where: incidentWhere, _count: { _all: true } }),
      this.prisma.incident.groupBy({ by: ["severity"], where: incidentWhere, _count: { _all: true } }),
      this.prisma.evidenceFile.count({ where: evidenceWhere }),
      this.prisma.evidenceFile.groupBy({ by: ["status"], where: evidenceWhere, _count: { _all: true } }),
      this.prisma.evidenceFile.count({ where: { ...evidenceWhere, legalHoldAt: { not: null } } }),
      this.prisma.auditLog.count({ where: auditWhere }),
      this.prisma.auditLog.findMany({
        where: auditWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10,
        select: { id: true, action: true, entityType: true, entityId: true, createdAt: true,
          actor: { select: { name: true, email: true } } },
      }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      period: { from: query.from ?? null, to: query.to ?? null, mode: query.from || query.to ? "FILTERED" : "ALL_TIME" },
      assets: { total: assetTotal, byStatus: assetStatus.map((row) => ({ status: row.status, count: row._count._all })), byType: assetType.map((row) => ({ assetType: row.assetType, count: row._count._all })) },
      assessments: {
        total: assessmentTotal,
        byStatus: assessmentStatus.map((row) => ({ status: row.status, count: row._count._all })),
        byResidualLevel: assessmentLevel.map((row) => ({ residualLevel: row.residualLevel, count: row._count._all })),
        averageResidualScore: Number((assessmentAverage._avg.residualScore ?? 0).toFixed(2)),
      },
      incidents: { total: incidentTotal, byStatus: incidentStatus.map((row) => ({ status: row.status, count: row._count._all })), bySeverity: incidentSeverity.map((row) => ({ severity: row.severity, count: row._count._all })) },
      evidence: {
        total: evidenceTotal,
        byStatus: evidenceStatus.map((row) => ({ status: row.status, count: row._count._all })),
        underLegalHold: evidenceLegalHold,
      },
      audit: { total: auditTotal, recentActivity },
      caveat: "Aggregates reflect records created within the selected period. Risk bands use the SentinelAI project-specific heuristic and are not regulatory certifications.",
    };
  }

  async exportCsv(auth: AuthenticatedUser, query: GovernanceReportQueryDto) {
    const report = await this.summary(auth, query);
    const rows: Array<[string, string | number]> = [
      ["Report generated at", report.generatedAt],
      ["Period", report.period.mode === "ALL_TIME" ? "All time" : `${report.period.from ?? "Beginning"} to ${report.period.to ?? "Present"}`],
      ["AI assets", report.assets.total],
      ...report.assets.byStatus.map((x) => [`Asset status: ${x.status}`, x.count] as [string, number]),
      ["Risk assessments", report.assessments.total],
      ["Average residual risk score", report.assessments.averageResidualScore],
      ...report.assessments.byStatus.map((x) => [`Assessment status: ${x.status}`, x.count] as [string, number]),
      ...report.assessments.byResidualLevel.map((x) => [`Residual risk: ${x.residualLevel}`, x.count] as [string, number]),
      ["AI incidents", report.incidents.total],
      ...report.incidents.byStatus.map((x) => [`Incident status: ${x.status}`, x.count] as [string, number]),
      ...report.incidents.bySeverity.map((x) => [`Incident severity: ${x.severity}`, x.count] as [string, number]),
      ["Evidence files", report.evidence.total],
      ["Evidence under legal hold", report.evidence.underLegalHold],
      ...report.evidence.byStatus.map((x) => [`Evidence status: ${x.status}`, x.count] as [string, number]),
      ["Audit events", report.audit.total],
    ];
    const cell = (value: string | number) => {
      const text = String(value);
      const safe = /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    return ["Metric,Value", ...rows.map(([label, value]) => `${cell(label)},${cell(value)}`)].join("\r\n") + "\r\n";
  }
}
