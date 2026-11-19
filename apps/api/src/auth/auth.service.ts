import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { randomBytes, randomUUID } from "node:crypto";
import { MembershipRole } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { LoginDto } from "./dto/login.dto.js";
import type { RefreshDto } from "./dto/refresh.dto.js";
import type { RegisterDto } from "./dto/register.dto.js";
import type { AuthenticatedUser } from "./interfaces/authenticated-user.interface.js";

interface RefreshPayload {
  sub: string;
  jti: string;
  organizationId: string;
  membershipId: string;
  familyId: string;
}

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly refreshLifetimeMs = 30 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    config: ConfigService,
  ) {
    this.accessSecret = config.getOrThrow<string>("JWT_ACCESS_SECRET");
    this.refreshSecret = config.getOrThrow<string>("JWT_REFRESH_SECRET");

    if (this.accessSecret.length < 32 || this.refreshSecret.length < 32) {
      throw new Error("JWT secrets must each contain at least 32 characters.");
    }
    if (this.accessSecret === this.refreshSecret) {
      throw new Error("Access and refresh JWT secrets must be different.");
    }
  }

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException("An account with this email already exists.");
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const baseSlug = dto.organizationName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70) || "workspace";
    const slug = `${baseSlug}-${randomBytes(3).toString("hex")}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: dto.organizationName.trim(), slug },
      });
      const user = await tx.user.create({
        data: {
          email,
          name: dto.name.trim(),
          passwordHash,
        },
      });
      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: MembershipRole.OWNER,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: user.id,
          action: "auth.register",
          entityType: "User",
          entityId: user.id,
          metadata: { email },
        },
      });
      return { user, organization, membership };
    });

    return this.issueTokens(result.user, result.organization, result.membership);
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          where: { isActive: true, organization: { isActive: true } },
          include: { organization: true },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    const passwordMatches = await argon2.verify(user.passwordHash, dto.password).catch(() => false);
    if (!passwordMatches) {
      throw new UnauthorizedException("Invalid email or password.");
    }

    const memberships = dto.organizationSlug
      ? user.memberships.filter((item) => item.organization.slug === dto.organizationSlug)
      : user.memberships;

    if (memberships.length === 0) {
      throw new UnauthorizedException("No active membership found for this workspace.");
    }
    if (memberships.length > 1) {
      throw new BadRequestException("Provide organizationSlug to select a workspace.");
    }

    const membership = memberships[0];
    await this.prisma.auditLog.create({
      data: {
        organizationId: membership.organizationId,
        actorId: user.id,
        action: "auth.login",
        entityType: "User",
        entityId: user.id,
      },
    });

    return this.issueTokens(user, membership.organization, membership);
  }

  async refresh(dto: RefreshDto) {
    let payload: RefreshPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshPayload>(dto.refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException("Refresh token is invalid or expired.");
    }

    if (!payload.jti || !payload.sub || !payload.membershipId || !payload.organizationId || !payload.familyId) {
      throw new UnauthorizedException("Refresh token is invalid.");
    }

    const stored = await this.prisma.refreshToken.findUnique({
      where: { jti: payload.jti },
      include: {
        user: true,
        organization: true,
        membership: true,
      },
    });

    if (
      !stored ||
      stored.userId !== payload.sub ||
      stored.membershipId !== payload.membershipId ||
      stored.organizationId !== payload.organizationId ||
      stored.familyId !== payload.familyId
    ) {
      throw new UnauthorizedException("Refresh token is invalid.");
    }

    const tokenMatches = await argon2.verify(stored.tokenHash, dto.refreshToken).catch(() => false);
    if (!tokenMatches) {
      throw new UnauthorizedException("Refresh token is invalid.");
    }

    if (stored.revokedAt) {
      // A previously rotated token was replayed: revoke every token in this session family.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException("Refresh token reuse detected; this session has been revoked.");
    }

    if (
      stored.expiresAt <= new Date() ||
      !stored.user.isActive ||
      !stored.organization.isActive ||
      !stored.membership.isActive
    ) {
      throw new UnauthorizedException("Refresh token has expired or its account is inactive.");
    }

    const rotation = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotation.count !== 1) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException("Refresh token reuse detected; this session has been revoked.");
    }

    return this.issueTokens(stored.user, stored.organization, stored.membership, stored.familyId);
  }

  async logout(dto: RefreshDto) {
    try {
      const payload = await this.jwtService.verifyAsync<RefreshPayload>(dto.refreshToken, {
        secret: this.refreshSecret,
      });
      if (payload.familyId) {
        await this.prisma.refreshToken.updateMany({
          where: { familyId: payload.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    } catch {
      // Logout is intentionally idempotent; invalid tokens are already unusable.
    }
    return { success: true };
  }

  async getProfile(auth: AuthenticatedUser) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        id: auth.membershipId,
        userId: auth.sub,
        organizationId: auth.organizationId,
        isActive: true,
        user: { isActive: true },
        organization: { isActive: true },
      },
      include: {
        user: { select: { id: true, email: true, name: true, createdAt: true } },
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!membership) {
      throw new UnauthorizedException("Workspace membership is no longer active.");
    }

    return {
      user: membership.user,
      organization: membership.organization,
      role: membership.role,
    };
  }

  async listSessions(auth: AuthenticatedUser) {
    const sessions = await this.prisma.$queryRawUnsafe<Array<{
      familyId: string;
      createdAt: Date;
      lastUsedAt: Date;
      activeTokenCount: number;
    }>>(
      'SELECT "familyId", MIN("createdAt") AS "createdAt", MAX("createdAt") AS "lastUsedAt", COUNT(*) FILTER (WHERE "revokedAt" IS NULL AND "expiresAt" > NOW())::int AS "activeTokenCount" FROM "RefreshToken" WHERE "userId" = $1 AND "organizationId" = $2 AND "membershipId" = $3 GROUP BY "familyId" HAVING COUNT(*) FILTER (WHERE "revokedAt" IS NULL AND "expiresAt" > NOW()) > 0 ORDER BY MAX("createdAt") DESC LIMIT 100',
      auth.sub, auth.organizationId, auth.membershipId,
    );
    return { data: sessions.map((session) => ({ sessionId: session.familyId, createdAt: session.createdAt, lastUsedAt: session.lastUsedAt, activeTokenCount: session.activeTokenCount })) };
  }

  async revokeSession(auth: AuthenticatedUser, familyId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(familyId)) {
      throw new BadRequestException("A valid session ID is required.");
    }
    const revoked = await this.prisma.$transaction(async (tx) => {
      const result = await tx.refreshToken.updateMany({
        where: { familyId, userId: auth.sub, organizationId: auth.organizationId, membershipId: auth.membershipId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (result.count === 0) throw new NotFoundException("Active session not found.");
      await tx.auditLog.create({
        data: { organizationId: auth.organizationId, actorId: auth.sub, action: "auth.session.revoke", entityType: "RefreshToken", entityId: familyId, metadata: { revokedTokenCount: result.count } },
      });
      return result.count;
    });
    return { success: true, revokedTokenCount: revoked };
  }

  private async issueTokens(
    user: { id: string; email: string },
    organization: { id: string },
    membership: { id: string; role: MembershipRole },
    familyId: string = randomUUID(),
  ) {
    const accessPayload: AuthenticatedUser = {
      sub: user.id,
      email: user.email,
      organizationId: organization.id,
      membershipId: membership.id,
      role: membership.role,
    };
    const jti = randomUUID();
    const refreshPayload: RefreshPayload = {
      sub: user.id,
      jti,
      organizationId: organization.id,
      membershipId: membership.id,
      familyId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.accessSecret,
        expiresIn: "15m",
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.refreshSecret,
        expiresIn: "30d",
      }),
    ]);

    await this.prisma.refreshToken.create({
      data: {
        jti,
        familyId,
        tokenHash: await argon2.hash(refreshToken),
        userId: user.id,
        organizationId: organization.id,
        membershipId: membership.id,
        expiresAt: new Date(Date.now() + this.refreshLifetimeMs),
      },
    });

    return {
      tokenType: "Bearer",
      expiresIn: 900,
      accessToken,
      refreshToken,
    };
  }
}
