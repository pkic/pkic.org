import type { PublicStaffCapacity } from "../../../assets/shared/schemas/staff-capacity";
import type { SponsorCapacity } from "../../../assets/shared/schemas/sponsor-access";
import type { AuthMember } from "../types";
import type { SessionActingIdentity } from "../../../assets/shared/session-acting-identity";
import type { UserSessionResult } from "./user-session";
import { publicStaffCapacity } from "./admin-identity";

export function publicUserSession(result: UserSessionResult): {
  sessionId: string;
  expiresAt: string;
  idleExpiresAt: string;
  identity: { id: string; email: string };
  staff?: PublicStaffCapacity;
  member?: AuthMember;
  sponsors: SponsorCapacity[];
  pendingIdentityCount: number;
  eventParticipation?: boolean;
  hasActiveAffiliation: boolean;
  actingIdentities: SessionActingIdentity[];
  actingIdentityId: string | null;
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
    ...(result.member ? { member: result.member } : {}),
    sponsors: result.sponsors,
    pendingIdentityCount: result.pendingIdentityCount,
    eventParticipation: result.eventParticipation ?? false,
    hasActiveAffiliation: result.hasActiveAffiliation,
    actingIdentities: result.actingIdentities,
    actingIdentityId: result.actingIdentityId,
  };
}
