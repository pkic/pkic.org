import { oauthScopeRequirements } from "../../auth/oauth/grantable-permissions";
import { all, first } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { getCurrentUserBackedAdmin } from "../../auth/admin";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { oauthAuthorizationIdentitySql } from "../../auth/oauth/authorization-ceiling-query";
import { oauthAuthorizationScopesSchema } from "../../../../assets/shared/schemas/oauth-authorizations";
import { OAUTH_AUTHORIZATION_MAX_CONTEXTS } from "../../../../assets/shared/oauth-authorization-policy";
import { AppError } from "../../errors";
import type { OauthCompletionPayload } from "./completion-payload";

export interface ClaimedOauthCompletion {
  id: string;
  userId: string;
  sessionId: string;
  identityId: string | null;
  memberId: string | null;
  clientId: string;
  clientName: string;
  revision: string;
  expiresAt: string;
  requestCiphertext: string | null;
  attempts: number;
  attemptUntil: string;
}
export async function readClaimedOauthCompletion(db: DatabaseLike, id: string, token: string) {
  return first<ClaimedOauthCompletion>(
    db,
    `SELECT authorization.id,authorization.user_id AS userId,
    authorization.session_id AS sessionId,authorization.identity_id AS identityId,
    authorization.client_id AS clientId,authorization.client_name AS clientName,authorization.updated_at AS revision,
    authorization.expires_at AS expiresAt,completion.request_ciphertext AS requestCiphertext,
    completion.attempts,completion.attempt_until AS attemptUntil,
    authorization.member_id AS memberId
    FROM oauth_authorization_completions completion JOIN oauth_authorizations authorization ON authorization.id=completion.authorization_id
    WHERE completion.authorization_id=? AND completion.status='processing' AND completion.processing_token=?`,
    [id, token],
  );
}
export async function completionAuthority(
  db: DatabaseLike,
  row: ClaimedOauthCompletion,
  payload: OauthCompletionPayload,
) {
  const expiry = Math.min(
    Date.parse(row.expiresAt),
    Date.parse(row.attemptUntil),
    Date.parse(payload.props.sessionIdleExpiresAt),
    Date.parse(payload.props.sessionExpiresAt),
  );
  if (
    payload.props.id !== row.userId ||
    payload.props.sessionId !== row.sessionId ||
    payload.request.clientId !== row.clientId ||
    !Number.isFinite(expiry) ||
    expiry <= Date.now()
  )
    throw new AppError(401, "MCP_AUTHORIZATION_INACTIVE", "Authorize the MCP client again");
  const actor = await getCurrentUserBackedAdmin(db, row.userId, row.sessionId, row.memberId);
  if (!actor) throw new AppError(401, "MCP_AUTHORIZATION_INACTIVE", "Authorize the MCP client again");
  const scopes = oauthAuthorizationScopesSchema.parse(
    await all(
      db,
      `SELECT permission,context_type AS contextType,context_id AS contextId
    FROM oauth_authorization_permissions WHERE authorization_id=? ORDER BY permission,context_type,context_id LIMIT ?`,
      [row.id, OAUTH_AUTHORIZATION_MAX_CONTEXTS + 1],
    ),
  );
  if (!scopes.length) throw new AppError(401, "MCP_AUTHORIZATION_INACTIVE", "Authorize the MCP client again");
  return { actor, scopes };
}
export function pendingOauthCompletionGuards(
  db: DatabaseLike,
  row: ClaimedOauthCompletion,
  token: string,
  actor: UserBackedAuthAdmin,
  scopes: Awaited<ReturnType<typeof completionAuthority>>["scopes"],
) {
  return [
    preparePermissionsAuthorizationGuard(db, actor, oauthScopeRequirements(scopes)),
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM oauth_authorizations authorization
    WHERE authorization.id=? AND authorization.user_id=? AND authorization.session_id=? AND authorization.client_id=?
      AND authorization.identity_id IS ? AND authorization.status='pending'
      AND authorization.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${oauthAuthorizationIdentitySql("authorization")}
      AND EXISTS(SELECT 1 FROM oauth_authorization_completions completion WHERE completion.authorization_id=authorization.id
        AND completion.status='processing' AND completion.processing_token=?
        AND completion.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
        AND completion.attempt_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      bindings: [row.id, row.userId, row.sessionId, row.clientId, row.identityId, token],
    }),
  ];
}
