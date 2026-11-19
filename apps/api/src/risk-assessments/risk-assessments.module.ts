import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { RiskAssessmentsController } from "./risk-assessments.controller.js";
import { RiskAssessmentsService } from "./risk-assessments.service.js";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [RiskAssessmentsController],
  providers: [RiskAssessmentsService],
})
export class RiskAssessmentsModule {}
