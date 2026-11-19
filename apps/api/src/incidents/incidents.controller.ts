import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { MembershipRole } from "../generated/prisma/client.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface.js";
import { CreateIncidentDto } from "./dto/create-incident.dto.js";
import { IncidentQueryDto } from "./dto/incident-query.dto.js";
import { UpdateIncidentDto } from "./dto/update-incident.dto.js";
import { IncidentsService } from "./incidents.service.js";

const INCIDENT_MANAGERS = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.AI_GOVERNANCE,
  MembershipRole.SECURITY_ANALYST,
  MembershipRole.COMPLIANCE_OFFICER,
];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("incidents")
export class IncidentsController {
  constructor(private readonly service: IncidentsService) {}

  @Post()
  @Roles(...INCIDENT_MANAGERS)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateIncidentDto) {
    return this.service.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: IncidentQueryDto) {
    return this.service.list(user, query);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.get(user, id);
  }

  @Patch(":id")
  @Roles(...INCIDENT_MANAGERS)
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() dto: UpdateIncidentDto) {
    return this.service.update(user, id, dto);
  }
}
