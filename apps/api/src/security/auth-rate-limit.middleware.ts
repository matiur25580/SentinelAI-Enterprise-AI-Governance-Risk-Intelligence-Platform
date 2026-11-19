import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { NestMiddleware } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

const WINDOW_SECONDS = 15 * 60;
const LIMITS: Record<string, number> = {
  register: 5,
  login: 10,
  refresh: 30,
  logout: 30,
  "email-verification-request": 5,
  "email-verification-confirm": 10,
  "password-forgot": 5,
  "password-reset": 5,
};

@Injectable()
export class AuthRateLimitMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(request: Request, response: Response, next: NextFunction) {
    const match = request.path.match(/\/auth\/(register|login|refresh|logout)\/?$/);
    if (request.method !== "POST" || (!match && !accountAction)) {
      next();
      return;
    }

    const action = match ? match[1] : `${accountAction[1].startsWith("email") ? "email-verification" : "password"}-${accountAction[2] ?? accountAction[3]}`;
    const limit = LIMITS[action];
    const clientIp = request.ip || request.socket.remoteAddress || "unknown";
    // Hash the IP-derived identifier: the database stores no raw client addresses.
    const bucketKey = createHash("sha256")
      .update(`auth:${action}:${clientIp}`)
      .digest("hex");

    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ request_count: number; expires_at: Date }>
      >`
        WITH expired AS (
          DELETE FROM "ApiRateLimitBucket"
          WHERE "expiresAt" < NOW() - INTERVAL '1 day'
          RETURNING "bucketKey"
        )
        INSERT INTO "ApiRateLimitBucket" AS bucket
          ("bucketKey", "requestCount", "windowStartedAt", "expiresAt")
        VALUES (
          ${bucketKey},
          1,
          NOW(),
          NOW() + (${WINDOW_SECONDS} * INTERVAL '1 second')
        )
        ON CONFLICT ("bucketKey") DO UPDATE SET
          "requestCount" = CASE
            WHEN bucket."expiresAt" <= NOW() THEN 1
            ELSE bucket."requestCount" + 1
          END,
          "windowStartedAt" = CASE
            WHEN bucket."expiresAt" <= NOW() THEN NOW()
            ELSE bucket."windowStartedAt"
          END,
          "expiresAt" = CASE
            WHEN bucket."expiresAt" <= NOW()
              THEN NOW() + (${WINDOW_SECONDS} * INTERVAL '1 second')
            ELSE bucket."expiresAt"
          END
        RETURNING "requestCount" AS request_count, "expiresAt" AS expires_at
      `;

      const bucket = rows[0];
      const remaining = Math.max(0, limit - bucket.request_count);
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((bucket.expires_at.getTime() - Date.now()) / 1000),
      );
      response.setHeader("RateLimit-Limit", limit);
      response.setHeader("RateLimit-Remaining", remaining);
      response.setHeader("RateLimit-Reset", retryAfterSeconds);

      if (bucket.request_count > limit) {
        response.setHeader("Retry-After", retryAfterSeconds);
        response.status(429).json({
          statusCode: 429,
          message: "Too many authentication requests. Please try again later.",
          retryAfterSeconds,
        });
        return;
      }

      next();
    } catch (error) {
      // Fail closed if the shared rate-limit store is unavailable.
      next(error);
    }
  }
}
