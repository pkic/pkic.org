/**
 * Sponsor portal authentication — PRD §4.13 "Sponsor Portal — Attendee Data
 * Access".
 *
 * A parallel module to ./member.ts, not a reuse of it: a sponsor contact has
 * no `users` row ("no separate account required, consistent with the
 * non-member sponsor use case"), so the identity being authenticated is a
 * `sponsorships.id`, not a `users.id`. `auth_magic_links`/`sessions` are both
 * `user_id NOT NULL`, so this uses its own tables
 * (`sponsor_portal_magic_links`/`sponsor_portal_sessions`, migration 0042)
 * with the same shape, and a distinct JWT `typ` claim so a sponsor-portal
 * session can never be replayed against an admin/member endpoint or vice
 * versa.
 *
 * Access is re-checked against the live `sponsorships` row on every request
 * (not just at token-issuance time) — §4.13: "Access window: Active while
 * the sponsorship is in `active` stage; revoked if sponsorship lapses."
 */
import { AppError } from "../errors";
import { first, run } from "../db/queries";
import { normalizeEmail } from "../validation";
import { nowIso, addMinutes, addHours } from "../utils/time";
import { randomToken, sha256Hex } from "../utils/crypto";
import { signJwt, verifyJwt, type JwtVerifyResult } from "../utils/jwt";
import { uuid } from "../utils/ids";
import type { DatabaseLike } from "../types";

export interface SponsorPortalSession {
  sponsorshipId: string;
  eventId: string;
  tier: string;
  contactEmail: string;
  sessionId?: string;
  expiresAt?: string;
}

interface SponsorshipEligibleRow {
  id: string;
  event_id: string | null;
  tier: string | null;
  contact_email: string | null;
}

const SPONSOR_PORTAL_SESSION_TOKEN_TYPE = "sponsor-portal-session";
export const SPONSOR_PORTAL_SESSION_COOKIE_NAME = "pkic_sponsor_portal_session";
export const SPONSOR_PORTAL_SESSION_COOKIE_PATH = "/api/v1/sponsor-portal";

const sponsorPortalByRequest = new WeakMap<Request, SponsorPortalSession>();

export interface SponsorPortalSessionTokenClaims {
  typ: "sponsor-portal-session";
  sub: string; // sponsorships.id
  sid: string;
  exp: number;
}

function isSponsorPortalSessionTokenClaims(claims: object): claims is SponsorPortalSessionTokenClaims {
  const candidate = claims as Partial<SponsorPortalSessionTokenClaims>;
  return (
    candidate.typ === SPONSOR_PORTAL_SESSION_TOKEN_TYPE &&
    typeof candidate.sub === "string" &&
    typeof candidate.sid === "string" &&
    typeof candidate.exp === "number"
  );
}

function parseCookieHeader(cookieHeader: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!name) continue;
    values.set(name, decodeURIComponent(value));
  }
  return values;
}

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function getSponsorPortalSessionCookieToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (!cookieHeader) return null;
  return parseCookieHeader(cookieHeader).get(SPONSOR_PORTAL_SESSION_COOKIE_NAME) ?? null;
}

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

export function serializeSponsorPortalSessionCookie(token: string, request: Request): string {
  const parts = [
    `${SPONSOR_PORTAL_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${SPONSOR_PORTAL_SESSION_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (isSecureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

function sessionExpiresAtToExp(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid expiresAt timestamp: ${expiresAt}`);
  }
  return Math.floor(ms / 1000);
}

async function findActiveEventSponsorship(
  db: DatabaseLike,
  sponsorshipId: string,
): Promise<SponsorshipEligibleRow | null> {
  return first<SponsorshipEligibleRow>(
    db,
    `SELECT id, event_id, tier, contact_email FROM sponsorships
     WHERE id = ? AND sponsor_type = 'event' AND pipeline_stage = 'active' AND event_id IS NOT NULL`,
    [sponsorshipId],
  );
}

function toSponsorPortalSession(row: SponsorshipEligibleRow): SponsorPortalSession {
  return {
    sponsorshipId: row.id,
    eventId: row.event_id as string,
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
  const sessionId = uuid();
  const sessionHash = await sha256Hex(randomToken(24));
  const expiresAt = addHours(nowIso(), sessionTtlHours);

  await run(
    db,
    `INSERT INTO sponsor_portal_sessions (id, sponsorship_id, token_hash, expires_at, revoked_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [sessionId, sponsorshipId, sessionHash, expiresAt, nowIso()],
  );

  return { sessionId, expiresAt };
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

  const sessionRow = await first<{ id: string; sponsorship_id: string; expires_at: string; revoked_at: string | null }>(
    db,
    `SELECT id, sponsorship_id, expires_at, revoked_at FROM sponsor_portal_sessions WHERE id = ? AND sponsorship_id = ?`,
    [verified.claims.sid, verified.claims.sub],
  );
  if (!sessionRow) {
    throw new AppError(401, "AUTH_INVALID", "Invalid sponsor portal session token");
  }
  if (sessionRow.revoked_at) {
    throw new AppError(401, "AUTH_REVOKED", "Sponsor portal session is revoked");
  }
  if (new Date(sessionRow.expires_at).getTime() <= Date.now()) {
    throw new AppError(401, "AUTH_EXPIRED", "Sponsor portal session expired");
  }

  const sponsorship = await findActiveEventSponsorship(db, sessionRow.sponsorship_id);
  if (!sponsorship) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This sponsorship is no longer active");
  }

  const session = {
    ...toSponsorPortalSession(sponsorship),
    sessionId: sessionRow.id,
    expiresAt: sessionRow.expires_at,
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
    `SELECT id, event_id, tier, contact_email FROM sponsorships
     WHERE sponsor_type = 'event' AND pipeline_stage = 'active' AND event_id = ?
       AND contact_email IS NOT NULL AND lower(contact_email) = ?`,
    [payload.eventId, email],
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
  const token = randomToken(24);
  const tokenHash = await sha256Hex(token);
  const now = nowIso();

  await run(
    db,
    `INSERT INTO sponsor_portal_magic_links (
      id, sponsorship_id, token_hash, expires_at, used_at, request_ip_hash, user_agent_hash, created_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
    [
      uuid(),
      sponsorshipId,
      tokenHash,
      addMinutes(now, payload.ttlMinutes),
      payload.ipHash ?? null,
      payload.userAgentHash ?? null,
      now,
    ],
  );

  return token;
}

export async function verifySponsorPortalMagicLink(
  db: DatabaseLike,
  payload: { token: string; sessionTtlHours: number; ipHash?: string | null; userAgentHash?: string | null },
): Promise<{ session: SponsorPortalSession; sessionId: string; expiresAt: string }> {
  const tokenHash = await sha256Hex(payload.token);
  const row = await first<{
    id: string;
    sponsorship_id: string;
    expires_at: string;
    used_at: string | null;
    request_ip_hash: string | null;
    user_agent_hash: string | null;
  }>(
    db,
    `SELECT id, sponsorship_id, expires_at, used_at, request_ip_hash, user_agent_hash
     FROM sponsor_portal_magic_links WHERE token_hash = ?`,
    [tokenHash],
  );

  if (!row) {
    throw new AppError(404, "MAGIC_LINK_INVALID", "Invalid sponsor portal magic link token");
  }
  if (row.used_at) {
    throw new AppError(409, "MAGIC_LINK_USED", "Magic link already used");
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError(410, "MAGIC_LINK_EXPIRED", "Magic link expired");
  }
  if (row.request_ip_hash && row.request_ip_hash !== payload.ipHash) {
    throw new AppError(403, "MAGIC_LINK_CONTEXT_MISMATCH", "Magic link is not valid from this network");
  }
  if (row.user_agent_hash && row.user_agent_hash !== payload.userAgentHash) {
    throw new AppError(403, "MAGIC_LINK_CONTEXT_MISMATCH", "Magic link is not valid from this browser");
  }

  const consume = await run(db, "UPDATE sponsor_portal_magic_links SET used_at = ? WHERE id = ? AND used_at IS NULL", [
    nowIso(),
    row.id,
  ]);
  if (consume.changes === 0) {
    throw new AppError(409, "MAGIC_LINK_USED", "Magic link already used");
  }

  const sponsorship = await findActiveEventSponsorship(db, row.sponsorship_id);
  if (!sponsorship) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This sponsorship is no longer active");
  }

  const { sessionId, expiresAt } = await issueSponsorPortalSession(db, sponsorship.id, payload.sessionTtlHours);
  return { session: toSponsorPortalSession(sponsorship), sessionId, expiresAt };
}
