import type { PublicStaffCapacity } from "../../../assets/shared/schemas/staff-capacity";
import type { SponsorCapacity } from "../../../assets/shared/schemas/sponsor-access";
import type { AuthMember } from "../types";
import type { UserSessionResult } from "./user-session";
import { publicStaffCapacity } from "./admin-identity";

export function publicUserSession(result: UserSessionResult): {
  expiresAt: string;
  identity: { id: string; email: string };
  staff?: PublicStaffCapacity;
  staffReauthenticationRequired: boolean;
  member?: AuthMember;
  sponsors: SponsorCapacity[];
  pendingIdentityCount: number;
  eventParticipation?: boolean;
} {
  return {
    expiresAt: result.expiresAt,
    identity: result.identity,
    ...(result.staff ? { staff: publicStaffCapacity(result.staff) } : {}),
    staffReauthenticationRequired: result.staffReauthenticationRequired ?? false,
    ...(result.member ? { member: result.member } : {}),
    sponsors: result.sponsors,
    pendingIdentityCount: result.pendingIdentityCount,
    eventParticipation: result.eventParticipation ?? false,
  };
}
