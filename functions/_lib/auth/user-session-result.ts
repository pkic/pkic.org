import type { SponsorCapacity } from "../../../assets/shared/schemas/sponsor-access";
import {
  resolveSessionActingIdentityId,
  type SessionActingIdentity,
} from "../../../assets/shared/session-acting-identity";
import type { AuthMember, DatabaseLike, UserBackedAuthAdmin } from "../types";
import { createUserBackedAuthAdmin } from "./admin-identity";
import {
  hasActiveIdentity,
  selectActingMember,
  type EligibleStaffUser,
  type MemberEligibleUserRow,
} from "./identity-capacities";
import { computeGrantsForUser } from "./permissions";
import {
  DEFAULT_USER_SESSION_IDLE_TTL_HOURS,
  sessionIdleExpiresAt,
  STAFF_SESSION_IDLE_TTL_HOURS,
  STAFF_CAPACITY_TTL_HOURS,
} from "./session-policy";

export interface UserSessionResult {
  identity: { id: string; email: string };
  sessionId: string;
  expiresAt: string;
  idleExpiresAt: string;
  staff?: UserBackedAuthAdmin;
  staffIdleExpiresAt?: string;
  member?: AuthMember;
  sponsors: SponsorCapacity[];
  pendingIdentityCount: number;
  eventParticipation?: boolean;
  hasActiveIdentity: boolean;
  actingIdentities: SessionActingIdentity[];
  /** The identity this session acts as; null while a person with several has not chosen. */
  actingIdentityId: string | null;
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
  return staffSessionActor(
    staff,
    sessionId,
    expiresAt,
    memberId,
    await computeGrantsForUser(db, staff.id, memberId),
    state,
  );
}

/** Identical actor projection when current grants were loaded setwise. */
export function staffSessionActor(
  staff: EligibleStaffUser,
  sessionId: string,
  expiresAt: string,
  memberId: string | null,
  grants: UserBackedAuthAdmin["grants"],
  state?: string | null,
): UserBackedAuthAdmin {
  return createUserBackedAuthAdmin({
    id: staff.id,
    email: staff.email,
    scopes: [],
    grants,
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
    /** Every membership the person holds; the session takes only its acting identity's. */
    memberships: readonly MemberEligibleUserRow[];
    sponsors: SponsorCapacity[];
    pendingIdentityCount: number;
    eventParticipation: boolean;
    actingIdentities: SessionActingIdentity[];
  },
): Promise<UserSessionResult> {
  const activityAt = Math.floor(new Date(prepared.createdAt).getTime() / 1000);
  // A new session has selected nothing yet: it acts as the person's only
  // identity, or asks a person with several which one to act as.
  const actingIdentityId = resolveSessionActingIdentityId(capacities.actingIdentities, null);
  const member = selectActingMember(capacities.memberships, actingIdentityId);
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
            member?.memberId ?? null,
          ),
          staffIdleExpiresAt: sessionIdleExpiresAt(activityAt, staffExpiry, STAFF_SESSION_IDLE_TTL_HOURS),
        }
      : {}),
    ...(member
      ? {
          member: {
            ...member,
            sessionId: prepared.sessionId,
            expiresAt: prepared.expiresAt,
          },
        }
      : {}),
    sponsors: capacities.sponsors,
    pendingIdentityCount: capacities.pendingIdentityCount,
    eventParticipation: capacities.eventParticipation,
    hasActiveIdentity: await hasActiveIdentity(db, capacities.identity.id),
    actingIdentities: capacities.actingIdentities,
    actingIdentityId,
  };
}

/** Whether the session holds any capacity beyond being an active user; one that does not reaches only the user's own account. */
export function sessionHoldsCapacity(
  session: Pick<
    UserSessionResult,
    "staff" | "member" | "sponsors" | "pendingIdentityCount" | "eventParticipation" | "hasActiveIdentity"
  >,
): boolean {
  return Boolean(
    session.staff ||
    session.member ||
    session.sponsors.length > 0 ||
    session.pendingIdentityCount > 0 ||
    session.eventParticipation ||
    session.hasActiveIdentity,
  );
}
