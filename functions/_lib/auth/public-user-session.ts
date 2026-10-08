import type { PublicStaffCapacity } from "../../../assets/shared/schemas/staff-capacity";
import type { SponsorCapacity } from "../../../assets/shared/schemas/sponsor-access";
import type { AuthMember } from "../types";
import type { UserSessionResult } from "./user-session";
import { publicStaffCapacity } from "./admin-identity";

export function publicUserSession(result: UserSessionResult): {
  sessionId: string;
  expiresAt: string;
  idleExpiresAt: string;
  identity: { id: string; email: string };
  staff?: PublicStaffCapacity;
  staffReauthenticationRequired: boolean;
  member?: AuthMember;
  sponsors: SponsorCapacity[];
  pendingIdentityCount: number;
  eventParticipation?: boolean;
  hasActiveAffiliation: boolean;
} {
  return {
    sessionId: result.sessionId,
    expiresAt: result.expiresAt,
    idleExpiresAt: result.idleExpiresAt,
    identity: result.identity,
    ...(result.staff
      ? {
          staff: {
            ...publicStaffCapacity(result.staff),
            idleExpiresAt: result.staffIdleExpiresAt!,
          },
        }
      : {}),
    staffReauthenticationRequired: result.staffReauthenticationRequired ?? false,
    ...(result.member ? { member: result.member } : {}),
    sponsors: result.sponsors,
    pendingIdentityCount: result.pendingIdentityCount,
    eventParticipation: result.eventParticipation ?? false,
    hasActiveAffiliation: result.hasActiveAffiliation,
  };
}
