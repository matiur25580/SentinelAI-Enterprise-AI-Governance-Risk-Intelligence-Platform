import { BadRequestException, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { GovernanceReportQueryDto } from "./dto/governance-report-query.dto.js";
import { createReportPdf, createZipArchive } from "./audit-package-archive.js";

const MAX_ASSETS = 1_000;
const MAX_ASSESSMENTS = 1_000;
const MAX_INCIDENTS = 1_000;
const MAX_EVIDENCE = 2_000;
const MAX_AUDIT_EVENTS = 5_000;

function csvCell(value: unknown): string {
  let text = value == null ? "" : value instanceof Date ? value.toISOString()
    : typeof value === "object" ? (JSON.stringify(value) ?? "") : String(value);
  if (/^[\\s]*[=+\\-@]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map(row => row.map(csvCell).join(","))].join("\r\n") + "\r\n";
}

function display(value: unknown): string {
  return value == null || value === "" ? "—" : String(value);
}

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
    return toCsv(["Metric", "Value"], rows);
  }

  async exportAuditPackage(auth: AuthenticatedUser, query: GovernanceReportQueryDto): Promise<Buffer> {
    const range = this.range(query);
    const organizationId = auth.organizationId;
    const where = { organizationId, ...range };
    const report = await this.summary(auth, query);

    const [assetCount, assessmentCount, incidentCount, evidenceCount, auditCount] = await Promise.all([
      this.prisma.aIAsset.count({ where }),
      this.prisma.riskAssessment.count({ where }),
      this.prisma.incident.count({ where }),
      this.prisma.evidenceFile.count({ where }),
      this.prisma.auditLog.count({ where }),
    ]);
    const limits = [
      ["AI assets", assetCount, MAX_ASSETS],
      ["Risk assessments", assessmentCount, MAX_ASSESSMENTS],
      ["Incidents", incidentCount, MAX_INCIDENTS],
      ["Evidence inventory", evidenceCount, MAX_EVIDENCE],
      ["Audit events", auditCount, MAX_AUDIT_EVENTS - 1],
    ] as const;
    const exceeded = limits.find(([, count, maximum]) => count > maximum);
    if (exceeded) {
      throw new BadRequestException(`The ${exceeded[0]} export contains ${exceeded[1]} records; narrow the date filters to ${exceeded[2]} records or fewer.`);
    }

    const [assets, assessments, incidents, evidence] = await Promise.all([
      this.prisma.aIAsset.findMany({
        where, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, name: true, description: true, assetType: true, provider: true,
          modelIdentifier: true, version: true, status: true, createdAt: true, updatedAt: true,
          owner: { select: { user: { select: { name: true, email: true } } } },
        },
      }),
      this.prisma.riskAssessment.findMany({
        where, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, assetId: true, title: true, scope: true, intendedUse: true,
          dataSensitivity: true, autonomyLevel: true, impact: true, likelihood: true,
          exposure: true, mitigationCoverage: true, inherentScore: true, residualScore: true,
          inherentLevel: true, residualLevel: true, scoringVersion: true, status: true,
          reviewRationale: true, submittedAt: true, reviewedAt: true, createdAt: true, updatedAt: true,
          evidence: true, asset: { select: { name: true } },
          createdByMembership: { select: { user: { select: { name: true } } } },
          reviewedByMembership: { select: { user: { select: { name: true } } } },
        },
      }),
      this.prisma.incident.findMany({
        where, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, assetId: true, title: true, description: true, severity: true, status: true,
          source: true, occurredAt: true, resolution: true, resolvedAt: true, closedAt: true,
          createdAt: true, updatedAt: true, asset: { select: { name: true } },
          createdByMembership: { select: { user: { select: { name: true } } } },
          assignedToMembership: { select: { user: { select: { name: true } } } },
        },
      }),
      this.prisma.evidenceFile.findMany({
        where, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, riskAssessmentId: true, originalFileName: true, contentType: true,
          sizeBytes: true, status: true, createdAt: true, uploadedAt: true, verifiedAt: true,
          verificationNote: true, retentionExpiresAt: true, legalHoldAt: true, legalHoldReason: true,
          riskAssessment: { select: { title: true } },
          createdByMembership: { select: { user: { select: { name: true } } } },
          verifiedByMembership: { select: { user: { select: { name: true } } } },
        },
      }),
    ]);

    await this.prisma.auditLog.create({
      data: {
        organizationId, actorId: auth.sub, action: "governance.audit_package_export",
        entityType: "GovernanceAuditPackage",
        metadata: {
          period: report.period,
          counts: { assets: assets.length, assessments: assessments.length, incidents: incidents.length, evidence: evidence.length, auditEvents: auditCount },
          format: "PDF+ZIP",
        },
      },
    });

    const [auditEvents, integrityRows] = await Promise.all([
      this.prisma.auditLog.findMany({
        where, orderBy: [{ chainSequence: "asc" }, { id: "asc" }], take: MAX_AUDIT_EVENTS,
        select: {
          id: true, actorId: true, action: true, entityType: true, entityId: true,
          createdAt: true, chainSequence: true, previousHash: true, recordHash: true,
          actor: { select: { name: true, email: true } },
        },
      }),
      this.prisma.$queryRawUnsafe<Array<{ result: unknown }>>(
        "SELECT sentinel_verify_audit_chain($1) AS result", organizationId,
      ),
    ]);
    const integrity = integrityRows[0]?.result ?? {
      verified: false, recordsChecked: 0, reason: "VERIFIER_RETURNED_NO_RESULT",
    };

    report.audit.total = auditEvents.length;
    report.audit.recentActivity = auditEvents.slice(-10).reverse().map(event => ({
      id: event.id, action: event.action, entityType: event.entityType, entityId: event.entityId,
      createdAt: event.createdAt, actor: event.actor,
    }));

    const generatedAt = new Date().toISOString();
    const data = {
      schemaVersion: "sentinelai-governance-audit-package-v1",
      generatedAt,
      period: report.period,
      summary: report,
      inventory: {
        assets,
        assessments,
        incidents,
        evidence: evidence.map(item => ({ ...item, sizeBytes: item.sizeBytes.toString() })),
        auditEvents: auditEvents.map(item => ({ ...item, chainSequence: item.chainSequence.toString() })),
      },
      auditIntegrity: integrity,
      frameworkMapping: {
        references: ["NIST AI RMF 1.0", "ISO/IEC 42001:2023"],
        status: "INDICATIVE_PRODUCT_CAPABILITY_CROSSWALK",
        limitation: "Not a conformity assessment, certification, legal opinion or proof of organizational compliance.",
      },
      limitations: [
        "Product capability is not proof that an organization has implemented or operated a control.",
        "Evidence file contents, storage keys, signed URLs, credentials and secrets are intentionally excluded.",
        "Risk levels use the SentinelAI project-specific heuristic; they are not official framework scores or validated actuarial measures.",
        "Audit integrity verification covers the organization audit chain at export time; it does not independently attest to external systems.",
      ],
    };

    const pdfLines = [
      `Generated: ${generatedAt}`,
      `Period: ${report.period.mode} | from=${display(report.period.from)} | to=${display(report.period.to)}`,
      "",
      "EXECUTIVE SUMMARY",
      `AI assets: ${assets.length}`,
      `Risk assessments: ${assessments.length} | average residual score: ${report.assessments.averageResidualScore}`,
      `Incidents: ${incidents.length} | evidence records: ${evidence.length}`,
      `Audit events in selected period: ${auditEvents.length}`,
      `Audit chain integrity: ${JSON.stringify(integrity)}`,
      "",
      "AI ASSET INVENTORY",
      ...assets.map(item => `${item.name} | ${item.assetType} | ${item.status} | ${item.provider ?? "Provider not recorded"} | ${item.modelIdentifier ?? "Model ID not recorded"}`),
      "",
      "RISK ASSESSMENTS",
      ...assessments.map(item => `${item.title} | asset=${item.asset.name} | ${item.status} | residual=${item.residualScore} (${item.residualLevel}) | scoring=${item.scoringVersion}`),
      "",
      "EVIDENCE INVENTORY (METADATA ONLY; NO FILE CONTENTS)",
      ...evidence.map(item => `${item.originalFileName} | assessment=${item.riskAssessment.title} | ${item.status} | legalHold=${item.legalHoldAt ? "YES" : "NO"} | verified=${display(item.verifiedAt)}`),
      "",
      "AI INCIDENTS",
      ...incidents.map(item => `${item.title} | ${item.severity} | ${item.status} | asset=${item.asset?.name ?? "Not linked"} | created=${item.createdAt.toISOString()}`),
      "",
      "AUDIT TRAIL",
      ...auditEvents.map(item => `#${item.chainSequence.toString()} | ${item.createdAt.toISOString()} | ${item.action} | ${item.entityType}:${item.entityId ?? "—"} | actor=${item.actor?.name ?? item.actor?.email ?? "System"}`),
      "",
      "FRAMEWORK CROSSWALK",
      "Indicative product capability references: NIST AI RMF 1.0 and ISO/IEC 42001:2023.",
      "This is not a conformity assessment, certification, legal opinion or proof of organizational compliance.",
      "",
      "IMPORTANT LIMITATIONS",
      "Product functionality alone does not establish customer control adoption, operation or effectiveness.",
      "Evidence bytes, storage keys, signed URLs, credentials and secrets are excluded from this package.",
      "Risk scores are project-specific heuristic outputs, not official NIST/ISO scores or validated actuarial measures.",
    ];

    const files = [
      { name: "README.txt", content: [
        "SentinelAI Governance Audit Package",
        `Generated: ${generatedAt}`,
        "Contents: report.pdf, manifest.json, governance-summary.json, and CSV inventories.",
        "Sensitive evidence bytes, storage keys, signed URLs, credentials and secrets are excluded.",
        "Framework references are indicative product capability mappings, not proof of compliance.",
      ].join("\n") },
      { name: "report.pdf", content: createReportPdf("SentinelAI Governance Audit Report", pdfLines) },
      { name: "manifest.json", content: JSON.stringify({
        schemaVersion: data.schemaVersion, generatedAt, period: report.period,
        recordCounts: { assets: assets.length, assessments: assessments.length, incidents: incidents.length, evidence: evidence.length, auditEvents: auditEvents.length },
        auditIntegrity: integrity,
        files: ["report.pdf", "governance-summary.json", "assets.csv", "risk-assessments.csv", "evidence-inventory.csv", "incidents.csv", "audit-trail.csv"],
        limitations: data.limitations,
      }, null, 2) },
      { name: "governance-summary.json", content: JSON.stringify(data, null, 2) },
      { name: "assets.csv", content: toCsv(
        ["id","name","assetType","provider","modelIdentifier","version","status","owner","createdAt"],
        assets.map(x => [x.id,x.name,x.assetType,x.provider,x.modelIdentifier,x.version,x.status,x.owner?.user.name,x.createdAt]),
      ) },
      { name: "risk-assessments.csv", content: toCsv(
        ["id","asset","title","status","inherentScore","inherentLevel","residualScore","residualLevel","scoringVersion","createdBy","reviewedBy","reviewRationale","createdAt"],
        assessments.map(x => [x.id,x.asset.name,x.title,x.status,x.inherentScore,x.inherentLevel,x.residualScore,x.residualLevel,x.scoringVersion,x.createdByMembership.user.name,x.reviewedByMembership?.user.name,x.reviewRationale,x.createdAt]),
      ) },
      { name: "evidence-inventory.csv", content: toCsv(
        ["id","riskAssessmentId","assessment","fileName","contentType","sizeBytes","status","createdBy","verifiedBy","verifiedAt","retentionExpiresAt","legalHoldAt","legalHoldReason","verificationNote"],
        evidence.map(x => [x.id,x.riskAssessmentId,x.riskAssessment.title,x.originalFileName,x.contentType,x.sizeBytes.toString(),x.status,x.createdByMembership.user.name,x.verifiedByMembership?.user.name,x.verifiedAt,x.retentionExpiresAt,x.legalHoldAt,x.legalHoldReason,x.verificationNote]),
      ) },
      { name: "incidents.csv", content: toCsv(
        ["id","title","severity","status","asset","source","occurredAt","createdBy","assignedTo","resolution","resolvedAt","closedAt","createdAt"],
        incidents.map(x => [x.id,x.title,x.severity,x.status,x.asset?.name,x.source,x.occurredAt,x.createdByMembership.user.name,x.assignedToMembership?.user.name,x.resolution,x.resolvedAt,x.closedAt,x.createdAt]),
      ) },
      { name: "audit-trail.csv", content: toCsv(
        ["id","chainSequence","createdAt","actorId","actorName","actorEmail","action","entityType","entityId","previousHash","recordHash"],
        auditEvents.map(x => [x.id,x.chainSequence.toString(),x.createdAt,x.actorId,x.actor?.name,x.actor?.email,x.action,x.entityType,x.entityId,x.previousHash,x.recordHash]),
      ) },
    ];
    return createZipArchive(files);
  }
}
