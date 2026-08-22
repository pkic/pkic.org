/**
 * Sponsor portal authentication — "Sponsor Portal — Attendee Data
 * Access".
 *
 * Shares session/magic-link mechanism with ./admin.ts and ./member.ts via
 * ./session-engine.ts. What stays separate: a sponsor contact has no
 * `users` row ("no separate account required, consistent with the
 * non-member sponsor use case"), so the identity being authenticated is a
 * `sponsorships.id`, not a `users.id`. `auth_magic_links`/`sessions` are
 * both `user_id NOT NULL`, so this uses its own tables
 * (`sponsor_portal_magic_links`/`sponsor_portal_sessions`, consolidated migration 0035)
 * with the same shape, and a distinct JWT `typ` claim so a sponsor-portal
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
  fetchSessionRow,
  assertSessionActive,
  revokeSessionRow,
  insertMagicLinkRow,
  prepareMagicLinkRow,
  fetchMagicLinkRowByToken,
  validateAndConsumeMagicLinkRow,
  type SessionTableConfig,
  type MagicLinkTableConfig,
} from "./session-engine";
import { SPONSOR_PORTAL_SESSION_COOKIE_NAME, SPONSOR_PORTAL_SESSION_COOKIE_PATH } from "./session-cookies";
export { SPONSOR_PORTAL_SESSION_COOKIE_NAME, SPONSOR_PORTAL_SESSION_COOKIE_PATH } from "./session-cookies";

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
const MAGIC_LINKS_TABLE: MagicLinkTableConfig = {
  table: "sponsor_portal_magic_links",
  subjectColumn: "sponsorship_id",
};

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
  if (!sponsorship) {
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
export async function requestSponsorPortalMagicLink(
  db: DatabaseLike,
  payload: {
    email: string;
    eventId: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
    ttlMinutes: number;
  },
): Promise<{ token: string | null; sponsorship: SponsorPortalSession | null }> {
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
    return { token: null, sponsorship: null };
  }

  const token = await issueSponsorPortalMagicLinkForSponsorship(db, row.id, payload);
  return { token, sponsorship: toSponsorPortalSession(row) };
}

/**
 * Issues a magic link token for a specific, already-known sponsorship
 * record — used both by requestSponsorPortalMagicLink (self-service
 * re-request) and by the stage-transition route when a sponsorship first
 * goes active at a qualifying tier (the sponsor-portal-access email).
 */
export async function issueSponsorPortalMagicLinkForSponsorship(
  db: DatabaseLike,
  sponsorshipId: string,
  payload: { ipHash?: string | null; userAgentHash?: string | null; ttlMinutes: number },
): Promise<string> {
  return insertMagicLinkRow(db, MAGIC_LINKS_TABLE, sponsorshipId, payload);
}

export async function prepareSponsorPortalMagicLinkForSponsorship(
  db: DatabaseLike,
  sponsorshipId: string,
  payload: { ipHash?: string | null; userAgentHash?: string | null; ttlMinutes: number },
) {
  return prepareMagicLinkRow(db, MAGIC_LINKS_TABLE, sponsorshipId, payload);
}

export async function verifySponsorPortalMagicLink(
  db: DatabaseLike,
  payload: { token: string; sessionTtlHours: number; ipHash?: string | null; userAgentHash?: string | null },
): Promise<{ session: SponsorPortalSession; sessionId: string; expiresAt: string }> {
  const row = await fetchMagicLinkRowByToken(db, MAGIC_LINKS_TABLE, payload.token);
  if (!row) {
    throw new AppError(404, "MAGIC_LINK_INVALID", "Invalid sponsor portal magic link token");
  }

  await validateAndConsumeMagicLinkRow(db, MAGIC_LINKS_TABLE.table, row, payload);

  const sponsorship = await findActiveEventSponsorship(db, row.subjectId);
  if (!sponsorship) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This sponsorship is no longer active");
  }

  const { sessionId, expiresAt } = await issueSponsorPortalSession(db, sponsorship.id, payload.sessionTtlHours);
  return { session: toSponsorPortalSession(sponsorship), sessionId, expiresAt };
}
