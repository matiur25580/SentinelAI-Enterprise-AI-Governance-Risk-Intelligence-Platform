import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { AuthenticatedUser } from "../interfaces/authenticated-user.interface.js";

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];

    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedException("A valid bearer token is required.");
    }

    try {
      const payload = await this.jwtService.verifyAsync<AuthenticatedUser>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      if (!payload.sub || !payload.organizationId || !payload.membershipId) {
        throw new UnauthorizedException();
      }

      const membership = await this.prisma.membership.findFirst({
        where: {
          id: payload.membershipId,
          userId: payload.sub,
          organizationId: payload.organizationId,
          isActive: true,
          user: { isActive: true },
          organization: { isActive: true },
        },
        select: { role: true },
      });

      if (!membership) {
        throw new UnauthorizedException("Workspace membership is no longer active.");
      }

      request.user = { ...payload, role: membership.role };
      return true;
    } catch {
      throw new UnauthorizedException("Access token is invalid, expired, or no longer authorized.");
    }
  }
}
