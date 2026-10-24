import {
  OAuthError,
  GrantType,
  type TokenExchangeCallbackOptions,
  type TokenExchangeCallbackResult,
} from "@cloudflare/workers-oauth-provider";
import { prepareCurrentUserBackedAdmin } from "../admin";
import { signMcpSessionToken } from "../mcp-session";
import { AppError } from "../../errors";
import type { Env } from "../../types";
import { parseMcpOauthProps, type McpOAuthProps } from "./props";
import { prepareActiveOauthAuthorization } from "./authorization-ceiling";
import { mcpOauthLifetimes } from "./policy";
import { effectiveMcpPermissionContexts } from "./grantable-permissions";

/** Frozen session deadlines and approved resource limits both cap live authority. */
export async function resolveActiveMcpSession(env: Env, props: McpOAuthProps, clientId?: string) {
  if (props.identityType === "service") return { remainingSeconds: null, scopes: props.scopes };
  const idleExpiresAt = Date.parse(props.sessionIdleExpiresAt);
  if (!Number.isFinite(idleExpiresAt) || idleExpiresAt <= Date.now())
    throw new AppError(401, "AUTH_EXPIRED", "Your MCP authorization session expired. Sign in again.");
  const authorizationRead =
    props.authTransport === "oauth"
      ? prepareActiveOauthAuthorization(env.DB, {
          id: props.authorizationId,
          userId: props.id,
          sessionId: props.sessionId,
          clientId,
        })
      : null;
  const adminRead = prepareCurrentUserBackedAdmin(
    env.DB,
    props.id,
    props.sessionId,
    props.authTransport === "oauth" ? { authorizationId: props.authorizationId } : null,
  );
  const loaded = await env.DB.batch([...(authorizationRead?.statements ?? []), ...adminRead.statements]);
  const authorization = authorizationRead?.decode(loaded.slice(0, authorizationRead.statements.length));
  const admin = adminRead.decode(loaded.slice(authorizationRead?.statements.length ?? 0));

  const expiresAt = Math.min(
    Date.parse(props.sessionExpiresAt),
    idleExpiresAt,
    Date.parse(admin?.expiresAt ?? ""),
    authorization ? Date.parse(authorization.expiresAt) : Infinity,
  );
  const remainingSeconds = Math.floor(expiresAt / 1000) - Math.floor(Date.now() / 1000);
  if (!admin || !Number.isFinite(remainingSeconds) || remainingSeconds <= 0)
    throw new AppError(401, "AUTH_EXPIRED", "Your MCP authorization session expired. Sign in again.");
  const scopes = authorization
    ? [
        ...new Set(
          effectiveMcpPermissionContexts(admin, authorization.scopes, props.scopes).map((scope) => scope.permission),
        ),
      ]
    : props.scopes;
  if (authorization && !scopes.length)
    throw new AppError(401, "MCP_AUTHORIZATION_INACTIVE", "Authorize the MCP client again");
  return { remainingSeconds, scopes };
}
export async function mcpTokenLifetime(
  env: Env,
  value: unknown,
  accessTokenTTL: number,
  exchange?: Pick<TokenExchangeCallbackOptions, "clientId" | "userId" | "requestedScope" | "grantType">,
): Promise<TokenExchangeCallbackResult> {
  try {
    const props = parseMcpOauthProps(value);
    if (!props) throw new AppError(401, "AUTH_INVALID", "Missing MCP authorization");
    if (props.identityType === "user" && props.authTransport === "oauth" && (!exchange || exchange.userId !== props.id))
      throw new AppError(401, "MCP_AUTHORIZATION_INACTIVE", "Authorize the MCP client again");
    const active = await resolveActiveMcpSession(env, props, exchange?.clientId);
    const ttl = active.remainingSeconds === null ? accessTokenTTL : Math.min(accessTokenTTL, active.remainingSeconds);
    // KV never receives a minimum TTL rounded past the signed authorization deadline.
    if (ttl < 60) throw new AppError(401, "AUTH_EXPIRED", "Your MCP authorization session expired. Sign in again.");
    if (props.identityType === "user" && props.authTransport === "oauth") {
      const scopes = active.scopes.filter((scope) => exchange!.requestedScope.includes(scope));
      if (!scopes.length) throw new AppError(401, "MCP_AUTHORIZATION_INACTIVE", "Authorize the MCP client again");
      return {
        accessTokenTTL: ttl,
        ...(exchange!.grantType === GrantType.AUTHORIZATION_CODE
          ? { refreshTokenTTL: Math.min(mcpOauthLifetimes(env).refreshTokenTTL, active.remainingSeconds!) }
          : {}),
        accessTokenScope: scopes,
        newProps: { ...props, scopes },
      };
    }
    return { accessTokenTTL: ttl };
  } catch (error) {
    if (error instanceof AppError && error.status === 401)
      throw new OAuthError("invalid_grant", {
        description: "Your MCP authorization is no longer active. Authorize the client again.",
      });
    throw error;
  }
}
export function mcpAuthenticationError(request: Request, error: unknown): Response | null {
  if (!(error instanceof AppError) || error.status !== 401) return null;
  const resourceMetadata = new URL(
    `/.well-known/oauth-protected-resource${new URL(request.url).pathname}`,
    request.url,
  ).toString();
  return Response.json(
    {
      error: "invalid_token",
      error_description: "Your MCP authorization is no longer active. Authorize the client again.",
    },
    {
      status: 401,
      headers: {
        "www-authenticate": `Bearer resource_metadata="${resourceMetadata}", error="invalid_token"`,
        "cache-control": "no-store",
      },
    },
  );
}
export async function authorizationHeaderForMcp(
  request: Request,
  env: Env,
  oauthProps?: McpOAuthProps,
): Promise<string | null> {
  if (!oauthProps || oauthProps.identityType === "service") return request.headers.get("authorization");
  const active = await resolveActiveMcpSession(env, oauthProps);
  if (!env.INTERNAL_SIGNING_SECRET) return null;
  const token = await signMcpSessionToken(env.INTERNAL_SIGNING_SECRET, {
    sub: oauthProps.id,
    sid: oauthProps.sessionId,
    exp: Math.floor(Date.now() / 1000) + active.remainingSeconds!,
    email: oauthProps.email,
    state: oauthProps.state ?? undefined,
    scopes: active.scopes,
    ...(oauthProps.authTransport === "oauth" ? { authorizationId: oauthProps.authorizationId } : {}),
  });
  return `Bearer ${token}`;
}

/** The API operation composes the live grant with its own resource batch. Frozen deadlines still bound its credential. */
export async function deferredAuthorizationHeaderForMcp(request: Request, env: Env, props?: McpOAuthProps) {
  if (!props || props.identityType === "service") return request.headers.get("authorization");
  const expiry = Math.min(Date.parse(props.sessionExpiresAt), Date.parse(props.sessionIdleExpiresAt));
  if (!Number.isFinite(expiry) || expiry <= Date.now())
    throw new AppError(401, "AUTH_EXPIRED", "Your MCP authorization session expired. Sign in again.");
  if (!env.INTERNAL_SIGNING_SECRET)
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  return `Bearer ${await signMcpSessionToken(env.INTERNAL_SIGNING_SECRET, { sub: props.id, sid: props.sessionId, exp: Math.floor(expiry / 1000), email: props.email, state: props.state ?? undefined, scopes: props.scopes, ...(props.authTransport === "oauth" ? { authorizationId: props.authorizationId } : {}) })}`;
}
