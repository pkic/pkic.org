import type { DatabaseLike } from "../../types";
import { guardUserSessionDatabase, type OwnAccount } from "../../auth/member";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import { nextIsoRevision } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import {
  oauthAuthorizationSchema,
  type OauthAuthorizationReduction,
} from "../../../../assets/shared/schemas/oauth-authorizations";
import { getOwnedOauthAuthorization } from "./read-model";

function changed() {
  return new AppError(409, "OAUTH_AUTHORIZATION_CHANGED", "This authorization changed. Reload it and try again.");
}
/** Only removal is expressible; a new or broader context always requires a new approval. */
export async function reduceOauthAuthorization(
  db: DatabaseLike,
  account: OwnAccount,
  id: string,
  input: OauthAuthorizationReduction,
) {
  db = guardUserSessionDatabase(db, account);
  const existing = await getOwnedOauthAuthorization(db, account.userId, id);
  if (existing.revision !== input.revision || existing.status !== "active") throw changed();
  const at = nextIsoRevision(existing.revision),
    removed = JSON.stringify(input.remove);
  try {
    await db.batch([
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM json_each(?) requested
      WHERE NOT EXISTS(SELECT 1 FROM oauth_authorization_permissions scope WHERE scope.authorization_id=?
        AND scope.permission=json_extract(requested.value,'$.permission')
        AND scope.context_type IS json_extract(requested.value,'$.contextType')
        AND scope.context_id IS json_extract(requested.value,'$.contextId')))`,
        bindings: [removed, id],
      }),
      db
        .prepare(`UPDATE oauth_authorizations SET updated_at=? WHERE id=? AND user_id=? AND updated_at=? AND status='active'
      AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
        .bind(at, id, account.userId, input.revision),
      prepareAuditLogAfterOneChange(
        db,
        "user",
        account.userId,
        "oauth_authorization_reduced",
        "oauth_authorization",
        id,
        { removed: input.remove },
        at,
      ),
      db
        .prepare(`DELETE FROM oauth_authorization_permissions WHERE authorization_id=? AND EXISTS(SELECT 1 FROM json_each(?) requested
      WHERE permission=json_extract(requested.value,'$.permission') AND context_type IS json_extract(requested.value,'$.contextType')
        AND context_id IS json_extract(requested.value,'$.contextId'))`)
        .bind(id, removed),
      db
        .prepare(`UPDATE oauth_authorizations SET status='revoked' WHERE id=? AND NOT EXISTS(
      SELECT 1 FROM oauth_authorization_permissions WHERE authorization_id=?)`)
        .bind(id, id),
      db
        .prepare(`UPDATE oauth_authorization_completions SET redirect_ciphertext=NULL WHERE authorization_id=?
      AND EXISTS(SELECT 1 FROM oauth_authorizations WHERE id=? AND status='revoked')`)
        .bind(id, id),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error) || isAuthorizationGuardFailure(error)) throw changed();
    throw error;
  }
  return { authorization: oauthAuthorizationSchema.parse(await getOwnedOauthAuthorization(db, account.userId, id)) };
}
export async function revokeOauthAuthorization(db: DatabaseLike, account: OwnAccount, id: string, revision: string) {
  db = guardUserSessionDatabase(db, account);
  const existing = await getOwnedOauthAuthorization(db, account.userId, id);
  if (existing.revision !== revision) throw changed();
  if (existing.rawStatus === "revoked") return { authorization: oauthAuthorizationSchema.parse(existing) };
  const at = nextIsoRevision(existing.revision);
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE oauth_authorizations SET status='revoked',updated_at=? WHERE id=? AND user_id=? AND updated_at=?`,
        )
        .bind(at, id, account.userId, revision),
      prepareAuditLogAfterOneChange(
        db,
        "user",
        account.userId,
        "oauth_authorization_revoked",
        "oauth_authorization",
        id,
        {},
        at,
      ),
      db
        .prepare(`UPDATE oauth_authorization_completions SET status='failed',request_ciphertext=NULL,redirect_ciphertext=NULL,
      processing_token=NULL,lease_expires_at=NULL,last_error_code='REVOKED',updated_at=? WHERE authorization_id=?`)
        .bind(at, id),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error) || isAuthorizationGuardFailure(error)) throw changed();
    throw error;
  }
  return { authorization: oauthAuthorizationSchema.parse(await getOwnedOauthAuthorization(db, account.userId, id)) };
}
