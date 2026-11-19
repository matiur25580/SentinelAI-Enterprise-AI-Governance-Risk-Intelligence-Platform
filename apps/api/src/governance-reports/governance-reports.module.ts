import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { GovernanceReportsController } from "./governance-reports.controller.js";
import { GovernanceReportsService } from "./governance-reports.service.js";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [GovernanceReportsController],
  providers: [GovernanceReportsService],
})
export class GovernanceReportsModule {}
