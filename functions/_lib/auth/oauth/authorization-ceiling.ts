import { OAUTH_AUTHORIZATION_MAX_CONTEXTS } from "../../../../assets/shared/oauth-authorization-policy";
import { oauthAuthorizationScopesSchema } from "../../../../assets/shared/schemas/oauth-authorizations";
import { batchFirst, batchRows } from "../../db/pagination";
import type { D1StatementResult } from "../../types";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { userSessionAuthorizationEvidence } from "../identity-capacities";
import { activeOauthAuthorizationSql } from "./authorization-ceiling-query";

/** A persisted ceiling is necessary for every OAuth-issued credential; legacy unbounded grants reconnect. */
export function prepareActiveOauthAuthorization(
  db: DatabaseLike,
  input: { id: string; userId: string; sessionId: string; clientId?: string },
) {
  const session = userSessionAuthorizationEvidence(input.userId, input.sessionId);
  return {
    statements: [
      db
        .prepare(
          `SELECT authorization.id,authorization.client_id,authorization.identity_id,authorization.expires_at,authorization.member_id FROM oauth_authorizations authorization WHERE authorization.id=? AND authorization.user_id=? AND authorization.session_id=? AND ${activeOauthAuthorizationSql("authorization")} AND EXISTS(${session.sql})`,
        )
        .bind(input.id, input.userId, input.sessionId, ...session.bindings),
      db
        .prepare(
          "SELECT permission,context_type AS contextType,context_id AS contextId FROM oauth_authorization_permissions WHERE authorization_id=? ORDER BY permission,context_type,context_id LIMIT ?",
        )
        .bind(input.id, OAUTH_AUTHORIZATION_MAX_CONTEXTS + 1),
    ],
    decode(loaded: D1StatementResult[]) {
      const row = batchFirst<{
        id: string;
        client_id: string;
        identity_id: string | null;
        member_id: string | null;
        expires_at: string;
      }>(loaded[0]);
      if (!row || (input.clientId !== undefined && row.client_id !== input.clientId))
        throw new AppError(401, "MCP_AUTHORIZATION_INACTIVE", "Authorize the MCP client again");
      const scopes = oauthAuthorizationScopesSchema.parse(batchRows(loaded[1]));
      if (!scopes.length) throw new AppError(401, "MCP_AUTHORIZATION_INACTIVE", "Authorize the MCP client again");
      return {
        id: row.id,
        clientId: row.client_id,
        identityId: row.identity_id,
        memberId: row.member_id,
        expiresAt: row.expires_at,
        scopes,
      };
    },
  };
}
export async function readActiveOauthAuthorization(
  db: DatabaseLike,
  input: { id: string; userId: string; sessionId: string; clientId?: string },
) {
  const read = prepareActiveOauthAuthorization(db, input);
  return read.decode(await db.batch(read.statements));
}
