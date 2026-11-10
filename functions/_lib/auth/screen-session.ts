import { SCREEN_SESSION_MAX_AGE_SECONDS } from "../../../assets/shared/event-screen-policy";
import { signJwt, verifyJwt } from "../utils/jwt";
import {
  getSessionCookieToken,
  hasBaseSessionTokenClaims,
  serializeSessionCookie,
  sessionExpiresAtToExp,
  type BaseSessionTokenClaims,
} from "./session-engine";
import { SCREEN_SESSION_COOKIE_NAME, SCREEN_SESSION_COOKIE_PATH } from "./session-cookies";

/**
 * A paired screen's sign-in: a JWT naming the screen (`sub`) and its
 * `screen_sessions` row (`sid`), checked against that row on every use. It
 * authorizes only a screen reading itself and never passes a staff guard.
 */
const SCREEN_SESSION_TOKEN_TYPE = "screen-session";

export interface ScreenSessionClaims extends BaseSessionTokenClaims {
  typ: typeof SCREEN_SESSION_TOKEN_TYPE;
}

export function signScreenSessionToken(
  secret: string,
  session: { screenId: string; sessionId: string; expiresAt: string },
): Promise<string> {
  const claims: ScreenSessionClaims = {
    typ: SCREEN_SESSION_TOKEN_TYPE,
    sub: session.screenId,
    sid: session.sessionId,
    exp: sessionExpiresAtToExp(session.expiresAt),
  };
  return signJwt(secret, { ...claims });
}

export function hasScreenSessionCookie(request: Request): boolean {
  return getSessionCookieToken(request, SCREEN_SESSION_COOKIE_NAME) !== null;
}

/** The claims of a genuine, unexpired screen sign-in, or why there is none. Liveness is the caller's row check. */
export async function readScreenSessionToken(
  secret: string,
  request: Request,
): Promise<{ ok: true; claims: ScreenSessionClaims } | { ok: false; reason: "missing" | "expired" }> {
  const token = getSessionCookieToken(request, SCREEN_SESSION_COOKIE_NAME);
  if (!token) return { ok: false, reason: "missing" };
  const verified = await verifyJwt<object>(secret, token);
  if (!verified.ok) return { ok: false, reason: verified.reason === "expired" ? "expired" : "missing" };
  if (!hasBaseSessionTokenClaims(verified.claims, SCREEN_SESSION_TOKEN_TYPE)) return { ok: false, reason: "missing" };
  return { ok: true, claims: verified.claims as ScreenSessionClaims };
}

/** HttpOnly, Lax (the device opens the page from its local status page) and kept across restarts. */
export function serializeScreenSessionCookie(token: string, request: Request): string {
  return serializeSessionCookie(SCREEN_SESSION_COOKIE_NAME, SCREEN_SESSION_COOKIE_PATH, token, request, {
    sameSite: "Lax",
    maxAgeSeconds: SCREEN_SESSION_MAX_AGE_SECONDS,
  });
}
