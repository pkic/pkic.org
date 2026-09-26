import { getConfig } from "../config";
import { requestDb, type AdminContext } from "../db/context";
import { jsonNoStore } from "../http";
import { enforceEmailTriggerRateLimits, enforceRateLimit } from "../rate-limit";
import { getClientIp, getUserAgent, hashOptional, requireInternalSecret } from "../request";
import type { DatabaseLike, StatementLike } from "../types";

export interface MagicLinkRequestHttpContext {
  db: DatabaseLike;
  secret: string;
  appBaseUrl: string;
  magicLinkTtlMinutes: number;
  ipHash: string | null;
  userAgentHash: string | null;
}

export interface MagicLinkVerificationHttpContext {
  db: DatabaseLike;
  secret: string;
  ipHash: string | null;
  userAgentHash: string | null;
}

async function hashRequestContext(
  c: AdminContext,
  secret: string,
): Promise<{
  ipHash: string | null;
  userAgentHash: string | null;
}> {
  const [ipHash, userAgentHash] = await Promise.all([
    hashOptional(getClientIp(c.req.raw), secret),
    hashOptional(getUserAgent(c.req.raw), secret),
  ]);
  return { ipHash, userAgentHash };
}

/**
 * Applies the identical anti-enumeration request controls. The persona route
 * must supply its own namespace and still owns eligibility, TTL use, link URL,
 * email template, recipient, and delivery policy.
 */
export async function prepareMagicLinkRequestHttp(
  c: AdminContext,
  email: string,
  rateLimitNamespace: string,
): Promise<MagicLinkRequestHttpContext> {
  const clientIp = getClientIp(c.req.raw);
  await enforceEmailTriggerRateLimits({
    emailBinding: c.env.EMAIL_RATE_LIMITER,
    ipBinding: c.env.IP_RATE_LIMITER,
    namespace: rateLimitNamespace,
    email,
    clientIp,
  });

  const config = getConfig(c.env, c.req.raw);
  const secret = requireInternalSecret(c.env);
  const hashes = await hashRequestContext(c, secret);
  return {
    db: requestDb(c),
    secret,
    appBaseUrl: config.appBaseUrl,
    magicLinkTtlMinutes: config.magicLinkTtlMinutes,
    ...hashes,
  };
}

/**
 * Applies the identical verification-attempt control and request-context
 * binding. Persona-specific token consumption, TTL, eligibility, claims, and
 * session permissions remain in the route's auth module.
 */
export async function prepareMagicLinkVerificationHttp(
  c: AdminContext,
  rateLimitNamespace: string,
): Promise<MagicLinkVerificationHttpContext> {
  const secret = requireInternalSecret(c.env);
  const clientIp = getClientIp(c.req.raw);
  await enforceRateLimit({ binding: c.env.IP_RATE_LIMITER, namespace: rateLimitNamespace, key: clientIp });
  return { db: requestDb(c), secret, ...(await hashRequestContext(c, secret)) };
}

/** Adds only the shared sensitive-response transport; callers serialize their own persona cookie. */
export function createSessionEstablishedResponse(body: unknown, serializedCookie: string): Response {
  const response = jsonNoStore(body);
  response.headers.append("Set-Cookie", serializedCookie);
  return response;
}

/** Machine/capability session logout policy; human `/auth/logout` owns the user cookie directly. */
export interface SessionLogoutPolicy {
  readCookie(request: Request): string | null;
  verify(secret: string, token: string): Promise<{ ok: boolean; claims?: { sid: string } }>;
  revoke(db: DatabaseLike, sessionId: string): Promise<void>;
  prepareRevoke?(db: DatabaseLike, sessionId: string): StatementLike;
  serializeExpiredCookie(request: Request): string;
}

export async function logoutSession(c: AdminContext, policy: SessionLogoutPolicy): Promise<Response> {
  const token = policy.readCookie(c.req.raw);
  if (token) {
    const verified = await policy.verify(requireInternalSecret(c.env), token);
    if (verified.ok && verified.claims) {
      if (policy.prepareRevoke) await requestDb(c).batch([policy.prepareRevoke(requestDb(c), verified.claims.sid)]);
      else await policy.revoke(requestDb(c), verified.claims.sid);
    }
  }
  const response = jsonNoStore({ success: true });
  response.headers.append("Set-Cookie", policy.serializeExpiredCookie(c.req.raw));
  return response;
}
