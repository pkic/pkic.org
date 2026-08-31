/**
 * Canonical human identity session.
 *
 * A user may currently have staff and/or member capacity. Those capacities
 * are deliberately projections of live database state, never JWT authority.
 * The token only identifies the user/session and carries non-authoritative
 * context hints used by the read-replica and membership-context adapters.
 */
import type { PublicStaffCapacity } from "../../../assets/shared/schemas/staff-capacity";
import type { SponsorCapacity } from "../../../assets/shared/schemas/sponsor-access";
import type { AuthMember, DatabaseLike, Env, StatementLike, UserBackedAuthAdmin } from "../types";
import { all, first } from "../db/queries";
import { AppError } from "../errors";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { signJwt, verifyJwt, type JwtVerifyResult } from "../utils/jwt";
import { createUserBackedAuthAdmin, publicStaffCapacity } from "./admin-identity";
import {
  findEligibleStaffUserById,
  staffSignInAuthorizationEvidence,
  findEligibleMemberById,
  memberSignInAuthorizationEvidence,
  countPendingIdentitiesForUser,
  pendingIdentitySignInAuthorizationEvidence,
  type EligibleStaffUser,
} from "./identity-capacities";
import { computeGrantsForUser } from "./permissions";
import { AUTH_SCOPES } from "./scopes";
import {
  assertSessionActive,
  fetchSessionRow,
  getBearerToken,
  getSessionCookieToken,
  prepareSessionRow,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
  sessionExpiresAtToExp,
  type SessionTableConfig,
} from "./session-engine";
import { USER_SESSION_COOKIE_NAME, USER_SESSION_COOKIE_PATH } from "./session-cookies";
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

const USER_SESSIONS: SessionTableConfig = { table: "sessions", subjectColumn: "user_id" };
const STAFF_CAPACITY_TTL_HOURS = 8;
const USER_SESSION_TOKEN_TYPE = "user-session";
export const USER_SESSION_TOKEN_HEADER = "x-user-token";

export interface UserSessionTokenClaims {
  typ: typeof USER_SESSION_TOKEN_TYPE;
  sub: string;
  sid: string;
  exp: number;
  /** Non-authoritative selected acting-identity hint. Revalidated on every request. */
  iid?: string;
  /** Non-authoritative D1 read-replica bookmark hint. */
  state?: string;
}

export interface UserSessionResult {
  identity: { id: string; email: string };
  sessionId: string;
  expiresAt: string;
  staff?: UserBackedAuthAdmin;
  member?: AuthMember;
  sponsors: SponsorCapacity[];
  pendingIdentityCount: number;
}

export interface PreparedUserSession {
  sessionId: string;
  expiresAt: string;
  createdAt: string;
  statement: StatementLike;
}

function isUserSessionClaims(claims: object): claims is UserSessionTokenClaims {
  const candidate = claims as Partial<UserSessionTokenClaims>;
  return (
    candidate.typ === USER_SESSION_TOKEN_TYPE &&
    typeof candidate.sub === "string" &&
    typeof candidate.sid === "string" &&
    typeof candidate.exp === "number" &&
    (candidate.iid === undefined || typeof candidate.iid === "string") &&
    (candidate.state === undefined || typeof candidate.state === "string")
  );
}

export async function signUserSessionToken(
  secret: string,
  payload: Pick<UserSessionTokenClaims, "sub" | "sid" | "exp"> & { identityId?: string | null; state?: string | null },
): Promise<string> {
  return signJwt(secret, {
    typ: USER_SESSION_TOKEN_TYPE,
    sub: payload.sub,
    sid: payload.sid,
    exp: payload.exp,
    ...(payload.identityId ? { iid: payload.identityId } : {}),
    ...(payload.state ? { state: payload.state } : {}),
  });
}

export async function verifyUserSessionToken(
  secret: string,
  token: string,
): Promise<JwtVerifyResult<UserSessionTokenClaims>> {
  const result = await verifyJwt<object>(secret, token);
  if (!result.ok) return result;
  return isUserSessionClaims(result.claims) ? { ok: true, claims: result.claims } : { ok: false, reason: "invalid" };
}

export function getUserSessionCookieToken(request: Request): string | null {
  return getSessionCookieToken(request, USER_SESSION_COOKIE_NAME);
}

export function getUserSessionToken(request: Request): string | null {
  return (
    request.headers.get(USER_SESSION_TOKEN_HEADER) ?? getUserSessionCookieToken(request) ?? getBearerToken(request)
  );
}

export function serializeUserSessionCookie(token: string, request: Request): string {
  return serializeSessionCookie(USER_SESSION_COOKIE_NAME, USER_SESSION_COOKIE_PATH, token, request);
}

export function serializeExpiredUserSessionCookie(request: Request): string {
  return serializeExpiredSessionCookie(USER_SESSION_COOKIE_NAME, USER_SESSION_COOKIE_PATH, request);
}

export function prepareUserSession(
  db: DatabaseLike,
  userId: string,
  sessionTtlHours: number,
): Promise<PreparedUserSession> {
  return prepareSessionRow(db, USER_SESSIONS, userId, sessionTtlHours);
}

export function userStaffExpiresAt(createdAt: string, sessionExpiresAt: string): string {
  const elevatedExpiresAt = new Date(new Date(createdAt).getTime() + STAFF_CAPACITY_TTL_HOURS * 60 * 60 * 1000);
  const sessionExpiry = new Date(sessionExpiresAt);
  return (elevatedExpiresAt < sessionExpiry ? elevatedExpiresAt : sessionExpiry).toISOString();
}

async function toStaff(
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
    role: staff.role,
    scopes: staff.role === "admin" ? [...AUTH_SCOPES] : [],
    grants: await computeGrantsForUser(db, staff.id, memberId),
    memberId,
    sessionId,
    expiresAt,
    ...(state ? { state } : {}),
  });
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
export async function resolveUserSessionFromRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<UserSessionResult> {
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
  const [identity, staff, member, sponsors, pendingIdentityCount] = await Promise.all([
    findActiveIdentity(db, verified.claims.sub),
    findEligibleStaffUserById(db, verified.claims.sub),
    findEligibleMemberById(db, verified.claims.sub, verified.claims.iid),
    findActiveSponsorCapacitiesByUserId(db, verified.claims.sub),
    countPendingIdentitiesForUser(db, verified.claims.sub),
  ]);
  if (!identity || (!staff && !member && sponsors.length === 0 && pendingIdentityCount === 0)) {
    throw new AppError(401, "AUTH_INVALID", "This user session no longer has an active capacity");
  }
  const elevatedStaffExpiry = userStaffExpiresAt(row.createdAt, row.expiresAt);
  const staffActive = new Date(elevatedStaffExpiry).getTime() > Date.now();
  if (!staffActive && !member && sponsors.length === 0 && pendingIdentityCount === 0) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This account has no active portal capacity");
  }
  const staffActor =
    staff && staffActive
      ? await toStaff(db, staff, row.id, elevatedStaffExpiry, member?.memberId ?? null, verified.claims.state)
      : null;
  return {
    identity: { id: identity.id, email: identity.email },
    sessionId: row.id,
    expiresAt: row.expiresAt,
    ...(staffActor ? { staff: staffActor } : {}),
    ...(member ? { member: { ...member, sessionId: row.id, expiresAt: row.expiresAt } } : {}),
    sponsors,
    pendingIdentityCount,
  };
}

export function publicUserSession(result: UserSessionResult): {
  identity: { id: string; email: string };
  staff?: PublicStaffCapacity;
  member?: AuthMember;
  sponsors: SponsorCapacity[];
  pendingIdentityCount: number;
} {
  return {
    identity: result.identity,
    ...(result.staff ? { staff: publicStaffCapacity(result.staff) } : {}),
    ...(result.member ? { member: result.member } : {}),
    sponsors: result.sponsors,
    pendingIdentityCount: result.pendingIdentityCount,
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
  capacities: Array<"staff" | "member" | "sponsor" | "identity_invitation">;
} | null> {
  const identity = await findActiveIdentityBySignInEmail(payload.db, payload.email);
  if (!identity) return null;
  const [staff, member, sponsors, pendingIdentityCount] = await Promise.all([
    findEligibleStaffUserById(payload.db, identity.id),
    findEligibleMemberById(payload.db, identity.id),
    findActiveSponsorCapacitiesByUserId(payload.db, identity.id),
    countPendingIdentitiesForUser(payload.db, identity.id),
  ]);
  if (!staff && !member && sponsors.length === 0 && pendingIdentityCount === 0) return null;
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
  const [staff, member, sponsors, pendingIdentityCount] = await Promise.all([
    findEligibleStaffUserById(db, capability.subjectId),
    findEligibleMemberById(db, capability.subjectId),
    findActiveSponsorCapacitiesByUserId(db, capability.subjectId),
    countPendingIdentitiesForUser(db, capability.subjectId),
  ]);
  if (!staff && !member && sponsors.length === 0 && pendingIdentityCount === 0) {
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
  const staffExpiry = staff ? userStaffExpiresAt(prepared.createdAt, prepared.expiresAt) : null;
  const session: UserSessionResult = {
    identity,
    sessionId: prepared.sessionId,
    expiresAt: prepared.expiresAt,
    ...(staff && staffExpiry
      ? { staff: await toStaff(db, staff, prepared.sessionId, staffExpiry, member?.memberId ?? null) }
      : {}),
    ...(member ? { member: { ...member, sessionId: prepared.sessionId, expiresAt: prepared.expiresAt } } : {}),
    sponsors,
    pendingIdentityCount,
  };
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
  const staffExpiry = staff ? userStaffExpiresAt(prepared.createdAt, prepared.expiresAt) : null;
  const session: UserSessionResult = {
    identity: { id: preparedUser.user.id, email: preparedUser.user.email },
    sessionId: prepared.sessionId,
    expiresAt: prepared.expiresAt,
    ...(staff && staffExpiry
      ? { staff: await toStaff(db, staff, prepared.sessionId, staffExpiry, member?.memberId ?? null) }
      : {}),
    ...(member ? { member: { ...member, sessionId: prepared.sessionId, expiresAt: prepared.expiresAt } } : {}),
    sponsors,
    pendingIdentityCount,
  };
  const token = await signUserSessionToken(payload.signingSecret, {
    sub: preparedUser.user.id,
    sid: prepared.sessionId,
    exp: sessionExpiresAtToExp(prepared.expiresAt),
    identityId: member?.identityId,
  });
  return { session, token };
}

export { USER_SESSION_COOKIE_NAME, USER_SESSION_COOKIE_PATH } from "./session-cookies";
