import { Controller, Get, Query, UseGuards } from "@nestjs/common";
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

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: AuditLogQueryDto) {
    return this.auditLogsService.list(user, query);
  }
}
