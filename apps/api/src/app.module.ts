import { Module, type NestModule, type MiddlewareConsumer } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnvironment } from "./config/env.validation.js";
import { AuthModule } from "./auth/auth.module.js";
import { AuthController } from "./auth/auth.controller.js";
import { AssetsModule } from "./assets/assets.module.js";
import { AuditLogsModule } from "./audit-logs/audit-logs.module.js";
import { RiskAssessmentsModule } from "./risk-assessments/risk-assessments.module.js";\nimport { EvidenceModule } from "./evidence/evidence.module.js";
import { HealthController } from "./health.controller.js";
import { MetricsController } from "./observability/metrics.controller.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { AuthRateLimitMiddleware } from "./security/auth-rate-limit.middleware.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: "../../.env",
      validate: validateEnvironment,
    }),
    PrismaModule,
    AuthModule,
    AssetsModule,
    AuditLogsModule,
    RiskAssessmentsModule,\n    EvidenceModule,
  ],
  controllers: [HealthController, MetricsController],
  providers: [AuthRateLimitMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Bind directly to the auth controller instead of a catch-all wildcard.
    // This ensures the middleware is mounted on the prefixed auth routes.
    consumer.apply(AuthRateLimitMiddleware).forRoutes(AuthController);
  }
}
