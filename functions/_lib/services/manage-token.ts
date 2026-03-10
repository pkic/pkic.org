/**
 * Shared helper — resolves a raw registration manage token (plain or JWT) to a
 * `RegistrationRecord`.  Used by both the registration-manage endpoint and the
 * attendee-facing headshot upload endpoint.
 */

import { json } from "../http";
import { sha256Hex } from "../utils/crypto";
import { verifyAdminManageJwt } from "../utils/jwt";
import { getRegistrationByManageToken, getRegistrationById } from "./registrations";
import type { RegistrationRecord } from "./registrations";
import type { DatabaseLike } from "../types";

export type { RegistrationRecord };

/**
 * Resolves a manage token to a registration record.
 *
 * JWT tokens (3 dot-separated segments) are verified via HMAC + IP/UA claims.
 * Plain tokens fall back to the DB hash lookup used by email-based links.
 *
 * Returns either a result object or a `Response` (error) — callers should
 * check `instanceof Response` and return early when it is.
 */
export async function resolveManageToken(
  request: Request,
  env: { DB: DatabaseLike; INTERNAL_SIGNING_SECRET?: string },
  token: string,
): Promise<{ registration: RegistrationRecord; isJwt: boolean } | Response> {
  const secret = env.INTERNAL_SIGNING_SECRET;
  if (secret && token.split(".").length === 3) {
    const result = await verifyAdminManageJwt(secret, token);
    if (!result.ok) {
      const message = result.reason === "expired"
        ? "This manage link has expired. Please open the manage page again from the admin panel."
        : "Invalid manage token.";
      return json({ error: { code: "AUTH_INVALID", message } }, 401);
    }
    const ip =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "";
    const ua = request.headers.get("user-agent") ?? "";
    const [iphash, uahash] = await Promise.all([sha256Hex(ip), sha256Hex(ua)]);
    if (iphash !== result.claims.iphash || uahash !== result.claims.uahash) {
      return json({ error: { code: "AUTH_INVALID", message: "This link is not valid from your current browser or network." } }, 403);
    }
    const registration = await getRegistrationById(env.DB, result.claims.sub);
    return { registration, isJwt: true };
  }
  const registration = await getRegistrationByManageToken(env.DB, token);
  return { registration, isJwt: false };
}
