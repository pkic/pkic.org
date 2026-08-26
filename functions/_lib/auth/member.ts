/**
 * Member-facing (non-staff) authentication.
 *
 * Shares session/magic-link mechanism with ./admin.ts and
 * ./sponsor-portal.ts via ./session-engine.ts (cookie parsing, JWT claims
 * base shape, session/magic-link row issue/fetch/consume). What stays
 * separate is the eligibility gate and identity: admin.ts's
 * STAFF_ACCESS_CONDITION deliberately excludes plain members (role='user'
 * with no user_roles/permission_grants), so `/api/v1/me/*` needs its own
 * eligibility gate — an active `members` row — and its own JWT `typ` claim
 * so an admin session token can never be replayed against a member-only
 * endpoint or vice versa.
 *
 * Scope: magic-link login only. Passkey login for members is not built in
 * this phase — the existing passkey service (_lib/services/passkeys.ts)
 * hardcodes admin-session issuance (findEligibleStaffUserById,
 * issueAdminSession) in completePasskeyAuthentication, and generalizing it
 * is more surface area than call for (the
 * "Auth modernization" goal already treats magic link as a fully
 * sufficient fallback). same class of
 * decision as the deferred passkey management UI.
 */
import { AppError } from "../errors";
import { all, first } from "../db/queries";
import { normalizeEmail } from "../validation";
import { signJwt, verifyJwt, type JwtVerifyResult } from "../utils/jwt";
import type { AuthMember, EligibleMembership, DatabaseLike, Env, StatementLike } from "../types";
import { prepareVerifyPrimaryEmailStatement } from "../services/email-verification";
import { prepareVerifiedDomainAssociationStatements } from "../services/organization-representations";
import { nowIso } from "../utils/time";
import {
  AUTH_MAGIC_LINK_PURPOSES,
  getBearerToken,
  getSessionCookieToken,
  serializeSessionCookie,
  serializeExpiredSessionCookie,
  sessionExpiresAtToExp,
  hasBaseSessionTokenClaims,
  insertSessionRow,
  prepareSessionRow,
  fetchSessionRow,
  assertSessionActive,
  revokeSessionRow,
  prepareRevokeSessionRow,
  insertMagicLinkRow,
  fetchMagicLinkRowByToken,
  validateAndConsumeMagicLinkRow,
  type SessionTableConfig,
  type MagicLinkTableConfig,
} from "./session-engine";
import { MEMBER_SESSION_COOKIE_NAME, MEMBER_SESSION_COOKIE_PATH } from "./session-cookies";
export { MEMBER_SESSION_COOKIE_NAME, MEMBER_SESSION_COOKIE_PATH } from "./session-cookies";

interface MemberEligibleUserRow {
  id: string;
  email: string;
  normalized_email: string;
  active: number;
  member_id: string;
  organization_id: string | null;
  organization_name: string | null;
  membership_category: string;
  is_ec_member: number;
  sort_key: string;
}

const MEMBER_ELIGIBLE_USER_COLUMNS =
  "id, email, normalized_email, active, member_id, organization_id, organization_name, " +
  "membership_category, is_ec_member, sort_key";

// A user is member-session-eligible when they hold an active individual
// `members` row (org-less: member_type='individual', user_id=that user) OR
// an active `organization_representatives` row for an active org-tied
// aggregate (org-tied members rows have user_id IS NULL — migration
// 0000's CHECK — so a representative is never found via members.user_id
// directly). Unlike admin's STAFF_ACCESS_CONDITION there is no role or
// grant check; self-service is identity-gated (see AuthMember's doc
// comment in types.ts).
//
// Individual membership and organization representation are mutually
// exclusive, but a person can actively represent more than one organization
// at once. This UNION can therefore return multiple rows for one user id.
// `sort_key` gives every consumer a single, deterministic ordering instead of
// relying on whichever row D1 happens to return first — callers that need
// every eligible context read all rows (resolveEligibleMemberships); callers
// that just need "is this email eligible at all" may still take the first.
const MEMBER_ELIGIBLE_USER_SELECT = `
  SELECT u.id, u.email, u.normalized_email, u.active, u.is_ec_member,
         m.id AS member_id, NULL AS organization_id, NULL AS organization_name,
         mca.category_code AS membership_category,
         '0_' || m.created_at AS sort_key
  FROM users u
  JOIN members m ON m.user_id = u.id AND m.status = 'active'
  JOIN member_category_assignments mca ON mca.member_id = m.id

  UNION ALL

  SELECT u.id, u.email, u.normalized_email, u.active, u.is_ec_member,
         m.id AS member_id, m.organization_id, o.name AS organization_name,
         mca.category_code AS membership_category,
         '1_' || r.joined_at AS sort_key
  FROM users u
  JOIN organization_representatives r ON r.user_id = u.id AND r.left_at IS NULL
  JOIN members m ON m.id = r.member_id AND m.status = 'active'
  JOIN member_category_assignments mca ON mca.member_id = m.id
  JOIN organizations o ON o.id = m.organization_id
`;

export interface MemberSessionTokenClaims {
  typ: "member-session";
  sub: string;
  sid: string;
  exp: number;
  /**
   * The membership context (members.id) this session is currently acting
   * as, for a user eligible through more than one (see
   * MEMBER_ELIGIBLE_USER_SELECT's header). Optional: absent means "use the
   * deterministic default" — every read re-verifies this against the
   * user's live eligible memberships (getMemberBySessionClaims), so a
   * stale or tampered claim can never select a context the user doesn't
   * actually hold.
   */
  mid?: string;
}

const MEMBER_SESSION_TOKEN_TYPE = "member-session";

const SESSIONS_TABLE: SessionTableConfig = { table: "sessions", subjectColumn: "user_id" };
const MAGIC_LINKS_TABLE: MagicLinkTableConfig = {
  table: "auth_magic_links",
  subjectColumn: "user_id",
  purpose: AUTH_MAGIC_LINK_PURPOSES.member,
};

const memberByRequest = new WeakMap<Request, AuthMember>();

export function getMemberSessionCookieToken(request: Request): string | null {
  return getSessionCookieToken(request, MEMBER_SESSION_COOKIE_NAME);
}

export function serializeMemberSessionCookie(token: string, request: Request): string {
  return serializeSessionCookie(MEMBER_SESSION_COOKIE_NAME, MEMBER_SESSION_COOKIE_PATH, token, request);
}

export function serializeExpiredMemberSessionCookie(request: Request): string {
  return serializeExpiredSessionCookie(MEMBER_SESSION_COOKIE_NAME, MEMBER_SESSION_COOKIE_PATH, request);
}

function isMemberSessionTokenClaims(claims: object): claims is MemberSessionTokenClaims {
  return hasBaseSessionTokenClaims(claims, MEMBER_SESSION_TOKEN_TYPE);
}

function toEligibleMembership(row: MemberEligibleUserRow): EligibleMembership {
  return {
    memberId: row.member_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    membershipCategory: row.membership_category,
  };
}

/**
 * Builds the resolved AuthMember for a user's full set of eligible
 * membership rows (already ordered deterministically by sort_key). Selects
 * `preferredMemberId` as the active context if it's actually one of this
 * user's eligible memberships, otherwise falls back to the first (default)
 * row — never an arbitrary one, and never one the user doesn't hold.
 */
function toAuthMember(rows: MemberEligibleUserRow[], preferredMemberId?: string | null): AuthMember {
  const selected = (preferredMemberId && rows.find((row) => row.member_id === preferredMemberId)) || rows[0];
  return {
    userId: selected.id,
    email: selected.email,
    memberId: selected.member_id,
    organizationId: selected.organization_id,
    membershipCategory: selected.membership_category,
    isEcMember: selected.is_ec_member === 1,
    activeMemberships: rows.map(toEligibleMembership),
  };
}

export async function signMemberSessionToken(
  secret: string,
  payload: { userId: string; sessionId: string; expiresAt: string; activeMemberId?: string },
): Promise<string> {
  const claims: MemberSessionTokenClaims = {
    typ: MEMBER_SESSION_TOKEN_TYPE,
    sub: payload.userId,
    sid: payload.sessionId,
    exp: sessionExpiresAtToExp(payload.expiresAt),
    ...(payload.activeMemberId ? { mid: payload.activeMemberId } : {}),
  };
  return signJwt(secret, claims as unknown as Record<string, unknown>);
}

export async function verifyMemberSessionToken(
  secret: string,
  token: string,
): Promise<JwtVerifyResult<MemberSessionTokenClaims>> {
  const result = await verifyJwt<object>(secret, token);
  if (!result.ok) return result;
  if (!isMemberSessionTokenClaims(result.claims)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, claims: result.claims };
}

/**
 * Every membership context `userId` is currently eligible to act through,
 * deterministically ordered (see MEMBER_ELIGIBLE_USER_SELECT's header).
 * Empty array, not null, when the user holds none.
 */
async function resolveEligibleMembershipRows(db: DatabaseLike, userId: string): Promise<MemberEligibleUserRow[]> {
  return all<MemberEligibleUserRow>(
    db,
    `SELECT ${MEMBER_ELIGIBLE_USER_COLUMNS}
     FROM (${MEMBER_ELIGIBLE_USER_SELECT}) combined
     WHERE id = ? AND active = 1
     ORDER BY sort_key ASC`,
    [userId],
  );
}

/**
 * True if `userId` currently holds an active `members` row, in which case
 * the returned AuthMember's `memberId`/`organizationId` default to
 * `preferredMemberId` when given and still eligible, otherwise to the
 * deterministic first eligible membership — never an arbitrary D1 row
 * order.
 */
export async function findEligibleMemberById(
  db: DatabaseLike,
  userId: string,
  preferredMemberId?: string | null,
): Promise<AuthMember | null> {
  const rows = await resolveEligibleMembershipRows(db, userId);
  if (rows.length === 0) return null;
  return toAuthMember(rows, preferredMemberId);
}

export async function issueMemberSession(
  db: DatabaseLike,
  member: AuthMember,
  sessionTtlHours: number,
): Promise<{ member: AuthMember; sessionId: string; expiresAt: string }> {
  const { sessionId, expiresAt } = await insertSessionRow(db, SESSIONS_TABLE, member.userId, sessionTtlHours);
  return { member: { ...member, sessionId, expiresAt }, sessionId, expiresAt };
}

/** Prepares a normal revocable member session for an enclosing atomic command. */
export function prepareMemberSession(db: DatabaseLike, userId: string, sessionTtlHours: number) {
  return prepareSessionRow(db, SESSIONS_TABLE, userId, sessionTtlHours);
}

async function getMemberBySessionClaims(db: DatabaseLike, claims: MemberSessionTokenClaims): Promise<AuthMember> {
  const row = assertSessionActive(await fetchSessionRow(db, SESSIONS_TABLE, claims.sid, claims.sub), "member");

  const member = await findEligibleMemberById(db, claims.sub, claims.mid);
  if (!member) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This account is no longer an active member");
  }

  return { ...member, sessionId: row.id, expiresAt: row.expiresAt };
}

/**
 * Switches the acting membership context for an already-authenticated
 * member session — the explicit, authorized alternative to ever picking a
 * membership implicitly. Re-verifies `memberId` against the caller's own
 * live eligible memberships (not the client-supplied claim, not a cached
 * list) before allowing the switch, so a user can never select an
 * organization they don't actually represent.
 */
export async function switchActiveMembership(
  db: DatabaseLike,
  member: AuthMember,
  memberId: string,
): Promise<AuthMember> {
  const rows = await resolveEligibleMembershipRows(db, member.userId);
  if (!rows.some((row) => row.member_id === memberId)) {
    throw new AppError(403, "NOT_ACTIVE_MEMBERSHIP", "You do not actively hold this membership");
  }
  const selected = toAuthMember(rows, memberId);
  return { ...selected, sessionId: member.sessionId, expiresAt: member.expiresAt };
}

export function cacheMemberForRequest(request: Request, member: AuthMember): void {
  memberByRequest.set(request, member);
}

export function getCachedMemberForRequest(request: Request): AuthMember | undefined {
  return memberByRequest.get(request);
}

export async function requireMemberFromRequest(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<AuthMember> {
  const cached = memberByRequest.get(request);
  if (cached) return cached;

  const token = getBearerToken(request) ?? getMemberSessionCookieToken(request);
  if (!token) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing member session token");
  }

  if (!env?.INTERNAL_SIGNING_SECRET) {
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  }

  const verified = await verifyMemberSessionToken(env.INTERNAL_SIGNING_SECRET, token);
  if (!verified.ok) {
    throw new AppError(
      401,
      verified.reason === "expired" ? "AUTH_EXPIRED" : "AUTH_INVALID",
      verified.reason === "expired" ? "Member session expired" : "Invalid member session token",
    );
  }

  const member = await getMemberBySessionClaims(db, verified.claims);
  cacheMemberForRequest(request, member);
  return member;
}

export async function requestMemberMagicLink(
  db: DatabaseLike,
  payload: { email: string; ipHash?: string | null; userAgentHash?: string | null; ttlMinutes: number },
): Promise<{ token: string | null; member: AuthMember | null }> {
  const email = normalizeEmail(payload.email);
  const row = await first<MemberEligibleUserRow>(
    db,
    `SELECT ${MEMBER_ELIGIBLE_USER_COLUMNS}
     FROM (${MEMBER_ELIGIBLE_USER_SELECT}) combined
     WHERE normalized_email = ? AND active = 1
     ORDER BY sort_key ASC`,
    [email],
  );

  if (!row) {
    return { token: null, member: null };
  }

  const token = await insertMagicLinkRow(db, MAGIC_LINKS_TABLE, row.id, payload);
  // Only used by the request-link route to address the notification email
  // and to log/report eligibility — the actual session-granting selection
  // of an active membership happens fresh in verifyMemberMagicLink via
  // findEligibleMemberById, not from this snapshot.
  return { token, member: toAuthMember([row]) };
}

export async function verifyMemberMagicLink(
  db: DatabaseLike,
  payload: { token: string; sessionTtlHours: number; ipHash?: string | null; userAgentHash?: string | null },
): Promise<{ member: AuthMember; sessionId: string; expiresAt: string }> {
  const row = await fetchMagicLinkRowByToken(db, MAGIC_LINKS_TABLE, payload.token);
  if (!row) {
    throw new AppError(404, "MAGIC_LINK_INVALID", "Invalid member magic link token");
  }

  await validateAndConsumeMagicLinkRow(db, MAGIC_LINKS_TABLE.table, row, payload);

  const member = await findEligibleMemberById(db, row.subjectId);
  if (!member) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This account is no longer an active member");
  }

  const normalizedEmail = normalizeEmail(member.email);
  const verifiedAt = nowIso();
  await db.batch([
    prepareVerifyPrimaryEmailStatement(db, {
      userId: row.subjectId,
      normalizedEmail,
      method: "magic_link",
      verifiedAt,
    }),
    ...(await prepareVerifiedDomainAssociationStatements(db, {
      userId: row.subjectId,
      normalizedEmail,
      at: verifiedAt,
    })),
  ]);

  return issueMemberSession(db, member, payload.sessionTtlHours);
}

export async function revokeMemberSession(db: DatabaseLike, sessionId: string): Promise<void> {
  await revokeSessionRow(db, SESSIONS_TABLE.table, sessionId);
}

export function prepareRevokeMemberSession(db: DatabaseLike, sessionId: string): StatementLike {
  return prepareRevokeSessionRow(db, SESSIONS_TABLE.table, sessionId);
}
