/** Bounds for one explicit MCP authorization, separate from the user's live permissions. */
export const OAUTH_AUTHORIZATION_MAX_CONTEXTS = 512;
export const OAUTH_COMPLETION_WINDOW_MS = 10 * 60 * 1000;
export const OAUTH_COMPLETION_MAX_ATTEMPTS = 5;
export const OAUTH_COMPLETION_POLL_MS = 1000;
export const OAUTH_AUTHORIZATION_STATUSES = ["pending", "active", "revoked", "failed", "expired"] as const;

export const OAUTH_CLIENT_NAME_MAX_LENGTH = 200;
export function oauthClientDisplayName(name: string | undefined, clientId: string): string {
  return (name?.trim() || clientId).slice(0, OAUTH_CLIENT_NAME_MAX_LENGTH);
}
