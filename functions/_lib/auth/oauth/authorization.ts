import {
  OAuthError,
  type AuthRequest,
  type OAuthHelpers,
  type ResolveExternalTokenInput,
} from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import { mcpOauthContextSchema } from "../../../../assets/shared/schemas/mcp-oauth";
import { getCachedAdminAuthTransport, requireAdminFromRequest } from "../admin";
import { resolveUserSessionFromRequest, type UserSessionResult } from "../user-session";
import { normalizeMcpOauthScopes, type AuthScope } from "../scopes";
import { getConfig, resolveAppBaseUrl } from "../../config";
import { processOutboxByIdBackground } from "../../email/outbox";
import { handleError } from "../../http";
import { oauthClientDisplayName } from "../../../../assets/shared/oauth-authorization-policy";
import { AppError } from "../../errors";
import { getClientIp, getUserAgent, hashOptional, requireInternalSecret } from "../../request";
import { enforceRateLimit } from "../../rate-limit";
import { buildManagementLink } from "../../services/management-links";
import { requestUserSignInLink } from "../../services/user-auth-flow";
import type { AuthAdmin, Env } from "../../types";

import { permissionAreas } from "../../../../assets/shared/permission-metadata";
import { delegablePermissionContexts } from "./grantable-permissions";
import { MCP_OAUTH_AUTHORIZE_PATH } from "./policy";
export { isAuthScope, normalizeMcpOauthScopes } from "../scopes";
export { MCP_OAUTH_AUTHORIZE_PATH, MCP_OAUTH_TOKEN_PATH, MCP_OAUTH_REGISTER_PATH } from "./policy";
const MCP_OAUTH_MAX_RETURN_TO_LENGTH = 2048;

import { buildMcpOauthProps, type McpOAuthProps } from "./props";
export {
  buildMcpOauthProps,
  parseMcpOauthProps,
  type McpOAuthProps,
  type McpUserOAuthProps,
  type McpServiceOAuthProps,
  type UserMcpOAuthTransport,
  type McpOAuthTransport,
} from "./props";

export type McpOAuthEnv = Env & {
  OAUTH_PROVIDER: OAuthHelpers;
};

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

export async function resolveMcpOauthSession(request: Request, env: Env): Promise<UserSessionResult | null> {
  try {
    return await resolveUserSessionFromRequest(env.DB, request, env);
  } catch (error) {
    if (error instanceof AppError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}

export async function describeMcpAuthorization(
  request: Request,
  env: McpOAuthEnv,
  returnTo: string,
): Promise<z.infer<typeof mcpOauthContextSchema>> {
  const authRequest = await parseOauthRequestFromReturnTo(request, env.OAUTH_PROVIDER, returnTo);
  const clientInfo = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  const session = await resolveMcpOauthSession(request, env);
  const admin = session?.staff ?? null;
  const requestedScopes = normalizeMcpOauthScopes(authRequest.scope);
  const grantedScopes = admin ? grantedMcpOauthScopes(admin, requestedScopes) : [];

  return {
    authenticated: session !== null,
    authorized: admin !== null,
    returnTo,
    clientId: authRequest.clientId,
    clientName: oauthClientDisplayName(clientInfo?.clientName, authRequest.clientId),
    requestedScopes,
    grantedScopes,
    userEmail: session?.identity.email ?? null,
    staffEmail: admin?.email ?? null,
    actingIdentityId: session?.actingIdentityId ?? null,
    redirectHost: new URL(authRequest.redirectUri).host,
    areas: permissionAreas(grantedScopes).map((area) => ({
      ...area,
      permissions: area.permissions.map((item) => {
        const limits = admin?.identityType === "user" ? delegablePermissionContexts(admin, [item.permission]) : [];
        return {
          ...item,
          allResources: limits.some((limit) => limit.contextType === null),
          resourceCount: new Set(
            limits
              .filter((limit) => limit.contextType !== null)
              .map((limit) => JSON.stringify([limit.contextType, limit.contextId])),
          ).size,
        };
      }),
    })),
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
    const session = admin.identityType === "user" ? await resolveMcpOauthSession(authRequest, env as Env) : null;
    if (admin.identityType === "user" && !session?.staff) return null;
    return {
      props: buildMcpOauthProps(
        admin,
        normalizeMcpOauthScopes(admin.scopes ?? []),
        transport,
        session?.staffIdleExpiresAt,
      ),
    };
  } catch (error) {
    if (error instanceof AppError && (error.status === 401 || error.status === 403)) return null;
    throw error;
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
  if (admin.identityType !== "user") return [];
  const contexts = delegablePermissionContexts(admin, requestedScopes);
  return requestedScopes.filter((scope) => contexts.some((context) => context.permission === scope));
}

export function toOAuthErrorResponse(error: unknown): Response {
  if (error instanceof OAuthError) {
    return handleError(new AppError(error.statusCode, error.code, error.description));
  }

  if (error instanceof AppError) {
    return handleError(error);
  }

  if (error instanceof z.ZodError) {
    return handleError(new AppError(400, "VALIDATION_ERROR", "Invalid OAuth request", error.flatten()));
  }

  return handleError(new AppError(500, "OAUTH_ERROR", "Unexpected OAuth authorization error."));
}
