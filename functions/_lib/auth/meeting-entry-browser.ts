import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike, Env } from "../types";
import { signJwt, verifyJwt } from "../utils/jwt";
import {
  requirePersonalMeetingLink,
  requirePersonalMeetingTarget,
  type PersonalMeetingLink,
} from "../services/event-series/personal-entry-links";
import { requireMemberFromRequest } from "./member";
import { getMeetingGuestSessionCookieToken, requireMeetingGuestSessionToken } from "./meeting-guest-session";
import { getSessionCookieToken, serializeExpiredSessionCookie, serializeSessionCookie } from "./session-engine";
import { getUserSessionToken, resolveUserSessionFromRequest } from "./user-session";

export const MEETING_ENTRY_BROWSER_COOKIE_NAME = "pkic_meeting_entry";
const MEETING_ENTRY_BROWSER_COOKIE_PATH = "/api/v1/meetings/occurrences";
const FRESH_AUTH_MS = 10 * 60_000;
const MAX_COOKIE_LENGTH = 3800;
const MAX_GRANTS = 12;

interface BrowserGrant {
  token: string;
  authenticatedAt: number;
  expiresAt: number;
  sourceKind: "member" | "guest";
  sourceSessionId: string;
}

interface BrowserClaims {
  typ: "meeting-entry-browser";
  grants: BrowserGrant[];
  exp: number;
}

export interface MeetingEntryBrowserSubject {
  kind: "personal";
  userId: string | null;
  guestId: string | null;
  seriesId: string;
  linkOccurrenceId: string | null;
  linkSecret: string;
  authenticatedAt: number;
  expiresAt: number;
  sourceKind: "member" | "guest";
  sourceSessionId: string;
  authentication: "remember_browser" | "always";
  rememberDays: number;
}

function validGrant(value: unknown): value is BrowserGrant {
  if (!value || typeof value !== "object") return false;
  const grant = value as Record<string, unknown>;
  return (
    typeof grant.token === "string" &&
    grant.token.length < 180 &&
    typeof grant.authenticatedAt === "number" &&
    Number.isFinite(grant.authenticatedAt) &&
    typeof grant.expiresAt === "number" &&
    Number.isFinite(grant.expiresAt) &&
    (grant.sourceKind === "member" || grant.sourceKind === "guest") &&
    typeof grant.sourceSessionId === "string" &&
    /^[a-f0-9-]{36}$/i.test(grant.sourceSessionId)
  );
}

async function browserGrants(request: Request, signingSecret: string): Promise<BrowserGrant[]> {
  const token = getSessionCookieToken(request, MEETING_ENTRY_BROWSER_COOKIE_NAME);
  if (!token || token.length > MAX_COOKIE_LENGTH) return [];
  const result = await verifyJwt<BrowserClaims>(signingSecret, token);
  if (!result.ok || result.claims.typ !== "meeting-entry-browser" || !Array.isArray(result.claims.grants)) return [];
  return result.claims.grants
    .filter(validGrant)
    .slice(-MAX_GRANTS)
    .filter((grant) => grant.expiresAt > Date.now());
}

async function browserCookie(request: Request, signingSecret: string, grants: BrowserGrant[]): Promise<string> {
  const ordered = grants.slice(-MAX_GRANTS);
  let token = "";
  while (ordered.length) {
    token = await signJwt(signingSecret, {
      typ: "meeting-entry-browser",
      grants: ordered,
      exp: Math.ceil(Math.max(...ordered.map((grant) => grant.expiresAt)) / 1000),
    });
    if (token.length < MAX_COOKIE_LENGTH) break;
    ordered.shift();
  }
  if (!ordered.length)
    throw new AppError(500, "MEETING_BROWSER_COOKIE_TOO_LARGE", "Meeting browser proof is too large");
  const maxAge = Math.max(1, Math.ceil((Math.max(...ordered.map((grant) => grant.expiresAt)) - Date.now()) / 1000));
  return `${serializeSessionCookie(MEETING_ENTRY_BROWSER_COOKIE_NAME, MEETING_ENTRY_BROWSER_COOKIE_PATH, token, request)}; Max-Age=${maxAge}`;
}

async function hasJoinedSinceAuthentication(
  db: DatabaseLike,
  link: PersonalMeetingLink,
  sourceCreatedAt: string,
): Promise<boolean> {
  const confirmation = await first<{ id: string }>(
    db,
    `SELECT confirmation.id FROM event_occurrence_join_confirmations confirmation
      JOIN event_occurrences occurrence ON occurrence.id = confirmation.occurrence_id
      WHERE occurrence.series_id = ? AND confirmation.user_id IS ? AND confirmation.guest_id IS ?
        AND confirmation.confirmed_at >= ? LIMIT 1`,
    [link.series_id, link.user_id, link.guest_id, sourceCreatedAt],
  );
  return Boolean(confirmation);
}

async function liveGrant(
  db: DatabaseLike,
  grant: BrowserGrant,
  occurrenceId: string,
  signingSecret: string,
): Promise<MeetingEntryBrowserSubject | null> {
  try {
    const link = await requirePersonalMeetingLink(db, grant.token, signingSecret);
    const target = await requirePersonalMeetingTarget(db, link, occurrenceId);
    const now = Date.now();
    const allowedMs =
      target.policy.authentication === "always" ? FRESH_AUTH_MS : target.policy.rememberDays * 86400_000;
    if (grant.authenticatedAt > now || now >= grant.authenticatedAt + allowedMs || now >= grant.expiresAt) return null;
    if (target.policy.authentication === "always") {
      const table = grant.sourceKind === "member" ? "sessions" : "meeting_guest_sessions";
      const source = await first<{ created_at: string; expires_at: string; revoked_at: string | null }>(
        db,
        `SELECT created_at, expires_at, revoked_at FROM ${table} WHERE id = ?`,
        [grant.sourceSessionId],
      );
      if (
        !source ||
        source.revoked_at ||
        Date.parse(source.expires_at) <= now ||
        now >= Date.parse(source.created_at) + FRESH_AUTH_MS ||
        (await hasJoinedSinceAuthentication(db, link, source.created_at))
      )
        return null;
    }
    return {
      kind: "personal",
      userId: link.user_id,
      guestId: link.guest_id,
      seriesId: link.series_id,
      linkOccurrenceId: link.occurrence_id,
      linkSecret: link.link_secret,
      authenticatedAt: grant.authenticatedAt,
      expiresAt: grant.expiresAt,
      sourceKind: grant.sourceKind,
      sourceSessionId: grant.sourceSessionId,
      authentication: target.policy.authentication,
      rememberDays: target.policy.rememberDays,
    };
  } catch (error) {
    if (error instanceof AppError && error.status < 500) return null;
    throw error;
  }
}

export async function meetingEntryBrowserSubject(
  db: DatabaseLike,
  request: Request,
  occurrenceId: string,
  signingSecret: string,
  requiredToken?: string,
): Promise<MeetingEntryBrowserSubject | null> {
  const grants = await browserGrants(request, signingSecret);
  for (const grant of grants.reverse()) {
    if (requiredToken && grant.token !== requiredToken) continue;
    const subject = await liveGrant(db, grant, occurrenceId, signingSecret);
    if (subject) return subject;
  }
  return null;
}

async function sourceSession(
  db: DatabaseLike,
  request: Request,
  link: PersonalMeetingLink,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<{ kind: "member" | "guest"; id: string; createdAt: string } | null> {
  if (link.user_id) {
    try {
      const member = await requireMemberFromRequest(db, request, env);
      if (member.userId !== link.user_id || !member.sessionId) return null;
      const row = await first<{ created_at: string }>(db, "SELECT created_at FROM sessions WHERE id = ?", [
        member.sessionId,
      ]);
      return row ? { kind: "member", id: member.sessionId, createdAt: row.created_at } : null;
    } catch (error) {
      if (error instanceof AppError && error.status < 500) return null;
      throw error;
    }
  }
  const token = getMeetingGuestSessionCookieToken(request);
  if (!token) return null;
  try {
    const guest = await requireMeetingGuestSessionToken(db, token, env);
    if (
      guest.guestId !== link.guest_id ||
      (link.occurrence_id !== null && guest.verifiedOccurrenceId !== link.occurrence_id)
    )
      return null;
    const row = await first<{ created_at: string }>(db, "SELECT created_at FROM meeting_guest_sessions WHERE id = ?", [
      guest.sessionId,
    ]);
    return row ? { kind: "guest", id: guest.sessionId, createdAt: row.created_at } : null;
  } catch (error) {
    if (error instanceof AppError && error.status < 500) return null;
    throw error;
  }
}

export async function establishMeetingEntryBrowser(
  db: DatabaseLike,
  request: Request,
  token: string,
  occurrenceId: string,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<{
  status: "ready" | "verify";
  verification: "member" | "guest";
  name: string;
  eventName: string;
  occurrenceId: string;
  cookie?: string;
}> {
  const signingSecret = env.INTERNAL_SIGNING_SECRET;
  if (!signingSecret) throw new AppError(503, "MEETING_SECURITY_CONFIG_UNAVAILABLE", "Meeting entry is not configured");
  const link = await requirePersonalMeetingLink(db, token, signingSecret);
  const target = await requirePersonalMeetingTarget(db, link, occurrenceId);
  const verification: "member" | "guest" = link.user_id ? "member" : "guest";
  const base = { verification, name: target.name, eventName: target.eventName, occurrenceId };
  if (link.user_id && getUserSessionToken(request)) {
    try {
      const portal = await resolveUserSessionFromRequest(db, request, env);
      if (portal.identity.id !== link.user_id) return { status: "verify", ...base };
    } catch (error) {
      if (!(error instanceof AppError && error.status < 500)) throw error;
    }
  }
  if (await meetingEntryBrowserSubject(db, request, occurrenceId, signingSecret, token)) {
    return { status: "ready", ...base };
  }

  const source = await sourceSession(db, request, link, env);
  if (
    !source ||
    (target.policy.authentication === "always" &&
      (Date.now() >= Date.parse(source.createdAt) + FRESH_AUTH_MS ||
        (await hasJoinedSinceAuthentication(db, link, source.createdAt))))
  )
    return { status: "verify", ...base };

  const authenticatedAt = Date.now();
  const expiresAt =
    target.policy.authentication === "always"
      ? Date.parse(source.createdAt) + FRESH_AUTH_MS
      : authenticatedAt + target.policy.rememberDays * 86400_000;
  const grants = (await browserGrants(request, signingSecret)).filter((grant) => grant.token !== token);
  grants.push({ token, authenticatedAt, expiresAt, sourceKind: source.kind, sourceSessionId: source.id });
  return { status: "ready", ...base, cookie: await browserCookie(request, signingSecret, grants) };
}

export function revokeMeetingEntryBrowser(request: Request): string {
  return serializeExpiredSessionCookie(MEETING_ENTRY_BROWSER_COOKIE_NAME, MEETING_ENTRY_BROWSER_COOKIE_PATH, request);
}
