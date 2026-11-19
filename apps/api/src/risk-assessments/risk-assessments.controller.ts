import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { MembershipRole } from "../generated/prisma/client.js";
import type { AuthenticatedUser } from "../auth/interfaces/authenticated-user.interface.js";
import { CreateRiskAssessmentDto } from "./dto/create-risk-assessment.dto.js";
import { RiskAssessmentQueryDto } from "./dto/risk-assessment-query.dto.js";
import { ReviewRiskAssessmentDto } from "./dto/review-risk-assessment.dto.js";
import { RiskAssessmentsService } from "./risk-assessments.service.js";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class RiskAssessmentsController {
  constructor(private readonly service: RiskAssessmentsService) {}

  @Post("assets/:assetId/risk-assessments")
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.AI_GOVERNANCE, MembershipRole.AI_ENGINEER)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param("assetId") assetId: string,
    @Body() dto: CreateRiskAssessmentDto,
  ) {
    return this.service.create(user, assetId, dto);
  }

  @Get("risk-assessments")
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: RiskAssessmentQueryDto) {
    return this.service.list(user, query);
  }

  @Get("risk-assessments/:id")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.get(user, id);
  }

  @Post("risk-assessments/:id/submit")
  submit(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.submit(user, id);
  }

  @Post("risk-assessments/:id/decision")
  @Roles(
    MembershipRole.OWNER,
    MembershipRole.ADMIN,
    MembershipRole.AI_GOVERNANCE,
    MembershipRole.SECURITY_ANALYST,
    MembershipRole.COMPLIANCE_OFFICER,
  )
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: ReviewRiskAssessmentDto,
  ) {
    return this.service.review(user, id, dto);
  }
}
