import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { MembershipRole } from "../generated/prisma/client.js";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface.js";
import { AuditLogsService } from "./audit-logs.service.js";
import { AuditLogQueryDto } from "./dto/audit-log-query.dto.js";

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.AI_GOVERNANCE,
  MembershipRole.SECURITY_ANALYST,
  MembershipRole.COMPLIANCE_OFFICER,
  MembershipRole.AUDITOR,
)
@Controller("audit-logs")
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get("export.csv")
  async exportCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AuditLogQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="sentinelai-audit-logs.csv"');
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    return this.auditLogsService.exportCsv(user, query);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: AuditLogQueryDto) {
    return this.auditLogsService.list(user, query);
  }
}
