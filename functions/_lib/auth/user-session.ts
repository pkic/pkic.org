import {
  primaryEmailProofMayAuthenticateSql,
  secondaryEmailSignInAllowedSql,
  signInEmailAuthorizationEvidence,
} from "./email-sign-in-policy";
import { prepareMonthlyActivity, recordMonthlyActivity } from "../services/member-standing/activity";
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
import { first } from "../db/queries";
import { AppError } from "../errors";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import {
  findEligibleStaffUserById,
  resolveEligibleMembershipRows,
  countPendingIdentitiesForUser,
  hasActiveIdentity,
} from "./identity-capacities";
import { signInCapacityAuthorizationEvidence } from "./sign-in-capacity-authorization";
import { findActingIdentitiesForUser } from "./session-acting-identities";
import { resolveSessionActingIdentityId } from "../../../assets/shared/session-acting-identity";
import { recordAuditActingIdentity } from "../services/audit-actor";
import { prepareSessionRow, sessionExpiresAtToExp } from "./session-engine";
import {
  assertEmailAuthCapabilityEmail,
  commitEmailAuthRedemption,
  emailAuthCapabilityMatchesEmail,
  queueEmailAuthCapability,
  SIGN_IN_LINK_REFUSALS,
  verifyEmailAuthCapabilityToken,
} from "./email-auth-capabilities";
import { prepareVerifyPrimaryEmailStatements } from "../services/email-verification";
import { linkVerifiedAddressToDomainOrganization } from "../services/identities/email-domain-link";
import { findActiveSponsorCapacitiesByUserId } from "./sponsor-capacity";
import {
  DEFAULT_USER_SESSION_IDLE_TTL_HOURS,
  sessionIdleExpiresAt,
  STAFF_SESSION_IDLE_TTL_HOURS,
} from "./session-policy";
import { getUserSessionToken, signUserSessionToken, type UserSessionTokenClaims } from "./user-session-token";
import { createEstablishedUserSessionResult, type UserSessionResult } from "./user-session-result";

import { prepareUserSessionRequest } from "./user-session-request";
import { USER_SESSIONS, resolveUserSessionClaims } from "./user-session-claims";
export { findActiveIdentity, resolveUserSessionClaims } from "./user-session-claims";

export interface PreparedUserSession {
  sessionId: string;
  expiresAt: string;
  createdAt: string;
  statements: StatementLike[];
}

export async function prepareUserSession(
  db: DatabaseLike,
  userId: string,
  sessionTtlHours: number,
): Promise<PreparedUserSession> {
  const prepared = await prepareSessionRow(db, USER_SESSIONS, userId, sessionTtlHours);
  return {
    sessionId: prepared.sessionId,
    expiresAt: prepared.expiresAt,
    createdAt: prepared.createdAt,
    statements: [prepared.statement, prepareMonthlyActivity(db, userId, prepared.sessionId, prepared.createdAt)],
  };
}

interface SignInIdentity {
  id: string;
  email: string;
  normalized_email: string;
  sign_in_email: string;
  normalized_sign_in_email: string;
  sign_in_email_id: string | null;
  sign_in_permission_revision: string | null;
}

async function findActiveIdentityBySignInEmail(db: DatabaseLike, email: string): Promise<SignInIdentity | null> {
  return first<SignInIdentity>(
    db,
    `SELECT u.id, u.email, u.normalized_email,
            u.email AS sign_in_email, u.normalized_email AS normalized_sign_in_email,
            NULL AS sign_in_email_id, NULL AS sign_in_permission_revision
       FROM users u
      WHERE u.normalized_email = ? AND u.active = 1 AND u.pii_redacted_at IS NULL AND u.merged_into_user_id IS NULL AND ${primaryEmailProofMayAuthenticateSql("u")}
     UNION ALL
     SELECT u.id, u.email, u.normalized_email,
            ue.email AS sign_in_email, ue.normalized_email AS normalized_sign_in_email,
            ue.id AS sign_in_email_id, permission.revision AS sign_in_permission_revision
       FROM user_emails ue
       JOIN user_email_sign_in_permissions permission ON permission.email_id = ue.id
       JOIN users u ON u.id = ue.user_id AND u.active = 1 AND u.pii_redacted_at IS NULL AND u.merged_into_user_id IS NULL
      WHERE ue.normalized_email = ? AND ${secondaryEmailSignInAllowedSql("ue")}
      LIMIT 1`,
    [normalizeEmail(email), normalizeEmail(email)],
  );
}

async function findCapabilitySignInIdentity(
  db: DatabaseLike,
  subjectId: string,
  signingSecret: string,
  capability: Pick<
    Awaited<ReturnType<typeof verifyEmailAuthCapabilityToken>>,
    "emailFingerprint" | "authorizationRevision"
  >,
): Promise<SignInIdentity | null> {
  const address = await first<SignInIdentity>(
    db,
    capability.authorizationRevision
      ? `SELECT u.id, u.email, u.normalized_email,
          ue.email AS sign_in_email, ue.normalized_email AS normalized_sign_in_email,
          ue.id AS sign_in_email_id, permission.revision AS sign_in_permission_revision
         FROM user_email_sign_in_permissions permission
         JOIN user_emails ue ON ue.id = permission.email_id
         JOIN users u ON u.id = ue.user_id
        WHERE permission.revision = ? AND u.id = ? AND u.active = 1
          AND u.pii_redacted_at IS NULL AND u.merged_into_user_id IS NULL
          AND ${secondaryEmailSignInAllowedSql("ue")} LIMIT 1`
      : `SELECT u.id, u.email, u.normalized_email,
          u.email AS sign_in_email, u.normalized_email AS normalized_sign_in_email,
          NULL AS sign_in_email_id, NULL AS sign_in_permission_revision
         FROM users u WHERE u.id = ? AND u.active = 1
          AND u.pii_redacted_at IS NULL AND u.merged_into_user_id IS NULL AND ${primaryEmailProofMayAuthenticateSql("u")} LIMIT 1`,
    capability.authorizationRevision ? [capability.authorizationRevision, subjectId] : [subjectId],
  );
  return address &&
    (await emailAuthCapabilityMatchesEmail({ signingSecret, capability, currentEmail: address.sign_in_email }))
    ? address
    : null;
}

export async function resolveUserSessionContext(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<{ session: UserSessionResult; claims: UserSessionTokenClaims }> {
  const read = await prepareUserSessionRequest(db, request, env);
  return { claims: read.claims, session: await read.decode(await db.batch(read.statements)) };
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
  await recordMonthlyActivity(db, claims.sub, claims.sid, nowIso());
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
  authorizationEvidence: ReturnType<typeof signInEmailAuthorizationEvidence>;
  capacities: Array<"staff" | "member" | "sponsor" | "identity_invitation" | "event_participant" | "identity">;
} | null> {
  const identity = await findActiveIdentityBySignInEmail(payload.db, payload.email);
  if (!identity) return null;
  const [staff, memberships, sponsors, pendingIdentityCount, eventParticipation, affiliation] = await Promise.all([
    findEligibleStaffUserById(payload.db, identity.id),
    resolveEligibleMembershipRows(payload.db, identity.id),
    findActiveSponsorCapacitiesByUserId(payload.db, identity.id),
    countPendingIdentitiesForUser(payload.db, identity.id),
    hasEventParticipation(payload.db, identity.id),
    hasActiveIdentity(payload.db, identity.id),
  ]);
  const holdsMembership = memberships.length > 0;
  const capability = await queueEmailAuthCapability({
    signingSecret: payload.signingSecret,
    purpose: "user_sign_in",
    subjectId: identity.id,
    email: identity.sign_in_email,
    ...(identity.sign_in_permission_revision ? { authorizationRevision: identity.sign_in_permission_revision } : {}),
    ttlSeconds: payload.ttlMinutes * 60,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
  });
  return {
    queuedToken: capability.queuedToken,
    identity: { id: identity.id, email: identity.email },
    recipientEmail: identity.sign_in_email,
    authorizationEvidence: signInEmailAuthorizationEvidence({
      userId: identity.id,
      normalizedEmail: identity.normalized_sign_in_email,
      emailId: identity.sign_in_email_id,
      permissionRevision: identity.sign_in_permission_revision,
    }),
    capacities: [
      ...(staff ? ["staff" as const] : []),
      ...(holdsMembership ? ["member" as const] : []),
      ...(sponsors.length > 0 ? ["sponsor" as const] : []),
      ...(pendingIdentityCount > 0 ? ["identity_invitation" as const] : []),
      ...(eventParticipation ? ["event_participant" as const] : []),
      ...(affiliation ? ["identity" as const] : []),
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
  if (!signInIdentity) throw new AppError(404, "MAGIC_LINK_INVALID", SIGN_IN_LINK_REFUSALS.invalid);
  const identity = {
    id: signInIdentity.id,
    email: signInIdentity.email,
    normalized_email: signInIdentity.normalized_email,
  };
  const [staff, memberships, sponsors, pendingIdentityCount, eventParticipation, affiliation, actingIdentities] =
    await Promise.all([
      findEligibleStaffUserById(db, capability.subjectId),
      resolveEligibleMembershipRows(db, capability.subjectId),
      findActiveSponsorCapacitiesByUserId(db, capability.subjectId),
      countPendingIdentitiesForUser(db, capability.subjectId),
      hasEventParticipation(db, capability.subjectId),
      hasActiveIdentity(db, capability.subjectId),
      findActingIdentitiesForUser(db, capability.subjectId),
    ]);
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
      memberships,
      sponsors,
      pendingIdentityCount,
      eventParticipation,
      hasActiveIdentity: affiliation,
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
        ...(memberships.length > 0 ? ["member"] : []),
        ...(sponsors.length > 0 ? ["sponsor"] : []),
        ...(pendingIdentityCount > 0 ? ["identity_invitation"] : []),
        ...(eventParticipation ? ["event_participant"] : []),
        ...(affiliation ? ["identity"] : []),
      ],
      expiresAt: prepared.expiresAt,
    },
    createdAt: verifiedAt,
    authorizationEvidence: [
      ...authorizationEvidence,
      signInEmailAuthorizationEvidence({
        userId: identity.id,
        normalizedEmail: signInIdentity.normalized_sign_in_email,
        emailId: signInIdentity.sign_in_email_id,
        permissionRevision: signInIdentity.sign_in_permission_revision,
      }),
    ],
    statements: [
      ...(signInIdentity.sign_in_email_id === null
        ? [
            ...prepareVerifyPrimaryEmailStatements(db, {
              userId: identity.id,
              normalizedEmail: signInIdentity.normalized_sign_in_email,
              method: "magic_link",
              verifiedAt,
            }),
          ]
        : []),
      ...prepared.statements,
      ...(signInIdentity.sign_in_email_id
        ? [
            db
              .prepare(`INSERT INTO session_email_authentication
        (session_id, email_id, permission_revision, normalized_email, created_at) VALUES (?, ?, ?, ?, ?)`)
              .bind(
                prepared.sessionId,
                signInIdentity.sign_in_email_id,
                signInIdentity.sign_in_permission_revision,
                signInIdentity.normalized_sign_in_email,
                verifiedAt,
              ),
          ]
        : []),
    ],
  });
  // The proved address joins the organization its domain belongs to, when the shared rule links it automatically.
  await linkVerifiedAddressToDomainOrganization(db, {
    userId: identity.id,
    normalizedEmail: signInIdentity.normalized_sign_in_email,
  });
  const session = await createEstablishedUserSessionResult(db, prepared, {
    identity,
    staff,
    memberships,
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
  verifyUserSessionToken,
  getUserSessionCookieToken,
  getUserSessionToken,
  serializeExpiredUserSessionCookie,
  serializeUserSessionCookie,
  signUserSessionToken,
  USER_SESSION_COOKIE_NAME,
  USER_SESSION_COOKIE_PATH,
  USER_SESSION_TOKEN_HEADER,
  type UserSessionTokenClaims,
} from "./user-session-token";
export { createEstablishedUserSessionResult, userStaffExpiresAt, type UserSessionResult } from "./user-session-result";
