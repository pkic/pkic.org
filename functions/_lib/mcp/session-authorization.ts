import { OAuthError } from "@cloudflare/workers-oauth-provider";
import { getCurrentUserBackedAdmin } from "../auth/admin";
import { AppError } from "../errors";
import type { Env } from "../types";
import { parseMcpOauthProps, type McpOAuthProps } from "./oauth";

/** OAuth refresh never extends the staff session that authorized the grant. */
export async function requireActiveMcpSession(env: Env, props: McpOAuthProps): Promise<number | null> {
  if (props.identityType === "service") return null;
  const admin = await getCurrentUserBackedAdmin(env.DB, props.id, props.sessionId);
  const expiresAt = Math.min(new Date(props.sessionExpiresAt).getTime(), new Date(admin?.expiresAt ?? "").getTime());
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
    return { accessTokenTTL: remainingSeconds === null ? accessTokenTTL : Math.min(accessTokenTTL, remainingSeconds) };
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
