import { Controller, Get, Header, Query, UseGuards } from "@nestjs/common";
import { MembershipRole } from "../generated/prisma/client.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface.js";
import { GovernanceReportQueryDto } from "./dto/governance-report-query.dto.js";
import { GovernanceReportsService } from "./governance-reports.service.js";

const REPORT_ROLES = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.AI_GOVERNANCE,
  MembershipRole.SECURITY_ANALYST,
  MembershipRole.COMPLIANCE_OFFICER,
  MembershipRole.AUDITOR,
];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("governance/reports")
export class GovernanceReportsController {
  constructor(private readonly service: GovernanceReportsService) {}

  @Get("summary")
  @Roles(...REPORT_ROLES)
  summary(@CurrentUser() user: AuthenticatedUser, @Query() query: GovernanceReportQueryDto) {
    return this.service.summary(user, query);
  }

  @Get("export.csv")
  @Roles(...REPORT_ROLES)
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="sentinelai-governance-report.csv"')
  exportCsv(@CurrentUser() user: AuthenticatedUser, @Query() query: GovernanceReportQueryDto) {
    return this.service.exportCsv(user, query);
  }
}
