import { hasEventParticipation, eventParticipantSignInEvidence } from "./event-participation";
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
  staffSignInAuthorizationEvidence,
  findEligibleMemberById,
  memberSignInAuthorizationEvidence,
  countPendingIdentitiesForUser,
  pendingIdentitySignInAuthorizationEvidence,
} from "./identity-capacities";
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
import { prepareVerifyOwnedEmailStatements } from "../services/email-verification";
import { buildFindOrCreateUserStatement } from "../services/users";
import {
  findActiveSponsorCapacitiesByUserId,
  sponsorSignInAuthorizationEvidence,
  sponsorUserSignInAuthorizationEvidence,
  verifySponsorSignInCapability,
} from "./sponsor-capacity";
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

async function findActiveIdentity(
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

/** Resolve identity and capacities from one session row and live D1 state. */
async function resolveUserSessionContext(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<{ session: UserSessionResult; claims: UserSessionTokenClaims }> {
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
  const row = assertSessionActive(
    await fetchSessionRow(db, USER_SESSIONS, verified.claims.sid, verified.claims.sub),
    "user",
  );
  const lastActivityAt = activityAtOrCreatedAt(verified.claims.lastActivityAt, row.createdAt);
  const idleExpiresAt = sessionIdleExpiresAt(lastActivityAt, row.expiresAt, DEFAULT_USER_SESSION_IDLE_TTL_HOURS);
  assertActivityActive(idleExpiresAt);
  const [identity, staff, member, sponsors, pendingIdentityCount, eventParticipation] = await Promise.all([
    findActiveIdentity(db, verified.claims.sub),
    findEligibleStaffUserById(db, verified.claims.sub),
    findEligibleMemberById(db, verified.claims.sub, verified.claims.iid),
    findActiveSponsorCapacitiesByUserId(db, verified.claims.sub),
    countPendingIdentitiesForUser(db, verified.claims.sub),
    hasEventParticipation(db, verified.claims.sub),
  ]);
  if (!identity || (!staff && !member && sponsors.length === 0 && pendingIdentityCount === 0 && !eventParticipation)) {
    throw new AppError(401, "AUTH_INVALID", "This user session no longer has an active capacity");
  }
  const elevatedStaffExpiry = userStaffExpiresAt(row.createdAt, row.expiresAt);
  const staffLastActivityAt = activityAtOrCreatedAt(verified.claims.staffLastActivityAt, row.createdAt);
  const staffIdleExpiresAt = sessionIdleExpiresAt(
    staffLastActivityAt,
    elevatedStaffExpiry,
    STAFF_SESSION_IDLE_TTL_HOURS,
  );
  const staffActive = new Date(staffIdleExpiresAt).getTime() > Date.now();
  if (!staffActive && !member && sponsors.length === 0 && pendingIdentityCount === 0 && !eventParticipation) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This account has no active portal capacity");
  }
  const staffActor =
    staff && staffActive
      ? await createStaffSessionActor(
          db,
          staff,
          row.id,
          elevatedStaffExpiry,
          member?.memberId ?? null,
          verified.claims.state,
        )
      : null;
  return {
    claims: verified.claims,
    session: {
      identity: { id: identity.id, email: identity.email },
      sessionId: row.id,
      expiresAt: row.expiresAt,
      idleExpiresAt,
      ...(staffActor ? { staff: staffActor } : {}),
      ...(staffActor ? { staffIdleExpiresAt } : {}),
      ...(staff && !staffActive ? { staffReauthenticationRequired: true } : {}),
      ...(member ? { member: { ...member, sessionId: row.id, expiresAt: row.expiresAt } } : {}),
      sponsors,
      pendingIdentityCount,
      eventParticipation,
    },
  };
}

export async function resolveUserSessionFromRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<UserSessionResult> {
  return (await resolveUserSessionContext(db, request, env)).session;
}

export async function refreshUserSessionFromRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<{ session: UserSessionResult; token: string }> {
  const resolved = await resolveUserSessionContext(db, request, env);
  const session = resolved.session;
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
    sub: resolved.claims.sub,
    sid: resolved.claims.sid,
    exp: resolved.claims.exp,
    identityId: resolved.claims.iid,
    state: resolved.claims.state,
    lastActivityAt: activityAt,
    // An expired staff elevation can only be restored through authentication,
    // never by refreshing the remaining member/sponsor session.
    staffLastActivityAt: session.staff ? activityAt : (resolved.claims.staffLastActivityAt ?? 0),
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
  capacities: Array<"staff" | "member" | "sponsor" | "identity_invitation" | "event_participant">;
} | null> {
  const identity = await findActiveIdentityBySignInEmail(payload.db, payload.email);
  if (!identity) return null;
  const [staff, member, sponsors, pendingIdentityCount, eventParticipation] = await Promise.all([
    findEligibleStaffUserById(payload.db, identity.id),
    findEligibleMemberById(payload.db, identity.id),
    findActiveSponsorCapacitiesByUserId(payload.db, identity.id),
    countPendingIdentitiesForUser(payload.db, identity.id),
    hasEventParticipation(payload.db, identity.id),
  ]);
  if (!staff && !member && sponsors.length === 0 && pendingIdentityCount === 0 && !eventParticipation) return null;
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
    capacities: [
      ...(staff ? ["staff" as const] : []),
      ...(member ? ["member" as const] : []),
      ...(sponsors.length > 0 ? ["sponsor" as const] : []),
      ...(pendingIdentityCount > 0 ? ["identity_invitation" as const] : []),
      ...(eventParticipation ? ["event_participant" as const] : []),
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
  const [staff, member, sponsors, pendingIdentityCount, eventParticipation] = await Promise.all([
    findEligibleStaffUserById(db, capability.subjectId),
    findEligibleMemberById(db, capability.subjectId),
    findActiveSponsorCapacitiesByUserId(db, capability.subjectId),
    countPendingIdentitiesForUser(db, capability.subjectId),
    hasEventParticipation(db, capability.subjectId),
  ]);
  if (!staff && !member && sponsors.length === 0 && pendingIdentityCount === 0 && !eventParticipation) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This identity no longer has portal access");
  }
  await assertEmailAuthCapabilityEmail({
    signingSecret: payload.signingSecret,
    capability,
    currentEmail: signInIdentity.sign_in_email,
  });
  const prepared = await prepareUserSession(db, identity.id, payload.sessionTtlHours);
  const verifiedAt = nowIso();
  const authorizationEvidence = [
    ...(eventParticipation
      ? [eventParticipantSignInEvidence(identity.id, signInIdentity.normalized_sign_in_email)]
      : []),
    ...(staff ? [staffSignInAuthorizationEvidence(identity.id, signInIdentity.normalized_sign_in_email)] : []),
    ...(member ? [memberSignInAuthorizationEvidence(identity.id, signInIdentity.normalized_sign_in_email)] : []),
    ...(sponsors.length > 0
      ? [sponsorUserSignInAuthorizationEvidence(identity.id, signInIdentity.normalized_sign_in_email)]
      : []),
    ...(pendingIdentityCount > 0
      ? [pendingIdentitySignInAuthorizationEvidence(identity.id, signInIdentity.normalized_sign_in_email)]
      : []),
  ];
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
  });
  const token = await signUserSessionToken(payload.signingSecret, {
    sub: identity.id,
    sid: prepared.sessionId,
    exp: sessionExpiresAtToExp(prepared.expiresAt),
    identityId: member?.identityId,
  });
  return { session, token };
}

/** Redeem a sponsor-mailbox capability into the same user session used by the portal. */
export async function redeemSponsorSignInCapability(
  db: DatabaseLike,
  payload: {
    token: string;
    signingSecret: string;
    sessionTtlHours: number;
    ipHash?: string | null;
    userAgentHash?: string | null;
  },
): Promise<{ session: UserSessionResult; token: string }> {
  const verified = await verifySponsorSignInCapability(db, payload);
  const preparedUser = await buildFindOrCreateUserStatement(db, {
    email: verified.sponsorship.contactEmail,
  });
  if (!preparedUser.created && !(await findActiveIdentity(db, preparedUser.user.id))) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This identity is inactive");
  }

  const [staff, member] = preparedUser.created
    ? [null, null]
    : await Promise.all([
        findEligibleStaffUserById(db, preparedUser.user.id),
        findEligibleMemberById(db, preparedUser.user.id),
      ]);
  const prepared = await prepareUserSession(db, preparedUser.user.id, payload.sessionTtlHours);
  const verifiedAt = nowIso();
  const normalizedContactEmail = normalizeEmail(verified.sponsorship.contactEmail);
  await commitEmailAuthRedemption(db, {
    purpose: "sponsor_sign_in",
    capabilityId: verified.capability.capabilityId,
    actorType: "user",
    actorId: preparedUser.user.id,
    action: "sponsor_magic_link_verified",
    entityType: "identity_session",
    entityId: prepared.sessionId,
    details: { sponsorId: verified.sponsorship.sponsorId, expiresAt: prepared.expiresAt },
    createdAt: verifiedAt,
    authorizationEvidence: [
      sponsorSignInAuthorizationEvidence(verified.sponsorship.sponsorId, normalizedContactEmail),
      ...(!preparedUser.created
        ? [
            {
              sql: "SELECT 1 FROM users WHERE id = ? AND active = 1",
              bindings: [preparedUser.user.id],
            },
          ]
        : []),
    ],
    statements: [
      ...(preparedUser.statement ? [preparedUser.statement] : []),
      ...prepareVerifyOwnedEmailStatements(db, {
        userId: preparedUser.user.id,
        normalizedEmail: normalizedContactEmail,
        method: "magic_link",
        verifiedAt,
      }),
      prepared.statement,
    ],
  });

  const sponsors = await findActiveSponsorCapacitiesByUserId(db, preparedUser.user.id);
  if (sponsors.length === 0) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This identity no longer has sponsor access");
  }
  const pendingIdentityCount = await countPendingIdentitiesForUser(db, preparedUser.user.id);
  const eventParticipation = await hasEventParticipation(db, preparedUser.user.id);
  const session = await createEstablishedUserSessionResult(db, prepared, {
    identity: { id: preparedUser.user.id, email: preparedUser.user.email },
    staff,
    member,
    sponsors,
    pendingIdentityCount,
    eventParticipation,
  });
  const token = await signUserSessionToken(payload.signingSecret, {
    sub: preparedUser.user.id,
    sid: prepared.sessionId,
    exp: sessionExpiresAtToExp(prepared.expiresAt),
    identityId: member?.identityId,
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
