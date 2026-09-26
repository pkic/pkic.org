import {
  OAuthError,
  type AuthRequest,
  type OAuthHelpers,
  type ResolveExternalTokenInput,
} from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import { permissionSchema } from "../../../assets/shared/schemas/permissions";
import { getCachedAdminAuthTransport, requireAdminFromRequest } from "../auth/admin";
import { resolveUserSessionFromRequest } from "../auth/user-session";
import { AUTH_SCOPES, grantableScopesForActor, type AuthScope } from "../auth/scopes";
import { getConfig, resolveAppBaseUrl } from "../config";
import { processOutboxByIdBackground } from "../email/outbox";
import { AppError } from "../errors";
import { getClientIp, getUserAgent, hashOptional, requireInternalSecret } from "../request";
import { enforceRateLimit } from "../rate-limit";
import { buildManagementLink } from "../services/management-links";
import { requestUserSignInLink } from "../services/user-auth-flow";
import type { AuthAdmin, Env, UserBackedAuthAdmin } from "../types";

export const MCP_OAUTH_AUTHORIZE_PATH = "/api/v1/auth/oauth/authorize";
export const MCP_OAUTH_TOKEN_PATH = "/api/v1/auth/oauth/token";
export const MCP_OAUTH_REGISTER_PATH = "/api/v1/auth/oauth/register";
const MCP_OAUTH_MAX_RETURN_TO_LENGTH = 2048;

const AUTH_SCOPE_SET = new Set<string>(AUTH_SCOPES);

const mcpOAuthPropsBaseSchema = {
  id: z.string().min(1),
  email: z.string().min(1),
  role: z.string().min(1),
  scopes: z.array(permissionSchema),
};

export const mcpOAuthPropsSchema = z.discriminatedUnion("identityType", [
  z
    .object({
      identityType: z.literal("user"),
      ...mcpOAuthPropsBaseSchema,
      sessionId: z.string().min(1),
      sessionExpiresAt: z.string().min(1),
      state: z.string().nullable(),
      authTransport: z.enum(["oauth", "bearer", "cookie"]),
    })
    .strict(),
  z
    .object({
      identityType: z.literal("service"),
      ...mcpOAuthPropsBaseSchema,
      authTransport: z.literal("api-key"),
    })
    .strict(),
]);

export type McpOAuthProps = z.infer<typeof mcpOAuthPropsSchema>;
export type McpUserOAuthProps = Extract<McpOAuthProps, { identityType: "user" }>;
export type McpServiceOAuthProps = Extract<McpOAuthProps, { identityType: "service" }>;
export type UserMcpOAuthTransport = McpUserOAuthProps["authTransport"];
export type McpOAuthTransport = McpOAuthProps["authTransport"];

export function parseMcpOauthProps(value: unknown): McpOAuthProps | undefined {
  if (value === undefined) return undefined;
  const parsed = mcpOAuthPropsSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(500, "MCP_AUTH_PROPS_INVALID", "The MCP authorization context is invalid");
  }
  return parsed.data;
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

export function isAuthScope(scope: string): scope is AuthScope {
  return AUTH_SCOPE_SET.has(scope);
}

export function normalizeMcpOauthScopes(
  scopes: readonly string[],
  fallback: readonly AuthScope[] = AUTH_SCOPES,
): AuthScope[] {
  const normalized = scopes.filter(isAuthScope);
  // An omitted scope list receives the documented default. A supplied but
  // wholly invalid list must not be promoted to every supported permission.
  return [...new Set(scopes.length === 0 ? fallback : normalized)];
}

export function buildMcpOauthProps(
  admin: AuthAdmin,
  scopes: readonly AuthScope[],
  authTransport: McpOAuthTransport,
): McpOAuthProps {
  const shared = { id: admin.id, email: admin.email, role: admin.role, scopes: [...scopes] };

  if (admin.identityType === "service") {
    if (authTransport !== "api-key") {
      throw new AppError(500, "MCP_AUTH_TRANSPORT_INVALID", "A service actor must use the API-key transport");
    }
    return { identityType: "service", ...shared, authTransport };
  }

  if (authTransport === "api-key" || !admin.sessionId || !admin.expiresAt) {
    throw new AppError(
      500,
      "MCP_AUTH_TRANSPORT_INVALID",
      "A user-backed MCP actor requires a session-backed transport",
    );
  }

  return {
    identityType: "user",
    ...shared,
    sessionId: admin.sessionId,
    sessionExpiresAt: admin.expiresAt,
    state: admin.state ?? null,
    authTransport,
  };
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
  return buildManagementLink(resolveAppBaseUrl(env, request), {
    kind: "mcp-oauth",
    returnTo: sanitizeAuthorizeReturnTo(returnTo),
    error,
  });
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
    const returnTo = `${url.pathname}${url.search}`;
    return returnTo.length <= MCP_OAUTH_MAX_RETURN_TO_LENGTH ? returnTo : MCP_OAUTH_AUTHORIZE_PATH;
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

export async function requireMcpOauthAdmin(request: Request, env: Env): Promise<UserBackedAuthAdmin | null> {
  try {
    return (await resolveUserSessionFromRequest(env.DB, request, env)).staff ?? null;
  } catch (error) {
    if (error instanceof AppError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}

export async function describeMcpAuthorization(
  request: Request,
  env: McpOAuthEnv,
  returnTo: string,
): Promise<{
  authenticated: boolean;
  authorized: boolean;
  returnTo: string;
  clientId: string;
  clientName: string;
  requestedScopes: AuthScope[];
  grantedScopes: AuthScope[];
  userEmail: string | null;
  staffEmail: string | null;
}> {
  const authRequest = await parseOauthRequestFromReturnTo(request, env.OAUTH_PROVIDER, returnTo);
  const clientInfo = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  const session = await resolveUserSessionFromRequest(env.DB, request, env).catch(() => null);
  const admin = session?.staff ?? null;
  const requestedScopes = normalizeMcpOauthScopes(authRequest.scope);
  const grantedScopes = admin ? grantedMcpOauthScopes(admin, requestedScopes) : [];

  return {
    authenticated: session !== null,
    authorized: admin !== null,
    returnTo,
    clientId: authRequest.clientId,
    clientName: clientInfo?.clientName ?? clientInfo?.clientId ?? authRequest.clientId,
    requestedScopes,
    grantedScopes,
    userEmail: session?.identity.email ?? null,
    staffEmail: admin?.email ?? null,
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
  const appBaseUrl = resolveAppBaseUrl(options.env, options.request);
  const result = await requestUserSignInLink(options.env.DB, {
    email: options.email,
    ipHash,
    userAgentHash,
    ttlMinutes: config.magicLinkTtlMinutes,
    signingSecret: secret,
    magicLinkBaseUrl: buildManagementLink(appBaseUrl, {
      kind: "mcp-oauth",
      returnTo: sanitizeAuthorizeReturnTo(options.returnTo),
    }),
  });

  if (!result.outboxId) {
    return;
  }

  options.executionCtx.waitUntil(processOutboxByIdBackground(options.env.DB, options.env, result.outboxId));
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

  if (error instanceof z.ZodError) {
    return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "Invalid OAuth request" } }, 400);
  }

  return jsonResponse({ error: { code: "OAUTH_ERROR", message: "Unexpected OAuth authorization error." } }, 500);
}
