import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // Liveness: confirms that the API process is responding.
  @Get()
  getHealth() {
    return {
      status: "ok",
      service: "sentinelai-api",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
    };
  }

  // Readiness: confirms that required persistent storage is reachable.
  @Get("ready")
  async getReadiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: "ok",
        service: "sentinelai-api",
        checks: { database: "ok" },
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: "error",
        service: "sentinelai-api",
        checks: { database: "unavailable" },
      });
    }
  }
}
