import { OAuthError } from "@cloudflare/workers-oauth-provider";
import { getCurrentUserBackedAdmin } from "../admin";
import { signMcpSessionToken } from "../mcp-session";
import { AppError } from "../../errors";
import type { Env } from "../../types";
import { parseMcpOauthProps, type McpOAuthProps } from "./authorization";

/** OAuth refresh never extends the grant's signed authorization deadline. */
export async function requireActiveMcpSession(env: Env, props: McpOAuthProps): Promise<number | null> {
  if (props.identityType === "service") return null;
  const idleExpiresAt = Date.parse(props.sessionIdleExpiresAt);
  if (!Number.isFinite(idleExpiresAt) || idleExpiresAt <= Date.now()) {
    // This snapshot bounds the grant. Portal activity can extend its own
    // signed idle deadline, so grant expiry must not revoke the shared session.
    throw new AppError(401, "AUTH_EXPIRED", "Your MCP authorization session expired. Sign in again.");
  }
  const admin = await getCurrentUserBackedAdmin(env.DB, props.id, props.sessionId);
  const expiresAt = Math.min(Date.parse(props.sessionExpiresAt), idleExpiresAt, Date.parse(admin?.expiresAt ?? ""));
  const remainingSeconds = Math.floor(expiresAt / 1000) - Math.floor(Date.now() / 1000);
  if (!admin || !Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
    throw new AppError(401, "AUTH_EXPIRED", "Your MCP authorization session expired. Sign in again.");
  }
  return remainingSeconds;
}

export async function mcpTokenLifetime(
  env: Env,
  value: unknown,
  accessTokenTTL: number,
): Promise<{ accessTokenTTL: number }> {
  try {
    const props = parseMcpOauthProps(value);
    if (!props) throw new AppError(401, "AUTH_INVALID", "Missing MCP authorization");
    const remainingSeconds = await requireActiveMcpSession(env, props);
    const ttl = remainingSeconds === null ? accessTokenTTL : Math.min(accessTokenTTL, remainingSeconds);
    // Cloudflare KV rejects expirationTtl below 60 seconds. Never round up
    // beyond the signed session deadline to satisfy that storage minimum.
    if (ttl < 60) {
      throw new AppError(401, "AUTH_EXPIRED", "Your MCP authorization session expired. Sign in again.");
    }
    return { accessTokenTTL: ttl };
  } catch (error) {
    if (error instanceof AppError && error.status === 401) {
      throw new OAuthError("invalid_grant", { description: "Your MCP authorization session expired. Sign in again." });
    }
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
    { error: "invalid_token", error_description: "Your MCP authorization session expired. Sign in again." },
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
  if (!oauthProps) {
    return request.headers.get("authorization");
  }

  if (oauthProps.identityType === "service") {
    return request.headers.get("authorization");
  }

  const remainingSeconds = await requireActiveMcpSession(env, oauthProps);

  if (!env.INTERNAL_SIGNING_SECRET) {
    return null;
  }

  const token = await signMcpSessionToken(env.INTERNAL_SIGNING_SECRET, {
    sub: oauthProps.id,
    sid: oauthProps.sessionId,
    exp: Math.floor(Date.now() / 1000) + remainingSeconds!,
    email: oauthProps.email,
    state: oauthProps.state ?? undefined,
    scopes: oauthProps.scopes,
  });

  return `Bearer ${token}`;
}
