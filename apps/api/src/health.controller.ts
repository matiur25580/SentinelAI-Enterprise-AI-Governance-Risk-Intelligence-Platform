import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  getHealth() {
    return {
      status: "ok",
      service: "sentinelai-api",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
    };
  }
}
