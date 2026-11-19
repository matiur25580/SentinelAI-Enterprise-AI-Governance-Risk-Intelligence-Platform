import {
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { AccountActionTokenPurpose } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AccountEmailService } from "./account-email.service.js";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const GENERIC_EMAIL_RESPONSE = {
  message: "If the account is eligible, an email with next steps will be sent.",
};

@Injectable()
export class AccountLifecycleService {
  private readonly logger = new Logger(AccountLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: AccountEmailService,
  ) {}

  async issueEmailVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });
    if (!user || user.emailVerifiedAt) return;

    const token = await this.createToken(userId, AccountActionTokenPurpose.EMAIL_VERIFICATION, VERIFICATION_TTL_MS);
    const link = this.email.publicUrl("/verify-email", token);
    await this.email.send(
      user.email,
      "Verify your SentinelAI account",
      `Verify your email address by opening this one-time link (valid for 24 hours):\n\n${link}\n\nIf you did not create this account, you can ignore this message.`,
    );
  }

  async requestEmailVerification(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, emailVerifiedAt: true },
    });
    if (user && !user.emailVerifiedAt) {
      try {
        await this.issueEmailVerification(user.id);
      } catch {
        this.logger.warn("Email verification delivery failed.");
      }
    }
    return GENERIC_EMAIL_RESPONSE;
  }

  async confirmEmailVerification(rawToken: string) {
    const tokenHash = this.hashToken(rawToken);
    const action = await this.prisma.accountActionToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    const now = new Date();
    if (
      !action ||
      action.purpose !== AccountActionTokenPurpose.EMAIL_VERIFICATION ||
      action.consumedAt ||
      action.user.emailVerifiedAt ||
      action.expiresAt <= now ||
      !action.user.isActive
    ) {
      throw new UnauthorizedException("The account action token is invalid or expired.");
    }

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.accountActionToken.updateMany({
        where: {
          id: action.id,
          purpose: AccountActionTokenPurpose.EMAIL_VERIFICATION,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException("The account action token is invalid or expired.");
      }
      const verified = await tx.user.updateMany({
        where: { id: action.userId, isActive: true, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
      if (verified.count !== 1) {
        throw new UnauthorizedException("The account action token is invalid or expired.");
      }
      const memberships = await tx.membership.findMany({
        where: { userId: action.userId, isActive: true },
        select: { organizationId: true },
      });
      for (const membership of memberships) {
        await tx.auditLog.create({
          data: {
            organizationId: membership.organizationId,
            actorId: action.userId,
            action: "auth.email.verify",
            entityType: "User",
            entityId: action.userId,
          },
        });
      }
    });
    return { success: true, message: "Email address verified." };
  }

  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, email: true, isActive: true },
    });
    if (user?.isActive) {
      try {
        const token = await this.createToken(user.id, AccountActionTokenPurpose.PASSWORD_RESET, PASSWORD_RESET_TTL_MS);
        const link = this.email.publicUrl("/reset-password", token);
        await this.email.send(
          user.email,
          "Reset your SentinelAI password",
          `A password reset was requested for your account. Use this one-time link within 30 minutes:\n\n${link}\n\nIf you did not request this, ignore this message. Your password will not change.`,
        );
      } catch {
        this.logger.warn("Password reset email delivery failed.");
      }
    }
    return GENERIC_EMAIL_RESPONSE;
  }

  async resetPassword(rawToken: string, password: string) {
    const tokenHash = this.hashToken(rawToken);
    const action = await this.prisma.accountActionToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    const now = new Date();
    if (
      !action ||
      action.purpose !== AccountActionTokenPurpose.PASSWORD_RESET ||
      action.consumedAt ||
      action.expiresAt <= now ||
      !action.user.isActive
    ) {
      throw new UnauthorizedException("The account action token is invalid or expired.");
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.accountActionToken.updateMany({
        where: {
          id: action.id,
          purpose: AccountActionTokenPurpose.PASSWORD_RESET,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException("The account action token is invalid or expired.");
      }
      const updated = await tx.user.updateMany({
        where: { id: action.userId, isActive: true },
        data: { passwordHash },
      });
      if (updated.count !== 1) {
        throw new UnauthorizedException("The account action token is invalid or expired.");
      }
      await tx.refreshToken.updateMany({
        where: { userId: action.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      const memberships = await tx.membership.findMany({
        where: { userId: action.userId, isActive: true },
        select: { organizationId: true },
      });
      for (const membership of memberships) {
        await tx.auditLog.create({
          data: {
            organizationId: membership.organizationId,
            actorId: action.userId,
            action: "auth.password.reset",
            entityType: "User",
            entityId: action.userId,
          },
        });
      }
    });
    return { success: true, message: "Password updated. Sign in again on your devices." };
  }

  private async createToken(
    userId: string,
    purpose: AccountActionTokenPurpose,
    lifetimeMs: number,
  ): Promise<string> {
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(rawToken);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.accountActionToken.updateMany({
        where: { userId, purpose, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.accountActionToken.create({
        data: {
          userId,
          purpose,
          tokenHash,
          expiresAt: new Date(now.getTime() + lifetimeMs),
        },
      });
    });
    return rawToken;
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
