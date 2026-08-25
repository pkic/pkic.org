import { getConfig } from "../config";
import { requestDb, type AdminContext } from "../db/context";
import { jsonNoStore } from "../http";
import { enforceEmailTriggerRateLimits, enforceRateLimit } from "../rate-limit";
import { getClientIp, getUserAgent, hashOptional, requireInternalSecret } from "../request";
import type { AuthMember, DatabaseLike, UserBackedAuthAdmin } from "../types";
import { serializeAdminSessionCookie, signAdminSessionToken } from "./admin";
import { publicAuthAdmin } from "./admin-identity";
import { serializeMemberSessionCookie, signMemberSessionToken } from "./member";
import { adminSessionEstablishedResponseSchema } from "../../../assets/shared/schemas/admin-auth";

export interface MagicLinkRequestHttpContext {
  db: DatabaseLike;
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

interface AdminSessionResponseInput {
  admin: UserBackedAuthAdmin;
  sessionId: string;
  expiresAt: string;
  state?: string | null;
}

interface MemberSessionResponseInput {
  member: AuthMember;
  sessionId: string;
  expiresAt: string;
}

/**
 * Signs and sets every session capacity established for one identity. Admin
 * and member sessions deliberately remain separate token types so existing
 * permission boundaries keep failing closed; a portal login may set both
 * cookies when the same user currently holds both capacities.
 */
export async function createIdentitySessionEstablishedResponse(options: {
  secret: string;
  request: Request;
  body: unknown;
  admin?: AdminSessionResponseInput;
  member?: MemberSessionResponseInput;
}): Promise<Response> {
  if (!options.admin && !options.member) {
    throw new Error("At least one identity session is required");
  }

  const [adminToken, memberToken] = await Promise.all([
    options.admin
      ? signAdminSessionToken(options.secret, {
          admin: options.admin.admin,
          sessionId: options.admin.sessionId,
          expiresAt: options.admin.expiresAt,
          state: options.admin.state,
        })
      : null,
    options.member
      ? signMemberSessionToken(options.secret, {
          userId: options.member.member.userId,
          sessionId: options.member.sessionId,
          expiresAt: options.member.expiresAt,
          activeMemberId: options.member.member.memberId,
        })
      : null,
  ]);

  const response = jsonNoStore(options.body);
  if (adminToken) {
    response.headers.append("Set-Cookie", serializeAdminSessionCookie(adminToken, options.request));
  }
  if (memberToken) {
    response.headers.append("Set-Cookie", serializeMemberSessionCookie(memberToken, options.request));
  }
  return response;
}

/** Canonical admin-session claims/cookie adapter shared by magic-link and passkey authentication. */
export async function createAdminSessionEstablishedResponse(options: {
  secret: string;
  request: Request;
  admin: UserBackedAuthAdmin;
  sessionId: string;
  expiresAt: string;
  state?: string | null;
}): Promise<Response> {
  return createIdentitySessionEstablishedResponse({
    secret: options.secret,
    request: options.request,
    body: adminSessionEstablishedResponseSchema.parse({
      success: true,
      expiresAt: options.expiresAt,
      admin: publicAuthAdmin(options.admin),
    }),
    admin: options,
  });
}

/** Canonical member-session claims/cookie adapter shared by magic-link and passkey authentication. */
export async function createMemberSessionEstablishedResponse(options: {
  secret: string;
  request: Request;
  member: AuthMember;
  sessionId: string;
  expiresAt: string;
}): Promise<Response> {
  return createIdentitySessionEstablishedResponse({
    secret: options.secret,
    request: options.request,
    body: { success: true, expiresAt: options.expiresAt, member: options.member },
    member: options,
  });
}

interface SessionVerificationResult {
  ok: boolean;
  claims?: { sid: string };
}

export interface SessionLogoutPolicy {
  readCookie(request: Request): string | null;
  verify(secret: string, token: string): Promise<SessionVerificationResult>;
  revoke(db: DatabaseLike, sessionId: string): Promise<void>;
  serializeExpiredCookie(request: Request): string;
}

/** Revokes a valid cookie-backed session when possible and clears the persona cookie unconditionally. */
export async function logoutSession(c: AdminContext, policy: SessionLogoutPolicy): Promise<Response> {
  const token = policy.readCookie(c.req.raw);
  if (token) {
    const verified = await policy.verify(requireInternalSecret(c.env), token);
    if (verified.ok && verified.claims) {
      await policy.revoke(requestDb(c), verified.claims.sid);
    }
  }

  const response = jsonNoStore({ success: true });
  response.headers.append("Set-Cookie", policy.serializeExpiredCookie(c.req.raw));
  return response;
}
