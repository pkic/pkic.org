import { hasEventParticipation } from "./event-participation";
/**
 * Canonical human identity session.
 *
 * A user may currently have staff and/or member capacity. Those capacities
 * are deliberately projections of live database state, never JWT authority.
 * The token only identifies the user/session and carries non-authoritative
 * context hints used by the read-replica and membership-context adapters.
 */
import type { DatabaseLike, Env, StatementLike } from "../types";
import { all, first } from "../db/queries";
import { AppError } from "../errors";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import {
  findEligibleStaffUserById,
  findEligibleMemberById,
  countPendingIdentitiesForUser,
  hasActiveAffiliation,
} from "./identity-capacities";
import { signInCapacityAuthorizationEvidence } from "./sign-in-capacity-authorization";
import { findActingIdentitiesForUser } from "./session-acting-identities";
import { resolveSessionActingIdentityId } from "../../../assets/shared/session-acting-identity";
import { recordAuditActingIdentity } from "../services/audit-actor";
import {
  assertSessionActive,
  fetchSessionRow,
  prepareSessionRow,
  sessionExpiresAtToExp,
  type SessionTableConfig,
} from "./session-engine";
import {
  assertEmailAuthCapabilityEmail,
  commitEmailAuthRedemption,
  emailAuthCapabilityMatchesEmail,
  queueEmailAuthCapability,
  verifyEmailAuthCapabilityToken,
} from "./email-auth-capabilities";
import { prepareVerifyPrimaryEmailStatement } from "../services/email-verification";
import { findActiveSponsorCapacitiesByUserId } from "./sponsor-capacity";
import {
  DEFAULT_USER_SESSION_IDLE_TTL_HOURS,
  sessionIdleExpiresAt,
  STAFF_SESSION_IDLE_TTL_HOURS,
} from "./session-policy";
import {
  getUserSessionToken,
  signUserSessionToken,
  verifyUserSessionToken,
  type UserSessionTokenClaims,
} from "./user-session-token";
import {
  createEstablishedUserSessionResult,
  createStaffSessionActor,
  userStaffExpiresAt,
  type UserSessionResult,
} from "./user-session-result";

const USER_SESSIONS: SessionTableConfig = { table: "sessions", subjectColumn: "user_id" };

export interface PreparedUserSession {
  sessionId: string;
  expiresAt: string;
  createdAt: string;
  statement: StatementLike;
}

export function prepareUserSession(
  db: DatabaseLike,
  userId: string,
  sessionTtlHours: number,
): Promise<PreparedUserSession> {
  return prepareSessionRow(db, USER_SESSIONS, userId, sessionTtlHours);
}

function activityAtOrCreatedAt(activityAt: number | undefined, createdAt: string): number {
  if (activityAt !== undefined) return activityAt;
  const createdAtSeconds = Math.floor(new Date(createdAt).getTime() / 1000);
  if (!Number.isSafeInteger(createdAtSeconds)) {
    throw new AppError(401, "AUTH_INVALID", "Invalid user session activity timestamp");
  }
  return createdAtSeconds;
}

function assertActivityActive(idleExpiresAt: string): void {
  if (new Date(idleExpiresAt).getTime() <= Date.now()) {
    throw new AppError(401, "AUTH_EXPIRED", "User session expired due to inactivity");
  }
}

export async function findActiveIdentity(
  db: DatabaseLike,
  userId: string,
): Promise<{ id: string; email: string; normalized_email: string } | null> {
  return first(db, "SELECT id, email, normalized_email FROM users WHERE id = ? AND active = 1", [userId]);
}

interface SignInIdentity {
  id: string;
  email: string;
  normalized_email: string;
  sign_in_email: string;
  normalized_sign_in_email: string;
  sign_in_email_id: string | null;
}

async function findActiveIdentityBySignInEmail(db: DatabaseLike, email: string): Promise<SignInIdentity | null> {
  return first<SignInIdentity>(
    db,
    `SELECT u.id, u.email, u.normalized_email,
            u.email AS sign_in_email, u.normalized_email AS normalized_sign_in_email,
            NULL AS sign_in_email_id
       FROM users u
      WHERE u.normalized_email = ? AND u.active = 1
     UNION ALL
     SELECT u.id, u.email, u.normalized_email,
            ue.email AS sign_in_email, ue.normalized_email AS normalized_sign_in_email,
            ue.id AS sign_in_email_id
       FROM user_emails ue
       JOIN users u ON u.id = ue.user_id AND u.active = 1
      WHERE ue.normalized_email = ? AND ue.verified_at IS NOT NULL
      LIMIT 1`,
    [normalizeEmail(email), normalizeEmail(email)],
  );
}

async function findCapabilitySignInIdentity(
  db: DatabaseLike,
  subjectId: string,
  signingSecret: string,
  capability: Parameters<typeof emailAuthCapabilityMatchesEmail>[0]["capability"],
): Promise<SignInIdentity | null> {
  const addresses = await all<SignInIdentity>(
    db,
    `SELECT u.id, u.email, u.normalized_email,
            u.email AS sign_in_email, u.normalized_email AS normalized_sign_in_email,
            NULL AS sign_in_email_id
       FROM users u
      WHERE u.id = ? AND u.active = 1
     UNION ALL
     SELECT u.id, u.email, u.normalized_email,
            ue.email AS sign_in_email, ue.normalized_email AS normalized_sign_in_email,
            ue.id AS sign_in_email_id
       FROM user_emails ue
       JOIN users u ON u.id = ue.user_id AND u.active = 1
      WHERE u.id = ? AND ue.verified_at IS NOT NULL`,
    [subjectId, subjectId],
  );
  for (const address of addresses) {
    if (
      await emailAuthCapabilityMatchesEmail({
        signingSecret,
        capability,
        currentEmail: address.sign_in_email,
      })
    ) {
      return address;
    }
  }
  return null;
}

async function verifyUserSessionRequest(
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<UserSessionTokenClaims> {
  const token = getUserSessionToken(request);
  if (!token) throw new AppError(401, "AUTH_REQUIRED", "Missing user session token");
  if (!env.INTERNAL_SIGNING_SECRET) {
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  }
  const verified = await verifyUserSessionToken(env.INTERNAL_SIGNING_SECRET, token);
  if (!verified.ok) {
    throw new AppError(
      401,
      verified.reason === "expired" ? "AUTH_EXPIRED" : "AUTH_INVALID",
      verified.reason === "expired" ? "User session expired" : "Invalid user session token",
    );
  }
  return verified.claims;
}

/** Resolve identity, capacities, and acting identity from one session row and live D1 state. */
async function resolveUserSessionClaims(db: DatabaseLike, claims: UserSessionTokenClaims): Promise<UserSessionResult> {
  const row = assertSessionActive(await fetchSessionRow(db, USER_SESSIONS, claims.sid, claims.sub), "user");
  const lastActivityAt = activityAtOrCreatedAt(claims.lastActivityAt, row.createdAt);
  const idleExpiresAt = sessionIdleExpiresAt(lastActivityAt, row.expiresAt, DEFAULT_USER_SESSION_IDLE_TTL_HOURS);
  assertActivityActive(idleExpiresAt);
  const [identity, staff, member, sponsors, pendingIdentityCount, eventParticipation, affiliation, actingIdentities] =
    await Promise.all([
      findActiveIdentity(db, claims.sub),
      findEligibleStaffUserById(db, claims.sub),
      findEligibleMemberById(db, claims.sub, claims.iid),
      findActiveSponsorCapacitiesByUserId(db, claims.sub),
      countPendingIdentitiesForUser(db, claims.sub),
      hasEventParticipation(db, claims.sub),
      hasActiveAffiliation(db, claims.sub),
      findActingIdentitiesForUser(db, claims.sub),
    ]);
  if (
    !identity ||
    (!staff && !member && sponsors.length === 0 && pendingIdentityCount === 0 && !eventParticipation && !affiliation)
  ) {
    throw new AppError(401, "AUTH_INVALID", "This user session no longer has an active capacity");
  }
  const elevatedStaffExpiry = userStaffExpiresAt(row.createdAt, row.expiresAt);
  const staffLastActivityAt = activityAtOrCreatedAt(claims.staffLastActivityAt, row.createdAt);
  const staffIdleExpiresAt = sessionIdleExpiresAt(
    staffLastActivityAt,
    elevatedStaffExpiry,
    STAFF_SESSION_IDLE_TTL_HOURS,
  );
  const staffActive = new Date(staffIdleExpiresAt).getTime() > Date.now();
  if (staff && !staffActive) {
    throw new AppError(401, "AUTH_EXPIRED", "Your session expired. Sign in again.");
  }
  const staffActor =
    staff && staffActive
      ? await createStaffSessionActor(db, staff, row.id, elevatedStaffExpiry, member?.memberId ?? null, claims.state)
      : null;
  // The selection is honored only while that identity is still active.
  const actingIdentityId = resolveSessionActingIdentityId(actingIdentities, claims.iid);
  recordAuditActingIdentity(identity.id, actingIdentityId);
  return {
    identity: { id: identity.id, email: identity.email },
    sessionId: row.id,
    expiresAt: row.expiresAt,
    idleExpiresAt,
    ...(staffActor ? { staff: staffActor } : {}),
    ...(staffActor ? { staffIdleExpiresAt } : {}),
    ...(member ? { member: { ...member, sessionId: row.id, expiresAt: row.expiresAt } } : {}),
    sponsors,
    pendingIdentityCount,
    eventParticipation,
    hasActiveAffiliation: affiliation,
    actingIdentities,
    actingIdentityId,
  };
}

async function resolveUserSessionContext(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<{ session: UserSessionResult; claims: UserSessionTokenClaims }> {
  const claims = await verifyUserSessionRequest(request, env);
  return { claims, session: await resolveUserSessionClaims(db, claims) };
}

export async function resolveUserSessionFromRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<UserSessionResult> {
  return (await resolveUserSessionContext(db, request, env)).session;
}

/**
 * Re-resolves the session and reissues its token with fresh activity. With
 * `actingIdentityId`, the reissued session acts as that identity instead, once
 * it is re-verified against the caller's own live identities.
 */
export async function refreshUserSessionFromRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  options: { actingIdentityId?: string } = {},
): Promise<{ session: UserSessionResult; token: string }> {
  const resolved = await resolveUserSessionContext(db, request, env);
  let session = resolved.session;
  let claims = resolved.claims;
  if (options.actingIdentityId !== undefined) {
    if (!session.actingIdentities.some((identity) => identity.id === options.actingIdentityId)) {
      throw new AppError(403, "NOT_ACTIVE_IDENTITY", "You do not actively hold this identity");
    }
    claims = { ...claims, iid: options.actingIdentityId };
    session = await resolveUserSessionClaims(db, claims);
  }
  const secret = env.INTERNAL_SIGNING_SECRET;
  if (!secret) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing user session token");
  }

  const activityAt = Math.floor(Date.now() / 1000);
  const idleExpiresAt = sessionIdleExpiresAt(activityAt, session.expiresAt, DEFAULT_USER_SESSION_IDLE_TTL_HOURS);
  const staffIdleExpiresAt = session.staff
    ? sessionIdleExpiresAt(activityAt, session.staff.expiresAt!, STAFF_SESSION_IDLE_TTL_HOURS)
    : undefined;
  const token = await signUserSessionToken(secret, {
    sub: claims.sub,
    sid: claims.sid,
    exp: claims.exp,
    identityId: claims.iid,
    state: claims.state,
    lastActivityAt: activityAt,
    staffLastActivityAt: session.staff ? activityAt : (claims.staffLastActivityAt ?? 0),
  });
  return {
    session: {
      ...session,
      idleExpiresAt,
      ...(staffIdleExpiresAt ? { staffIdleExpiresAt } : {}),
    },
    token,
  };
}

/** The authenticated human behind a session, independent of capacity. */
export interface AuthenticatedIdentity {
  userId: string;
  email: string;
  sessionId: string;
  expiresAt: string;
}

const identityByRequest = new WeakMap<Request, AuthenticatedIdentity>();

/** Requires a live human session, but not a specific Member capacity. */
export async function requireIdentityFromRequest(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<AuthenticatedIdentity> {
  const cached = identityByRequest.get(request);
  if (cached) return cached;

  if (!getUserSessionToken(request)) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing user session token");
  }
  const session = await resolveUserSessionFromRequest(db, request, {
    INTERNAL_SIGNING_SECRET: env?.INTERNAL_SIGNING_SECRET,
  });
  const identity: AuthenticatedIdentity = {
    userId: session.identity.id,
    email: session.identity.email,
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
  };
  identityByRequest.set(request, identity);
  return identity;
}

/**
 * The signed-in person behind a public action that guests may also take.
 * A session the server no longer accepts (removed, revoked, expired, or an
 * idle staff elevation) is the same as no session here: the page already
 * treats `/auth/session`'s 401 as signed out, so refusing the action with that
 * session error would contradict what the visitor sees.
 */
export async function resolveOptionalIdentityFromRequest(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<AuthenticatedIdentity | undefined> {
  if (!getUserSessionToken(request)) return undefined;
  try {
    return await requireIdentityFromRequest(db, request, env);
  } catch (error) {
    if (error instanceof AppError && error.status === 401) return undefined;
    throw error;
  }
}

export async function queueUserSignInCapability(payload: {
  db: DatabaseLike;
  email: string;
  ttlMinutes: number;
  signingSecret: string;
  ipHash?: string | null;
  userAgentHash?: string | null;
}): Promise<{
  queuedToken: string;
  identity: { id: string; email: string };
  recipientEmail: string;
  capacities: Array<"staff" | "member" | "sponsor" | "identity_invitation" | "event_participant" | "affiliation">;
} | null> {
  const identity = await findActiveIdentityBySignInEmail(payload.db, payload.email);
  if (!identity) return null;
  const [staff, member, sponsors, pendingIdentityCount, eventParticipation, affiliation] = await Promise.all([
    findEligibleStaffUserById(payload.db, identity.id),
    findEligibleMemberById(payload.db, identity.id),
    findActiveSponsorCapacitiesByUserId(payload.db, identity.id),
    countPendingIdentitiesForUser(payload.db, identity.id),
    hasEventParticipation(payload.db, identity.id),
    hasActiveAffiliation(payload.db, identity.id),
  ]);
  if (!staff && !member && sponsors.length === 0 && pendingIdentityCount === 0 && !eventParticipation && !affiliation)
    return null;
  const capability = await queueEmailAuthCapability({
    signingSecret: payload.signingSecret,
    purpose: "user_sign_in",
    subjectId: identity.id,
    email: identity.sign_in_email,
    ttlSeconds: payload.ttlMinutes * 60,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
  });
  return {
    queuedToken: capability.queuedToken,
    identity: { id: identity.id, email: identity.email },
    recipientEmail: identity.sign_in_email,
    capacities: [
      ...(staff ? ["staff" as const] : []),
      ...(member ? ["member" as const] : []),
      ...(sponsors.length > 0 ? ["sponsor" as const] : []),
      ...(pendingIdentityCount > 0 ? ["identity_invitation" as const] : []),
      ...(eventParticipation ? ["event_participant" as const] : []),
      ...(affiliation ? ["affiliation" as const] : []),
    ],
  };
}

export async function redeemUserSignInCapability(
  db: DatabaseLike,
  payload: {
    token: string;
    signingSecret: string;
    sessionTtlHours: number;
    ipHash?: string | null;
    userAgentHash?: string | null;
  },
): Promise<{ session: UserSessionResult; token: string }> {
  const capability = await verifyEmailAuthCapabilityToken({
    signingSecret: payload.signingSecret,
    purpose: "user_sign_in",
    token: payload.token,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
  });
  const signInIdentity = await findCapabilitySignInIdentity(
    db,
    capability.subjectId,
    payload.signingSecret,
    capability,
  );
  if (!signInIdentity) throw new AppError(404, "MAGIC_LINK_INVALID", "Invalid magic link token");
  const identity = {
    id: signInIdentity.id,
    email: signInIdentity.email,
    normalized_email: signInIdentity.normalized_email,
  };
  const [staff, member, sponsors, pendingIdentityCount, eventParticipation, affiliation, actingIdentities] =
    await Promise.all([
      findEligibleStaffUserById(db, capability.subjectId),
      findEligibleMemberById(db, capability.subjectId),
      findActiveSponsorCapacitiesByUserId(db, capability.subjectId),
      countPendingIdentitiesForUser(db, capability.subjectId),
      hasEventParticipation(db, capability.subjectId),
      hasActiveAffiliation(db, capability.subjectId),
      findActingIdentitiesForUser(db, capability.subjectId),
    ]);
  if (!staff && !member && sponsors.length === 0 && pendingIdentityCount === 0 && !eventParticipation && !affiliation) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This identity no longer has portal access");
  }
  recordAuditActingIdentity(identity.id, resolveSessionActingIdentityId(actingIdentities, null));
  await assertEmailAuthCapabilityEmail({
    signingSecret: payload.signingSecret,
    capability,
    currentEmail: signInIdentity.sign_in_email,
  });
  const prepared = await prepareUserSession(db, identity.id, payload.sessionTtlHours);
  const verifiedAt = nowIso();
  const authorizationEvidence = signInCapacityAuthorizationEvidence(
    {
      identity,
      staff,
      member,
      sponsors,
      pendingIdentityCount,
      eventParticipation,
      hasActiveAffiliation: affiliation,
      actingIdentities,
    },
    signInIdentity.normalized_sign_in_email,
  );
  await commitEmailAuthRedemption(db, {
    purpose: "user_sign_in",
    capabilityId: capability.capabilityId,
    actorType: "user",
    actorId: identity.id,
    action: "user_magic_link_verified",
    entityType: "identity_session",
    entityId: prepared.sessionId,
    details: {
      capacities: [
        ...(staff ? ["staff"] : []),
        ...(member ? ["member"] : []),
        ...(sponsors.length > 0 ? ["sponsor"] : []),
        ...(pendingIdentityCount > 0 ? ["identity_invitation"] : []),
        ...(eventParticipation ? ["event_participant"] : []),
        ...(affiliation ? ["affiliation"] : []),
      ],
      expiresAt: prepared.expiresAt,
    },
    createdAt: verifiedAt,
    authorizationEvidence,
    statements: [
      ...(signInIdentity.sign_in_email_id === null
        ? [
            prepareVerifyPrimaryEmailStatement(db, {
              userId: identity.id,
              normalizedEmail: signInIdentity.normalized_sign_in_email,
              method: "magic_link",
              verifiedAt,
            }),
          ]
        : []),
      prepared.statement,
    ],
  });
  const session = await createEstablishedUserSessionResult(db, prepared, {
    identity,
    staff,
    member,
    sponsors,
    pendingIdentityCount,
    eventParticipation,
    actingIdentities,
  });
  const token = await signUserSessionToken(payload.signingSecret, {
    sub: identity.id,
    sid: prepared.sessionId,
    exp: sessionExpiresAtToExp(prepared.expiresAt),
    identityId: session.actingIdentityId,
  });
  return { session, token };
}

export {
  getUserSessionCookieToken,
  getUserSessionToken,
  serializeExpiredUserSessionCookie,
  serializeUserSessionCookie,
  signUserSessionToken,
  verifyUserSessionToken,
  USER_SESSION_COOKIE_NAME,
  USER_SESSION_COOKIE_PATH,
  USER_SESSION_TOKEN_HEADER,
  type UserSessionTokenClaims,
} from "./user-session-token";
export { createEstablishedUserSessionResult, userStaffExpiresAt, type UserSessionResult } from "./user-session-result";
