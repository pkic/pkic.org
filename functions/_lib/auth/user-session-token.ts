import { signJwt, verifyJwt, type JwtVerifyResult } from "../utils/jwt";
import {
  getBearerToken,
  getSessionCookieToken,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
} from "./session-engine";
import { USER_SESSION_COOKIE_NAME, USER_SESSION_COOKIE_PATH, USER_SESSION_TOKEN_HEADER } from "./session-cookies";

const USER_SESSION_TOKEN_TYPE = "user-session";

export interface UserSessionTokenClaims {
  typ: typeof USER_SESSION_TOKEN_TYPE;
  sub: string;
  sid: string;
  exp: number;
  /** Non-authoritative selected acting-identity hint. Revalidated on every request. */
  iid?: string;
  /** Non-authoritative D1 read-replica bookmark hint. */
  state?: string;
  /** Signed Unix time of the last user interaction acknowledged by the server. */
  lastActivityAt?: number;
  /** Signed Unix time of the last interaction while staff elevation was active. */
  staffLastActivityAt?: number;
}

function isUserSessionClaims(claims: object): claims is UserSessionTokenClaims {
  const candidate = claims as Partial<UserSessionTokenClaims>;
  return (
    candidate.typ === USER_SESSION_TOKEN_TYPE &&
    typeof candidate.sub === "string" &&
    typeof candidate.sid === "string" &&
    typeof candidate.exp === "number" &&
    (candidate.iid === undefined || typeof candidate.iid === "string") &&
    (candidate.state === undefined || typeof candidate.state === "string") &&
    (candidate.lastActivityAt === undefined ||
      (Number.isSafeInteger(candidate.lastActivityAt) && candidate.lastActivityAt >= 0)) &&
    (candidate.staffLastActivityAt === undefined ||
      (Number.isSafeInteger(candidate.staffLastActivityAt) && candidate.staffLastActivityAt >= 0))
  );
}

export async function signUserSessionToken(
  secret: string,
  payload: Pick<UserSessionTokenClaims, "sub" | "sid" | "exp"> & {
    identityId?: string | null;
    state?: string | null;
    lastActivityAt?: number;
    staffLastActivityAt?: number;
  },
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return signJwt(secret, {
    typ: USER_SESSION_TOKEN_TYPE,
    sub: payload.sub,
    sid: payload.sid,
    exp: payload.exp,
    ...(payload.identityId ? { iid: payload.identityId } : {}),
    ...(payload.state ? { state: payload.state } : {}),
    lastActivityAt: payload.lastActivityAt ?? issuedAt,
    staffLastActivityAt: payload.staffLastActivityAt ?? payload.lastActivityAt ?? issuedAt,
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

export { USER_SESSION_COOKIE_NAME, USER_SESSION_COOKIE_PATH, USER_SESSION_TOKEN_HEADER } from "./session-cookies";
