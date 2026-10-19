import { OAUTH_AUTHORIZATION_MAX_CONTEXTS } from "../../../../assets/shared/oauth-authorization-policy";
import { oauthAuthorizationScopesSchema } from "../../../../assets/shared/schemas/oauth-authorizations";
import { first, all } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { userSessionAuthorizationEvidence } from "../identity-capacities";
import { activeOauthAuthorizationSql } from "./authorization-ceiling-query";

/** A persisted ceiling is necessary for every OAuth-issued credential; legacy unbounded grants reconnect. */
export async function readActiveOauthAuthorization(
  db: DatabaseLike,
  input: { id: string; userId: string; sessionId: string; clientId?: string },
) {
  const session = userSessionAuthorizationEvidence(input.userId, input.sessionId);
  const row = await first<{
    id: string;
    client_id: string;
    identity_id: string | null;
    member_id: string | null;
    expires_at: string;
  }>(
    db,
    `SELECT authorization.id,authorization.client_id,authorization.identity_id,authorization.expires_at,
      authorization.member_id
      FROM oauth_authorizations authorization WHERE authorization.id=? AND authorization.user_id=?
        AND authorization.session_id=? AND ${activeOauthAuthorizationSql("authorization")}
        AND EXISTS(${session.sql})`,
    [input.id, input.userId, input.sessionId, ...session.bindings],
  );
  if (!row || (input.clientId !== undefined && row.client_id !== input.clientId))
    throw new AppError(401, "MCP_AUTHORIZATION_INACTIVE", "Authorize the MCP client again");
  const scopes = oauthAuthorizationScopesSchema.parse(
    await all<{ permission: string; contextType: string | null; contextId: string | null }>(
      db,
      `SELECT permission,context_type AS contextType,context_id AS contextId FROM oauth_authorization_permissions
      WHERE authorization_id=? ORDER BY permission,context_type,context_id LIMIT ?`,
      [row.id, OAUTH_AUTHORIZATION_MAX_CONTEXTS + 1],
    ),
  );
  if (!scopes.length) throw new AppError(401, "MCP_AUTHORIZATION_INACTIVE", "Authorize the MCP client again");
  return {
    id: row.id,
    clientId: row.client_id,
    identityId: row.identity_id,
    memberId: row.member_id,
    expiresAt: row.expires_at,
    scopes,
  };
}
