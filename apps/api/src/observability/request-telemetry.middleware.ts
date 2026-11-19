import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { recordHttpRequest } from "./metrics.js";

/**
 * Emits one privacy-safe structured event per completed HTTP request.
 * Never logs raw URLs, query strings, headers, bodies, IP addresses, or user data.
 */
export function requestTelemetryMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = randomUUID();
  const startedAt = process.hrtime.bigint();

  response.setHeader("X-Request-Id", requestId);
  response.on("finish", () => {
    const routePath = request.route?.path;
    const route = typeof routePath === "string"
      ? (routePath === "/" ? request.baseUrl || "/" : `${request.baseUrl}${routePath}`)
      : "unmatched";

    const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 10_000) / 100;
    if (!route.endsWith("/metrics")) {
      recordHttpRequest(request.method, route, response.statusCode, durationMs);
    }

    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      severity: "info",
      service: "sentinelai-api",
      environment: process.env.NODE_ENV ?? "development",
      event: "http.request",
      requestId,
      method: request.method,
      route,
      statusCode: response.statusCode,
      durationMs,
    }));
  });

  next();
}
