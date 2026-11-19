import { BadRequestException, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuditLogQueryDto } from "./dto/audit-log-query.dto.js";

const MAX_EXPORT_ROWS = 10_000;
const CSV_COLUMNS = [
  "id",
  "createdAt",
  "organizationId",
  "actorId",
  "actorEmail",
  "actorName",
  "action",
  "entityType",
  "entityId",
  "metadata",
] as const;

function csvCell(value: unknown): string {
  let text = value == null
    ? ""
    : typeof value === "string"
      ? value
      : value instanceof Date
        ? value.toISOString()
        : JSON.stringify(value);

  // Prevent spreadsheet formula execution when CSVs are opened in Excel/Sheets.
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(auth: AuthenticatedUser, query: AuditLogQueryDto) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    if (from && to && from > to) {
      throw new BadRequestException("'from' must be earlier than or equal to 'to'.");
    }

    return {
      organizationId: auth.organizationId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };
  }

  async list(auth: AuthenticatedUser, query: AuditLogQueryDto) {
    const where = this.buildWhere(auth, query);
    const skip = (query.page - 1) * query.limit;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: query.limit,
        include: {
          actor: { select: { id: true, email: true, name: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async exportCsv(auth: AuthenticatedUser, query: AuditLogQueryDto): Promise<string> {
    const where = this.buildWhere(auth, query);
    const total = await this.prisma.auditLog.count({ where });
    if (total > MAX_EXPORT_ROWS) {
      throw new BadRequestException(
        `Export contains ${total} records; narrow the filters to ${MAX_EXPORT_ROWS} records or fewer.`,
      );
    }

    const records = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_EXPORT_ROWS,
      include: {
        actor: { select: { id: true, email: true, name: true } },
      },
    });

    const rows = records.map((record) => [
      record.id,
      record.createdAt,
      record.organizationId,
      record.actorId,
      record.actor?.email,
      record.actor?.name,
      record.action,
      record.entityType,
      record.entityId,
      record.metadata,
    ]);
    return [
      CSV_COLUMNS.map(csvCell).join(","),
      ...rows.map((row) => row.map(csvCell).join(",")),
    ].join("\r\n") + "\r\n";
  }

  async verifyIntegrity(auth: AuthenticatedUser) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ result: unknown }>>(
      'SELECT sentinel_verify_audit_chain($1) AS result',
      auth.organizationId,
    );
    return rows[0]?.result ?? {
      verified: false,
      recordsChecked: 0,
      reason: "VERIFIER_RETURNED_NO_RESULT",
    };
  }
}
