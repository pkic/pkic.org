import { SCREEN_POLICY } from "../../../assets/shared/event-screen-policy";
import { SCREEN_PAIRING_CODE_ALPHABET, SCREEN_PAIRING_CODE_LENGTH } from "../../../assets/shared/schemas/event-screens";
import { hmacSha256Bytes, randomToken, sha256Hex } from "../utils/crypto";
import { signJwt, verifyJwt } from "../utils/jwt";
import { addMinutes, nowIso } from "../utils/time";
import { getSessionCookieToken, serializeExpiredSessionCookie, serializeSessionCookie } from "./session-engine";
import { SCREEN_PAIRING_COOKIE_NAME, SCREEN_SESSION_COOKIE_PATH } from "./session-cookies";

/**
 * An unpaired screen's pairing challenge. The browser holds a signed
 * `{screenId, nonce, exp}` cookie; the code it shows is derived from that
 * nonce, so issuing a code stores nothing and only the browser that holds the
 * cookie can collect the sign-in staff approve for that code.
 */
const CHALLENGE_TYPE = "screen-pairing";
const CODE_DOMAIN = "pkic-screen-pairing-code:v1";
const CODE_HASH_DOMAIN = "pkic-screen-pairing-code-hash:v1";

interface ScreenPairingClaims {
  typ: typeof CHALLENGE_TYPE;
  sub: string;
  nonce: string;
  exp: number;
}

export type ScreenPairingChallenge =
  | { ok: true; code: string; expiresAt: string }
  | { ok: false; reason: "invalid" | "expired" };

/** The short code a person reads off the screen; every symbol is equally likely (32 divides 256). */
export async function deriveScreenPairingCode(secret: string, screenId: string, nonce: string): Promise<string> {
  const bytes = await hmacSha256Bytes(secret, `${CODE_DOMAIN}\0${screenId}\0${nonce}`);
  return [...bytes.slice(0, SCREEN_PAIRING_CODE_LENGTH)]
    .map((byte) => SCREEN_PAIRING_CODE_ALPHABET[byte % SCREEN_PAIRING_CODE_ALPHABET.length])
    .join("");
}

/** What a pending sign-in stores of the code staff approved; bound to the screen it was approved for. */
export function screenPairingCodeHash(screenId: string, code: string): Promise<string> {
  return sha256Hex(`${CODE_HASH_DOMAIN}\0${screenId}\0${code}`);
}

export async function issueScreenPairingChallenge(secret: string, screenId: string) {
  const nonce = randomToken(24);
  const expiresAt = addMinutes(nowIso(), SCREEN_POLICY.pairingMinutes);
  const claims: ScreenPairingClaims = {
    typ: CHALLENGE_TYPE,
    sub: screenId,
    nonce,
    exp: Math.floor(Date.parse(expiresAt) / 1000),
  };
  return {
    token: await signJwt(secret, { ...claims }),
    code: await deriveScreenPairingCode(secret, screenId, nonce),
    expiresAt,
  };
}

/** The code a genuine challenge for this screen proves, or why it proves none. */
export async function readScreenPairingChallenge(
  secret: string,
  request: Request,
  screenId: string,
): Promise<ScreenPairingChallenge> {
  const token = getSessionCookieToken(request, SCREEN_PAIRING_COOKIE_NAME);
  if (!token) return { ok: false, reason: "invalid" };
  const verified = await verifyJwt<Partial<ScreenPairingClaims>>(secret, token);
  if (!verified.ok) return verified;
  const claims = verified.claims;
  if (claims.typ !== CHALLENGE_TYPE || claims.sub !== screenId || typeof claims.nonce !== "string" || !claims.nonce)
    return { ok: false, reason: "invalid" };
  return {
    ok: true,
    code: await deriveScreenPairingCode(secret, screenId, claims.nonce),
    expiresAt: new Date(claims.exp! * 1000).toISOString(),
  };
}

function challengeCookiePath(screenId: string): string {
  return `${SCREEN_SESSION_COOKIE_PATH}/${encodeURIComponent(screenId)}`;
}

export function serializeScreenPairingCookie(token: string, screenId: string, request: Request): string {
  return serializeSessionCookie(SCREEN_PAIRING_COOKIE_NAME, challengeCookiePath(screenId), token, request, {
    maxAgeSeconds: SCREEN_POLICY.pairingMinutes * 60,
  });
}

export function serializeExpiredScreenPairingCookie(screenId: string, request: Request): string {
  return serializeExpiredSessionCookie(SCREEN_PAIRING_COOKIE_NAME, challengeCookiePath(screenId), request);
}
