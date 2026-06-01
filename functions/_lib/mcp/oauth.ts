import {
  OAuthError,
  type AuthRequest,
  type ClientInfo,
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
import { AUTH_SCOPES, grantableScopesForActor, type AuthScope } from "../auth/scopes";
import { getConfig, resolveAppBaseUrl } from "../config";
import { processOutboxByIdBackground, queueEmail } from "../email/outbox";
import { AppError } from "../errors";
import { getClientIp, getUserAgent, hashOptional, requireInternalSecret } from "../request";
import { enforceRateLimit } from "../rate-limit";
import { writeAuditLog } from "../services/audit";
import type { AuthAdmin, Env } from "../types";

export const MCP_OAUTH_AUTHORIZE_PATH = "/api/v1/oauth/authorize";
export const MCP_OAUTH_AUTHORIZE_VERIFY_PATH = "/api/v1/oauth/authorize/verify";
export const MCP_OAUTH_TOKEN_PATH = "/api/v1/oauth/token";
export const MCP_OAUTH_REGISTER_PATH = "/api/v1/oauth/register";

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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlResponse(title: string, body: string, status = 200): Response {
  return new Response(
    [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<title>${escapeHtml(title)}</title>`,
      "</head>",
      "<body>",
      `<main><h1>${escapeHtml(title)}</h1>${body}</main>`,
      "</body>",
      "</html>",
    ].join(""),
    {
      status,
      headers: { "content-type": "text/html; charset=UTF-8" },
    },
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

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function getMcpOauthLoginToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (!cookieHeader) return null;
  return parseCookieHeader(cookieHeader).get(MCP_OAUTH_LOGIN_COOKIE_NAME) ?? null;
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

export function renderMcpAuthorizeLoginPage(options: {
  clientInfo: ClientInfo | null;
  returnTo: string;
  sentTo?: string | null;
  error?: string | null;
}): Response {
  const clientName = options.clientInfo?.clientName ?? options.clientInfo?.clientId ?? "the MCP client";
  const pieces = [
    `<p>Sign in as an active PKI Consortium admin to authorize ${escapeHtml(clientName)}.</p>`,
    options.error ? `<p>${escapeHtml(options.error)}</p>` : "",
    options.sentTo
      ? `<p>If ${escapeHtml(options.sentTo)} belongs to an active admin, a sign-in link has been emailed.</p>`
      : "",
    `<form method="post" action="${MCP_OAUTH_AUTHORIZE_PATH}">`,
    '<input type="hidden" name="action" value="request-link">',
    `<input type="hidden" name="return_to" value="${escapeHtml(options.returnTo)}">`,
    '<p><label>Email <input type="email" name="email" autocomplete="email" required></label></p>',
    '<p><button type="submit">Email sign-in link</button></p>',
    "</form>",
  ];

  return htmlResponse("Authorize MCP Access", pieces.join(""));
}

export function renderMcpAuthorizeConsentPage(options: {
  admin: AuthAdmin;
  clientInfo: ClientInfo | null;
  requestedScopes: readonly AuthScope[];
  grantedScopes: readonly AuthScope[];
  returnTo: string;
}): Response {
  const clientName = options.clientInfo?.clientName ?? options.clientInfo?.clientId ?? "the MCP client";
  const requested = options.requestedScopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("");
  const granted = options.grantedScopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join("");
  const downscoped =
    options.grantedScopes.length !== options.requestedScopes.length
      ? "<p>The grant will be limited to the scopes listed below.</p>"
      : "";

  const pieces = [
    `<p>Signed in as ${escapeHtml(options.admin.email)}.</p>`,
    `<p>${escapeHtml(clientName)} is requesting access to the PKI Consortium MCP server.</p>`,
    requested ? `<h2>Requested scopes</h2><ul>${requested}</ul>` : "",
    downscoped,
    granted ? `<h2>Granted scopes</h2><ul>${granted}</ul>` : "<p>No scopes can be granted for this request.</p>",
    `<form method="post" action="${MCP_OAUTH_AUTHORIZE_PATH}">`,
    '<input type="hidden" name="action" value="approve">',
    `<input type="hidden" name="return_to" value="${escapeHtml(options.returnTo)}">`,
    '<p><button type="submit">Approve</button></p>',
    "</form>",
    `<form method="post" action="${MCP_OAUTH_AUTHORIZE_PATH}">`,
    '<input type="hidden" name="action" value="deny">',
    `<input type="hidden" name="return_to" value="${escapeHtml(options.returnTo)}">`,
    '<p><button type="submit">Deny</button></p>',
    "</form>",
  ];

  return htmlResponse("Approve MCP Access", pieces.join(""));
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
  const magicLinkUrl = `${appBaseUrl}${MCP_OAUTH_AUTHORIZE_VERIFY_PATH}?token=${encodeURIComponent(magic.token)}&return_to=${encodeURIComponent(options.returnTo)}`;
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

  options.executionCtx.waitUntil(processOutboxByIdBackground(options.env.DB, options.env, outboxId));
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
): Promise<{ response: Response; admin: AuthAdmin }> {
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

  const returnTo = sanitizeAuthorizeReturnTo(new URL(request.url).searchParams.get("return_to"));
  const response = Response.redirect(new URL(returnTo, request.url).toString(), 302);
  response.headers.append("Set-Cookie", serializeMcpOauthLoginCookie(sessionToken, request));
  return { response, admin };
}

export function grantedMcpOauthScopes(admin: AuthAdmin, requestedScopes: readonly AuthScope[]): AuthScope[] {
  return grantableScopesForActor(admin, requestedScopes);
}

export function toOAuthErrorResponse(error: unknown): Response {
  if (error instanceof OAuthError) {
    return htmlResponse(error.code, `<p>${escapeHtml(error.description)}</p>`, error.statusCode);
  }

  if (error instanceof AppError) {
    return htmlResponse(error.message, `<p>${escapeHtml(error.message)}</p>`, error.status);
  }

  return htmlResponse("OAuth Error", "<p>Unexpected OAuth authorization error.</p>", 500);
}
