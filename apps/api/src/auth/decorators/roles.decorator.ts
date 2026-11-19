import { SetMetadata } from "@nestjs/common";
import type { MembershipRole } from "../../generated/prisma/client.js";

export const ROLES_KEY = "sentinelai:required-roles";

export const Roles = (...roles: MembershipRole[]) => SetMetadata(ROLES_KEY, roles);
