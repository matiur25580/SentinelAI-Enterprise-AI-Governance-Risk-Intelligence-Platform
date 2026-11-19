import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { IncidentsController } from "./incidents.controller.js";
import { IncidentsService } from "./incidents.service.js";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [IncidentsController],
  providers: [IncidentsService],
})
export class IncidentsModule {}
