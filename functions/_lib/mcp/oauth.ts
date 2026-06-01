import {
  OAuthError,
  type AuthRequest,
  type OAuthHelpers,
  type ResolveExternalTokenInput,
} from "@cloudflare/workers-oauth-provider";
import {
  getAdminBySessionClaims,
  getCachedAdminAuthTransport,
  requestAdminMagicLink,
  requireAdminFromRequest,
  signAdminSessionToken,
  verifyAdminMagicLink,
  verifyAdminSessionToken,
} from "../auth/admin";
import { first, run } from "../db/queries";
import { AUTH_SCOPES, grantableScopesForActor, type AuthScope } from "../auth/scopes";
import { getConfig, resolveAppBaseUrl } from "../config";
import { processOutboxByIdBackground, queueEmail } from "../email/outbox";
import { AppError } from "../errors";
import { getClientIp, getUserAgent, hashOptional, requireInternalSecret } from "../request";
import { enforceRateLimit } from "../rate-limit";
import { writeAuditLog } from "../services/audit";
import { sha256Hex } from "../utils/crypto";
import type { AuthAdmin, Env } from "../types";

export const MCP_OAUTH_AUTHORIZE_PATH = "/api/v1/oauth/authorize";
export const MCP_OAUTH_VERIFY_API_PATH = "/api/v1/oauth/verify-link";
export const MCP_OAUTH_TOKEN_PATH = "/api/v1/oauth/token";
export const MCP_OAUTH_REGISTER_PATH = "/api/v1/oauth/register";
export const MCP_OAUTH_UI_PATH = "/admin/";

const MCP_OAUTH_LOGIN_COOKIE_NAME = "pkic_mcp_oauth";
const MCP_OAUTH_LOGIN_COOKIE_PATH = MCP_OAUTH_AUTHORIZE_PATH;
const MCP_OAUTH_LOGIN_COOKIE_MAX_AGE_SECONDS = 10 * 60;

const AUTH_SCOPE_SET = new Set<string>(AUTH_SCOPES);

export type McpOAuthTransport = "oauth" | "bearer" | "cookie" | "api-key";

export interface McpOAuthProps {
  adminId: string;
  email: string;
  role: string;
  scopes: AuthScope[];
  sessionId?: string;
  sessionExpiresAt?: string;
  state?: string | null;
  authTransport: McpOAuthTransport;
}

export type McpOAuthEnv = Env & {
  OAUTH_PROVIDER: OAuthHelpers;
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json;charset=UTF-8" },
  });
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

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function getMcpOauthLoginToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (!cookieHeader) return null;
  return parseCookieHeader(cookieHeader).get(MCP_OAUTH_LOGIN_COOKIE_NAME) ?? null;
}

async function storeMcpOauthReturnTo(env: Env, magicLinkToken: string, returnTo: string): Promise<void> {
  const tokenHash = await sha256Hex(magicLinkToken);
  const storedReturnTo = sanitizeAuthorizeReturnTo(returnTo);
  await run(env.DB, "UPDATE auth_magic_links SET return_to = ? WHERE token_hash = ?", [storedReturnTo, tokenHash]);
}

async function consumeMcpOauthReturnTo(env: Env, magicLinkToken: string): Promise<string> {
  const tokenHash = await sha256Hex(magicLinkToken);
  const row = await first<{ return_to: string | null }>(
    env.DB,
    `SELECT return_to
     FROM auth_magic_links
     WHERE token_hash = ?`,
    [tokenHash],
  );

  if (!row?.return_to) {
    throw new AppError(400, "MCP_OAUTH_RETURN_TO_MISSING", "Missing OAuth return target");
  }

  return sanitizeAuthorizeReturnTo(row.return_to);
}

export function isAuthScope(scope: string): scope is AuthScope {
  return AUTH_SCOPE_SET.has(scope);
}

export function normalizeMcpOauthScopes(
  scopes: readonly string[],
  fallback: readonly AuthScope[] = AUTH_SCOPES,
): AuthScope[] {
  const normalized = scopes.filter(isAuthScope);
  return [...new Set(normalized.length > 0 ? normalized : fallback)];
}

export function buildMcpOauthProps(
  admin: AuthAdmin,
  scopes: readonly AuthScope[],
  authTransport: McpOAuthTransport,
): McpOAuthProps {
  return {
    adminId: admin.id,
    email: admin.email,
    role: admin.role,
    scopes: [...scopes],
    sessionId: admin.sessionId,
    sessionExpiresAt: admin.expiresAt,
    state: admin.state ?? null,
    authTransport,
  };
}

export function serializeMcpOauthLoginCookie(token: string, request: Request): string {
  const parts = [
    `${MCP_OAUTH_LOGIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${MCP_OAUTH_LOGIN_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${MCP_OAUTH_LOGIN_COOKIE_MAX_AGE_SECONDS}`,
  ];

  if (isSecureRequest(request)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function serializeExpiredMcpOauthLoginCookie(request: Request): string {
  const parts = [
    `${MCP_OAUTH_LOGIN_COOKIE_NAME}=`,
    `Path=${MCP_OAUTH_LOGIN_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];

  if (isSecureRequest(request)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function currentAuthorizeReturnTo(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

export function resolveAuthorizeReturnTo(request: Request): string {
  const requested = new URL(request.url).searchParams.get("return_to");
  return requested ? sanitizeAuthorizeReturnTo(requested) : currentAuthorizeReturnTo(request);
}

export function wantsJsonResponse(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

export function buildMcpOauthUiUrl(
  env: Pick<Env, "APP_BASE_URL">,
  request: Request,
  returnTo: string,
  error?: string,
): string {
  const url = new URL(MCP_OAUTH_UI_PATH, resolveAppBaseUrl(env, request));
  url.searchParams.set("flow", "mcp-oauth");
  url.searchParams.set("return_to", sanitizeAuthorizeReturnTo(returnTo));
  if (error) {
    url.searchParams.set("error", error);
  }
  return url.toString();
}

export function redirectToMcpOauthUi(
  env: Pick<Env, "APP_BASE_URL">,
  request: Request,
  returnTo: string,
  error?: string,
): Response {
  return Response.redirect(buildMcpOauthUiUrl(env, request, returnTo, error), 302);
}

export function sanitizeAuthorizeReturnTo(value: string | null | undefined): string {
  if (!value) return MCP_OAUTH_AUTHORIZE_PATH;

  try {
    const url = new URL(value, "https://pkic.local");
    if (url.origin !== "https://pkic.local") return MCP_OAUTH_AUTHORIZE_PATH;
    if (url.pathname !== MCP_OAUTH_AUTHORIZE_PATH) return MCP_OAUTH_AUTHORIZE_PATH;
    return `${url.pathname}${url.search}`;
  } catch {
    return MCP_OAUTH_AUTHORIZE_PATH;
  }
}

export async function parseOauthRequestFromReturnTo(
  request: Request,
  oauthProvider: OAuthHelpers,
  returnTo: string,
): Promise<AuthRequest> {
  const url = new URL(returnTo, request.url);
  return oauthProvider.parseAuthRequest(new Request(url, { method: "GET", headers: request.headers }));
}

export async function requireMcpOauthAdmin(request: Request, env: Env): Promise<AuthAdmin | null> {
  const token = getMcpOauthLoginToken(request);
  if (!token || !env.INTERNAL_SIGNING_SECRET) {
    return null;
  }

  const verified = await verifyAdminSessionToken(env.INTERNAL_SIGNING_SECRET, token);
  if (!verified.ok) {
    return null;
  }

  try {
    return await getAdminBySessionClaims(env.DB, verified.claims);
  } catch {
    return null;
  }
}

export async function describeMcpAuthorization(
  request: Request,
  env: McpOAuthEnv,
  returnTo: string,
): Promise<{
  authenticated: boolean;
  returnTo: string;
  clientId: string;
  clientName: string;
  requestedScopes: AuthScope[];
  grantedScopes: AuthScope[];
  adminEmail: string | null;
}> {
  const authRequest = await parseOauthRequestFromReturnTo(request, env.OAUTH_PROVIDER, returnTo);
  const clientInfo = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  const admin = await requireMcpOauthAdmin(request, env);
  const requestedScopes = normalizeMcpOauthScopes(authRequest.scope);
  const grantedScopes = admin ? grantedMcpOauthScopes(admin, requestedScopes) : [];

  return {
    authenticated: admin !== null,
    returnTo,
    clientId: authRequest.clientId,
    clientName: clientInfo?.clientName ?? clientInfo?.clientId ?? authRequest.clientId,
    requestedScopes,
    grantedScopes,
    adminEmail: admin?.email ?? null,
  };
}

export async function resolveMcpExternalToken({
  token,
  request,
  env,
}: ResolveExternalTokenInput): Promise<{ props: McpOAuthProps } | null> {
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  const authRequest = new Request(request, { headers });

  try {
    const admin = await requireAdminFromRequest(env.DB as Env["DB"], authRequest, env as Env);
    const transport = getCachedAdminAuthTransport(authRequest) ?? "bearer";
    return {
      props: buildMcpOauthProps(admin, normalizeMcpOauthScopes(admin.scopes ?? []), transport),
    };
  } catch {
    return null;
  }
}

export function redirectAuthorizationDenied(authRequest: AuthRequest): Response {
  const redirectUrl = new URL(authRequest.redirectUri);
  redirectUrl.searchParams.set("error", "access_denied");
  redirectUrl.searchParams.set("error_description", "The user denied the authorization request.");
  redirectUrl.searchParams.set("state", authRequest.state);
  return Response.redirect(redirectUrl.toString(), 302);
}

export async function sendMcpAuthorizeMagicLink(options: {
  request: Request;
  env: Env;
  executionCtx: ExecutionContext;
  email: string;
  returnTo: string;
}): Promise<void> {
  const secret = requireInternalSecret(options.env);
  const clientIp = getClientIp(options.request);
  await enforceRateLimit({
    binding: options.env.EMAIL_RATE_LIMITER,
    namespace: "mcp-authorize-request-link:email",
    key: options.email,
  });
  await enforceRateLimit({
    binding: options.env.IP_RATE_LIMITER,
    namespace: "mcp-authorize-request-link:ip",
    key: clientIp,
  });

  const config = getConfig(options.env, options.request);
  const [ipHash, userAgentHash] = await Promise.all([
    hashOptional(clientIp, secret),
    hashOptional(getUserAgent(options.request), secret),
  ]);
  const magic = await requestAdminMagicLink(options.env.DB, {
    email: options.email,
    ipHash,
    userAgentHash,
    ttlMinutes: config.magicLinkTtlMinutes,
  });

  if (!magic.token || !magic.admin) {
    return;
  }

  const appBaseUrl = resolveAppBaseUrl(options.env, options.request);
  await storeMcpOauthReturnTo(options.env, magic.token, options.returnTo);
  const magicLinkUrl = `${appBaseUrl}${MCP_OAUTH_UI_PATH}?flow=mcp-oauth&token=${encodeURIComponent(magic.token)}`;
  const outboxId = await queueEmail(options.env.DB, {
    templateKey: "admin_magic_link",
    recipientEmail: magic.admin.email,
    recipientUserId: null,
    eventId: null,
    messageType: "transactional",
    subject: "Your PKI Consortium admin sign-in link",
    data: {
      email: magic.admin.email,
      magicLinkUrl,
      expiresInMinutes: config.magicLinkTtlMinutes,
    },
  });

  await processOutboxByIdBackground(options.env.DB, options.env, outboxId);
  await writeAuditLog(
    options.env.DB,
    "admin",
    magic.admin.id,
    "admin_magic_link_requested",
    "admin_user",
    magic.admin.id,
    {
      email: magic.admin.email,
      channel: "mcp_oauth",
    },
  );
}

export async function verifyMcpAuthorizeMagicLink(
  request: Request,
  env: Env,
): Promise<{ admin: AuthAdmin; sessionToken: string; expiresAt: string; returnTo: string }> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    throw new AppError(400, "MAGIC_LINK_INVALID", "Missing admin magic link token");
  }

  const secret = requireInternalSecret(env);
  const [ipHash, userAgentHash] = await Promise.all([
    hashOptional(getClientIp(request), secret),
    hashOptional(getUserAgent(request), secret),
  ]);
  const verified = await verifyAdminMagicLink(env.DB, {
    token,
    sessionTtlHours: 8,
    ipHash,
    userAgentHash,
  });

  const admin: AuthAdmin = {
    ...verified.admin,
    scopes: [...AUTH_SCOPES],
    sessionId: verified.sessionId,
    expiresAt: verified.expiresAt,
  };
  const sessionToken = await signAdminSessionToken(secret, {
    admin,
    sessionId: verified.sessionId,
    expiresAt: verified.expiresAt,
    scopes: [...AUTH_SCOPES],
  });
  await writeAuditLog(env.DB, "admin", verified.admin.id, "admin_magic_link_verified", "admin_session", null, {
    expiresAt: verified.expiresAt,
    channel: "mcp_oauth",
  });

  return {
    admin,
    sessionToken,
    expiresAt: verified.expiresAt,
    returnTo: await consumeMcpOauthReturnTo(env, token),
  };
}

export function grantedMcpOauthScopes(admin: AuthAdmin, requestedScopes: readonly AuthScope[]): AuthScope[] {
  return grantableScopesForActor(admin, requestedScopes);
}

export function toOAuthErrorResponse(error: unknown): Response {
  if (error instanceof OAuthError) {
    return jsonResponse({ error: { code: error.code, message: error.description } }, error.statusCode);
  }

  if (error instanceof AppError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
  }

  return jsonResponse({ error: { code: "OAUTH_ERROR", message: "Unexpected OAuth authorization error." } }, 500);
}
