import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { MembershipRole } from "../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../interfaces/authenticated-user.interface.js";
import { ROLES_KEY } from "../decorators/roles.decorator.js";

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  // Resolve handler-level role metadata first, then fall back to controller-level metadata.
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<MembershipRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.role || !requiredRoles.includes(request.user.role)) {
      throw new ForbiddenException("Your workspace role does not allow this action.");
    }
    return true;
  }
}
