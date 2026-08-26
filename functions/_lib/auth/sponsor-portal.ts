/**
 * Sponsor portal authentication — "Sponsor Portal — Attendee Data
 * Access".
 *
 * Shares the signed email-auth capability mechanism with admin/member while
 * retaining a distinct revocable session. A sponsor contact has no
 * `users` row, so the identity being authenticated is a `sponsorships.id`,
 * not a `users.id`. Only the normal `sponsor_portal_sessions` table is
 * sponsor-specific, with a distinct JWT `typ` claim so a sponsor-portal
 * session can never be replayed against an admin/member endpoint or vice
 * versa.
 *
 * Access is re-checked against the live `sponsorships` row on every request
 * (not just at token-issuance time): "Access window: Active while
 * the sponsorship is in `active` stage; revoked if sponsorship lapses."
 */
import { AppError } from "../errors";
import { first } from "../db/queries";
import { normalizeEmail } from "../validation";
import { signJwt, verifyJwt, type JwtVerifyResult } from "../utils/jwt";
import type { DatabaseLike } from "../types";
import {
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
  type SessionTableConfig,
} from "./session-engine";
import { SPONSOR_PORTAL_SESSION_COOKIE_NAME, SPONSOR_PORTAL_SESSION_COOKIE_PATH } from "./session-cookies";
export { SPONSOR_PORTAL_SESSION_COOKIE_NAME, SPONSOR_PORTAL_SESSION_COOKIE_PATH } from "./session-cookies";
import {
  assertEmailAuthCapabilityEmail,
  commitEmailAuthRedemption,
  queueEmailAuthCapability,
  verifyEmailAuthCapabilityToken,
} from "./email-auth-capabilities";
import { nowIso } from "../utils/time";
import type { AuthorizationEvidence } from "../db/authorization-guard";

export interface SponsorPortalSession {
  sponsorshipId: string;
  eventId: string;
  eventName: string | null;
  tier: string;
  contactEmail: string;
  sessionId?: string;
  expiresAt?: string;
}

interface SponsorshipEligibleRow {
  id: string;
  event_id: string | null;
  event_name: string | null;
  tier: string | null;
  contact_email: string | null;
}

const SPONSOR_PORTAL_SESSION_TOKEN_TYPE = "sponsor-portal-session";

const SESSIONS_TABLE: SessionTableConfig = { table: "sponsor_portal_sessions", subjectColumn: "sponsorship_id" };

function sponsorSignInAuthorizationEvidence(
  sponsorshipId: string,
  normalizedContactEmail: string,
): AuthorizationEvidence {
  return {
    sql: `SELECT 1
          FROM sponsorships s
          JOIN events e ON e.id = s.event_id
          WHERE s.id = ?
            AND s.sponsor_type = 'event'
            AND s.pipeline_stage = 'active'
            AND s.event_id IS NOT NULL
            AND lower(trim(s.contact_email)) = ?`,
    bindings: [sponsorshipId, normalizedContactEmail],
  };
}

const sponsorPortalByRequest = new WeakMap<Request, SponsorPortalSession>();

export interface SponsorPortalSessionTokenClaims {
  typ: "sponsor-portal-session";
  sub: string; // sponsorships.id
  sid: string;
  exp: number;
}

function isSponsorPortalSessionTokenClaims(claims: object): claims is SponsorPortalSessionTokenClaims {
  return hasBaseSessionTokenClaims(claims, SPONSOR_PORTAL_SESSION_TOKEN_TYPE);
}

export function getSponsorPortalSessionCookieToken(request: Request): string | null {
  return getSessionCookieToken(request, SPONSOR_PORTAL_SESSION_COOKIE_NAME);
}

export function serializeSponsorPortalSessionCookie(token: string, request: Request): string {
  return serializeSessionCookie(SPONSOR_PORTAL_SESSION_COOKIE_NAME, SPONSOR_PORTAL_SESSION_COOKIE_PATH, token, request);
}

export function serializeExpiredSponsorPortalSessionCookie(request: Request): string {
  return serializeExpiredSessionCookie(SPONSOR_PORTAL_SESSION_COOKIE_NAME, SPONSOR_PORTAL_SESSION_COOKIE_PATH, request);
}

export async function revokeSponsorPortalSession(db: DatabaseLike, sessionId: string): Promise<void> {
  await revokeSessionRow(db, SESSIONS_TABLE.table, sessionId);
}

async function findActiveEventSponsorship(
  db: DatabaseLike,
  sponsorshipId: string,
): Promise<SponsorshipEligibleRow | null> {
  return first<SponsorshipEligibleRow>(
    db,
    `SELECT s.id, s.event_id, e.name AS event_name, s.tier, s.contact_email
     FROM sponsorships s
     JOIN events e ON e.id = s.event_id
     WHERE s.id = ? AND s.sponsor_type = 'event' AND s.pipeline_stage = 'active' AND s.event_id IS NOT NULL`,
    [sponsorshipId],
  );
}

function toSponsorPortalSession(row: SponsorshipEligibleRow): SponsorPortalSession {
  return {
    sponsorshipId: row.id,
    eventId: row.event_id as string,
    eventName: row.event_name,
    tier: row.tier ?? "",
    contactEmail: row.contact_email ?? "",
  };
}

export async function signSponsorPortalSessionToken(
  secret: string,
  payload: { sponsorshipId: string; sessionId: string; expiresAt: string },
): Promise<string> {
  const claims: SponsorPortalSessionTokenClaims = {
    typ: SPONSOR_PORTAL_SESSION_TOKEN_TYPE,
    sub: payload.sponsorshipId,
    sid: payload.sessionId,
    exp: sessionExpiresAtToExp(payload.expiresAt),
  };
  return signJwt(secret, claims as unknown as Record<string, unknown>);
}

export async function verifySponsorPortalSessionToken(
  secret: string,
  token: string,
): Promise<JwtVerifyResult<SponsorPortalSessionTokenClaims>> {
  const result = await verifyJwt<object>(secret, token);
  if (!result.ok) return result;
  if (!isSponsorPortalSessionTokenClaims(result.claims)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, claims: result.claims };
}

export async function issueSponsorPortalSession(
  db: DatabaseLike,
  sponsorshipId: string,
  sessionTtlHours: number,
): Promise<{ sessionId: string; expiresAt: string }> {
  return insertSessionRow(db, SESSIONS_TABLE, sponsorshipId, sessionTtlHours);
}

export function cacheSponsorPortalSessionForRequest(request: Request, session: SponsorPortalSession): void {
  sponsorPortalByRequest.set(request, session);
}

export async function requireSponsorPortalFromRequest(
  db: DatabaseLike,
  request: Request,
  env?: { INTERNAL_SIGNING_SECRET?: string },
): Promise<SponsorPortalSession> {
  const cached = sponsorPortalByRequest.get(request);
  if (cached) return cached;

  const token = getBearerToken(request) ?? getSponsorPortalSessionCookieToken(request);
  if (!token) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing sponsor portal session token");
  }
  if (!env?.INTERNAL_SIGNING_SECRET) {
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  }

  const verified = await verifySponsorPortalSessionToken(env.INTERNAL_SIGNING_SECRET, token);
  if (!verified.ok) {
    throw new AppError(
      401,
      verified.reason === "expired" ? "AUTH_EXPIRED" : "AUTH_INVALID",
      verified.reason === "expired" ? "Sponsor portal session expired" : "Invalid sponsor portal session token",
    );
  }

  const sessionRow = assertSessionActive(
    await fetchSessionRow(db, SESSIONS_TABLE, verified.claims.sid, verified.claims.sub),
    "sponsor portal",
  );

  const sponsorship = await findActiveEventSponsorship(db, sessionRow.subjectId);
  if (!sponsorship || !sponsorship.contact_email) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This sponsorship is no longer active");
  }

  const session = {
    ...toSponsorPortalSession(sponsorship),
    sessionId: sessionRow.id,
    expiresAt: sessionRow.expiresAt,
  };
  cacheSponsorPortalSessionForRequest(request, session);
  return session;
}

/**
 * Looks up an active event sponsorship by contact email + event, and if
 * found, issues (but does not email) a magic link token. Always returns
 * `{ token: null }` for no match, so the request-link route can return a
 * uniform "check your email" response without leaking sponsorship
 * existence.
 *
 * `payload.eventId` accepts either the event's internal id or its public
 * slug (matched against `events.id`/`events.slug` in the same query) —
 * a sponsor contact re-requesting an expired link only ever knows the
 * event's public slug (e.g. from the event's own page or the original
 * invitation email), never the internal id, so the self-service form this
 * feeds can only ever collect a slug. Mirrors the
 * "resolved server-side to the internal events.id" convention
 * POST /api/v1/sponsorship/checkout already established.
 */
export async function queueSponsorPortalSignInCapabilityForEmail(
  db: DatabaseLike,
  payload: {
    email: string;
    eventId: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
    ttlMinutes: number;
    signingSecret: string;
  },
): Promise<{ queuedToken: string | null; sponsorship: SponsorPortalSession | null }> {
  const email = normalizeEmail(payload.email);
  const row = await first<SponsorshipEligibleRow>(
    db,
    `SELECT s.id, s.event_id, e.name AS event_name, s.tier, s.contact_email
     FROM sponsorships s
     JOIN events e ON e.id = s.event_id
     WHERE s.sponsor_type = 'event' AND s.pipeline_stage = 'active' AND (e.id = ? OR e.slug = ?)
       AND s.contact_email IS NOT NULL AND lower(s.contact_email) = ?`,
    [payload.eventId, payload.eventId, email],
  );

  if (!row) {
    return { queuedToken: null, sponsorship: null };
  }

  const capability = await queueSponsorPortalSignInCapability(row.id, row.contact_email!, payload);
  return { queuedToken: capability.queuedToken, sponsorship: toSponsorPortalSession(row) };
}

/**
 * Queues a sign-in capability for a specific, already-known sponsorship.
 * The returned marker is not a bearer credential; the outbox materializes
 * the signed token only when it delivers an authorized server-authored URL.
 */
export async function queueSponsorPortalSignInCapability(
  sponsorshipId: string,
  contactEmail: string,
  payload: {
    signingSecret: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
    ttlMinutes: number;
  },
): Promise<{ queuedToken: string }> {
  const capability = await queueEmailAuthCapability({
    signingSecret: payload.signingSecret,
    purpose: "sponsor_portal_sign_in",
    subjectId: sponsorshipId,
    email: contactEmail,
    ttlSeconds: payload.ttlMinutes * 60,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
  });
  return { queuedToken: capability.queuedToken };
}

export async function redeemSponsorPortalSignInCapability(
  db: DatabaseLike,
  payload: {
    token: string;
    signingSecret: string;
    sessionTtlHours: number;
    ipHash?: string | null;
    userAgentHash?: string | null;
  },
): Promise<{ session: SponsorPortalSession; sessionId: string; expiresAt: string }> {
  const capability = await verifyEmailAuthCapabilityToken({
    signingSecret: payload.signingSecret,
    purpose: "sponsor_portal_sign_in",
    token: payload.token,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
  });
  const sponsorship = await findActiveEventSponsorship(db, capability.subjectId);
  if (!sponsorship || !sponsorship.contact_email) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This sponsorship is no longer active");
  }
  await assertEmailAuthCapabilityEmail({
    signingSecret: payload.signingSecret,
    capability,
    currentEmail: sponsorship.contact_email,
  });

  const prepared = await prepareSessionRow(db, SESSIONS_TABLE, sponsorship.id, payload.sessionTtlHours);
  const verifiedAt = nowIso();
  const normalizedContactEmail = normalizeEmail(sponsorship.contact_email);
  await commitEmailAuthRedemption(db, {
    purpose: "sponsor_portal_sign_in",
    capabilityId: capability.capabilityId,
    actorType: "sponsor",
    actorId: sponsorship.id,
    action: "sponsor_portal_magic_link_verified",
    entityType: "sponsor_portal_session",
    entityId: prepared.sessionId,
    details: { expiresAt: prepared.expiresAt },
    createdAt: verifiedAt,
    authorizationEvidence: sponsorSignInAuthorizationEvidence(sponsorship.id, normalizedContactEmail),
    statements: [prepared.statement],
  });
  return { session: toSponsorPortalSession(sponsorship), sessionId: prepared.sessionId, expiresAt: prepared.expiresAt };
}
