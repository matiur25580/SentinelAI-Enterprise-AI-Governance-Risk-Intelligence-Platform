import { MembershipRole } from "../../generated/prisma/client.js";

export interface AuthenticatedUser {
  sub: string;
  email: string;
  organizationId: string;
  membershipId: string;
  role: MembershipRole;
}
