import { Controller, Get, NotFoundException, Req, Res } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { renderPrometheusMetrics } from "./metrics.js";

@Controller("metrics")
export class MetricsController {
  @Get()
  getMetrics(@Req() request: Request, @Res() response: Response): void {
    const configuredToken = process.env.METRICS_BEARER_TOKEN;
    if (!configuredToken || configuredToken.length < 32) {
      throw new NotFoundException();
    }

    const authorization = request.header("authorization") ?? "";
    const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    const expectedBuffer = Buffer.from(configuredToken);
    const suppliedBuffer = Buffer.from(supplied);
    const valid = expectedBuffer.length === suppliedBuffer.length
      && timingSafeEqual(expectedBuffer, suppliedBuffer);

    if (!valid) throw new NotFoundException();

    response
      .status(200)
      .type("text/plain")
      .setHeader("Cache-Control", "no-store")
      .send(renderPrometheusMetrics());
  }
}
