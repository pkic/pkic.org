import type { Env } from "../types";
import {
  getUserSessionToken,
  getUserSessionCookieToken,
  USER_SESSION_COOKIE_NAME,
  serializeUserSessionCookie,
  signUserSessionToken,
  verifyUserSessionToken,
  USER_SESSION_TOKEN_HEADER,
} from "../auth/user-session-token";
import { signMcpSessionToken, verifyMcpSessionToken } from "../auth/mcp-session";
import { parseCookieHeader } from "../auth/session-engine";
import { hasAuthenticationCredential } from "../auth/session-cookies";
import { isPublicDirectoryRead, primaryFirstDb, requestSessionDb } from "./session";

/** Verify the consistency hint without treating signed claims as live authority. */
async function sessionClaims(token: string | null, secret?: string) {
  if (!secret || !token) return null;
  const user = await verifyUserSessionToken(secret, token);
  if (user.ok) return user.claims;
  const mcp = await verifyMcpSessionToken(secret, token);
  return mcp?.ok ? mcp.claims : null;
}

/** One session and bookmark transport for every HTTP route, including agenda saves. */
export async function withRequestD1Session(
  request: Request,
  env: Env,
  handle: (env: Env) => Promise<Response>,
): Promise<Response> {
  // Nested route middleware reuses the invocation's session instead of starting
  // an unrelated one and losing the preceding authentication or write bookmark.
  if (env.DB.getBookmark) return handle(env);
  // Auth routes own credential issuance and conditional logout; even a 200
  // response there must never cause this boundary to reissue an incoming token.
  const url = new URL(request.url);
  const authRoute = url.pathname.startsWith("/api/v1/auth/");
  const publicDirectory = ["GET", "HEAD"].includes(request.method) && isPublicDirectoryRead(url);
  // Public projections ignore incidental credentials; they must not replace a
  // caller's consistency bookmark with one from an unconstrained replica.
  const claims =
    authRoute || publicDirectory
      ? null
      : await sessionClaims(getUserSessionToken(request), env.INTERNAL_SIGNING_SECRET);
  const hint = claims?.state;
  const bookmark = hint && hint.length < 1024 ? hint : null;
  // Opaque service/OAuth credentials cannot transport this signed bookmark.
  // Establish consistency once for those callers; subsequent read batches are
  // still read-only and may use a replica consistent with the first query.
  const db =
    !claims && !publicDirectory && hasAuthenticationCredential(request)
      ? primaryFirstDb(env.DB)
      : requestSessionDb(env.DB, request, bookmark);
  const response = await handle({ ...env, DB: db });
  const state = db.getBookmark?.();
  if (!state || !env.INTERNAL_SIGNING_SECRET || response.status < 200 || response.status >= 400) return response;
  // A newly issued credential owns its identity, expiry, and activity times.
  // Attach the bookmark to that credential, never resurrect the incoming one
  // after logout or overwrite a login/identity-switch with the previous person.
  const cookies = response.headers.getSetCookie();
  const issuedCookie = cookies.find((cookie) => cookie.startsWith(`${USER_SESSION_COOKIE_NAME}=`));
  const issuedUserToken =
    response.headers.get(USER_SESSION_TOKEN_HEADER) ??
    parseCookieHeader(issuedCookie ?? "").get(USER_SESSION_COOKIE_NAME) ??
    null;
  const issuedMcpToken = response.headers.get("x-mcp-token");
  const replacesCredential = issuedCookie !== undefined || issuedUserToken !== null || issuedMcpToken !== null;
  const outputClaims = replacesCredential
    ? await sessionClaims(issuedUserToken ?? issuedMcpToken, env.INTERNAL_SIGNING_SECRET)
    : claims;
  if (!outputClaims) return response;
  try {
    const headers = new Headers(response.headers);
    if (outputClaims.typ === "user-session") {
      const token = await signUserSessionToken(env.INTERNAL_SIGNING_SECRET, {
        ...outputClaims,
        identityId: outputClaims.iid,
        state,
      });
      if (issuedCookie !== undefined) {
        headers.delete("Set-Cookie");
        for (const cookie of cookies)
          headers.append("Set-Cookie", cookie === issuedCookie ? serializeUserSessionCookie(token, request) : cookie);
      } else if (
        !issuedUserToken &&
        !request.headers.has(USER_SESSION_TOKEN_HEADER) &&
        getUserSessionCookieToken(request)
      ) {
        // A slow read must not overwrite a newer save bookmark already stored
        // by a concurrent response. Credential issuance above still owns its cookie.
        if (["GET", "HEAD"].includes(request.method)) return response;
        headers.append("Set-Cookie", serializeUserSessionCookie(token, request));
      } else headers.set(USER_SESSION_TOKEN_HEADER, token);
    } else {
      headers.set("x-mcp-token", await signMcpSessionToken(env.INTERNAL_SIGNING_SECRET, { ...outputClaims, state }));
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    console.error("[request-session] Failed to rotate D1 bookmark:", error);
    return response;
  }
}
