import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module.js";
import { AssetsModule } from "./assets/assets.module.js";
import { AuditLogsModule } from "./audit-logs/audit-logs.module.js";
import { HealthController } from "./health.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: "../../.env" }),
    PrismaModule,
    AuthModule,
    AssetsModule,
    AuditLogsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
