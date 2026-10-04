import type { SponsorCapacity } from "../../../assets/shared/schemas/sponsor-access";
import type { AuthMember, DatabaseLike, UserBackedAuthAdmin } from "../types";
import { createUserBackedAuthAdmin } from "./admin-identity";
import type { EligibleStaffUser } from "./identity-capacities";
import { computeGrantsForUser } from "./permissions";
import {
  DEFAULT_USER_SESSION_IDLE_TTL_HOURS,
  sessionIdleExpiresAt,
  STAFF_SESSION_IDLE_TTL_HOURS,
} from "./session-policy";

const STAFF_CAPACITY_TTL_HOURS = 8;

export interface UserSessionResult {
  identity: { id: string; email: string };
  sessionId: string;
  expiresAt: string;
  idleExpiresAt: string;
  staff?: UserBackedAuthAdmin;
  staffIdleExpiresAt?: string;
  staffReauthenticationRequired?: boolean;
  member?: AuthMember;
  sponsors: SponsorCapacity[];
  pendingIdentityCount: number;
  eventParticipation?: boolean;
}

export function userStaffExpiresAt(createdAt: string, sessionExpiresAt: string): string {
  const elevatedExpiresAt = new Date(new Date(createdAt).getTime() + STAFF_CAPACITY_TTL_HOURS * 60 * 60 * 1000);
  const sessionExpiry = new Date(sessionExpiresAt);
  return (elevatedExpiresAt < sessionExpiry ? elevatedExpiresAt : sessionExpiry).toISOString();
}

export async function createStaffSessionActor(
  db: DatabaseLike,
  staff: EligibleStaffUser,
  sessionId: string,
  expiresAt: string,
  memberId: string | null,
  state?: string | null,
): Promise<UserBackedAuthAdmin> {
  return createUserBackedAuthAdmin({
    id: staff.id,
    email: staff.email,
    scopes: [],
    grants: await computeGrantsForUser(db, staff.id, memberId),
    memberId,
    sessionId,
    expiresAt,
    ...(state ? { state } : {}),
  });
}

export async function createEstablishedUserSessionResult(
  db: DatabaseLike,
  prepared: { sessionId: string; expiresAt: string; createdAt: string },
  capacities: {
    identity: { id: string; email: string };
    staff: EligibleStaffUser | null;
    member: AuthMember | null;
    sponsors: SponsorCapacity[];
    pendingIdentityCount: number;
    eventParticipation: boolean;
  },
): Promise<UserSessionResult> {
  const activityAt = Math.floor(new Date(prepared.createdAt).getTime() / 1000);
  const staffExpiry = capacities.staff ? userStaffExpiresAt(prepared.createdAt, prepared.expiresAt) : null;
  return {
    identity: capacities.identity,
    sessionId: prepared.sessionId,
    expiresAt: prepared.expiresAt,
    idleExpiresAt: sessionIdleExpiresAt(activityAt, prepared.expiresAt, DEFAULT_USER_SESSION_IDLE_TTL_HOURS),
    ...(capacities.staff && staffExpiry
      ? {
          staff: await createStaffSessionActor(
            db,
            capacities.staff,
            prepared.sessionId,
            staffExpiry,
            capacities.member?.memberId ?? null,
          ),
          staffIdleExpiresAt: sessionIdleExpiresAt(activityAt, staffExpiry, STAFF_SESSION_IDLE_TTL_HOURS),
        }
      : {}),
    ...(capacities.member
      ? {
          member: {
            ...capacities.member,
            sessionId: prepared.sessionId,
            expiresAt: prepared.expiresAt,
          },
        }
      : {}),
    sponsors: capacities.sponsors,
    pendingIdentityCount: capacities.pendingIdentityCount,
    eventParticipation: capacities.eventParticipation,
  };
}
