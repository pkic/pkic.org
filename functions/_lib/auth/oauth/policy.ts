import type { Env } from "../../types";
export const MCP_PATH = "/api/v1/mcp";
export const MCP_OAUTH_AUTHORIZE_PATH = "/api/v1/auth/oauth/authorize";
export const MCP_OAUTH_TOKEN_PATH = "/api/v1/auth/oauth/token";
export const MCP_OAUTH_REGISTER_PATH = "/api/v1/auth/oauth/register";
function ttlSeconds(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
export function mcpOauthLifetimes(env: Env) {
  return {
    accessTokenTTL: ttlSeconds(env.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS, 3600),
    refreshTokenTTL: ttlSeconds(env.MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS, 8 * 3600),
  };
}
