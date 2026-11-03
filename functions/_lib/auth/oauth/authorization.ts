import {
  OAuthError,
  AuthorizationError,
  authorizationErrorRedirect,
  type AuthRequest,
  type OAuthHelpers,
  type ResolveExternalTokenInput,
} from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import { mcpOauthContextSchema } from "../../../../assets/shared/schemas/mcp-oauth";
import { getCachedAdminAuthTransport, requireAdminFromRequest } from "../admin";
import { resolveUserSessionFromRequest, type UserSessionResult } from "../user-session";
import { normalizeMcpOauthScopes, type AuthScope } from "../scopes";
import { handleError } from "../../http";
import { oauthClientDisplayName } from "../../../../assets/shared/oauth-authorization-policy";
import { AppError } from "../../errors";
import { buildManagementLink } from "../../services/management-links";
import type { AuthAdmin, Env } from "../../types";

import { resolveAppBaseUrl } from "../../config";
import { permissionAreas } from "../../../../assets/shared/permission-metadata";
import { delegablePermissionContexts } from "./grantable-permissions";
import { MCP_PATH, MCP_OAUTH_AUTHORIZE_PATH } from "./policy";
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
  OAUTH_KV: KVNamespace;
};

export function currentAuthorizeReturnTo(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

export function wantsJsonResponse(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("application/json");
}

export function buildMcpOauthUiUrl(env: Pick<Env, "APP_BASE_URL">, request: Request, requestId: string): string {
  return buildManagementLink(resolveAppBaseUrl(env, request), {
    kind: "mcp-oauth",
    requestId,
  });
}

export function redirectToMcpOauthUi(env: Pick<Env, "APP_BASE_URL">, request: Request, requestId: string): Response {
  return Response.redirect(buildMcpOauthUiUrl(env, request, requestId), 302);
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
}: ResolveExternalTokenInput<Env>): Promise<{ props: McpOAuthProps; audience: string } | null> {
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  const authRequest = new Request(request, { headers });

  try {
    const admin = await requireAdminFromRequest(env.DB as Env["DB"], authRequest, env as Env);
    const transport = getCachedAdminAuthTransport(authRequest) ?? "bearer";
    const session = admin.identityType === "user" ? await resolveMcpOauthSession(authRequest, env as Env) : null;
    if (admin.identityType === "user" && !session?.staff) return null;
    return {
      audience: new URL(MCP_PATH, resolveAppBaseUrl(env, request)).toString(),
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
  return Response.redirect(
    authorizationErrorRedirect(authRequest, "access_denied", "The user denied the authorization request."),
    302,
  );
}

export function grantedMcpOauthScopes(admin: AuthAdmin, requestedScopes: readonly AuthScope[]): AuthScope[] {
  if (admin.identityType !== "user") return [];
  const contexts = delegablePermissionContexts(admin, requestedScopes);
  return requestedScopes.filter((scope) => contexts.some((context) => context.permission === scope));
}

export function toOAuthErrorResponse(error: unknown): Response {
  if (error instanceof AuthorizationError) return handleError(new AppError(400, error.code, error.description));
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
