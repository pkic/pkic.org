import { userContextGrantSelection, anyPermissionAuthorizationEvidenceFromSelection } from "../auth/permissions";
import type { PreparedAdminRead } from "../auth/admin";

/** A delegated client remains active only while at least one selected, approved context is still granted. */
export function mcpExecutionAuthorizationEvidence(actor: PreparedAdminRead) {
  const live = userContextGrantSelection(actor.subjectId, actor.memberSelection);
  const selected = JSON.stringify(actor.permissionActor.scopes ?? []);
  const authorizationId = actor.permissionActor.oauthAuthorizationId;
  const requirements = authorizationId
    ? {
        sql: `WITH live AS MATERIALIZED(${live.sql}) SELECT approved.permission,COALESCE(approved.context_type,live.context_type) AS context_type,COALESCE(approved.context_id,live.context_id) AS context_id FROM oauth_authorization_permissions approved CROSS JOIN live WHERE approved.authorization_id=? AND approved.permission IN(SELECT value FROM json_each(?))`,
        bindings: [...live.bindings, authorizationId, selected],
      }
    : {
        sql: `WITH live AS MATERIALIZED(${live.sql}) SELECT selected.value AS permission,live.context_type,live.context_id FROM json_each(?) selected CROSS JOIN live`,
        bindings: [...live.bindings, selected],
      };
  const permission = anyPermissionAuthorizationEvidenceFromSelection(
    actor.permissionActor,
    actor.permissionActor.scopes ?? [],
    requirements,
    actor.memberSelection,
  );
  return {
    sql: `WITH authenticated AS MATERIALIZED(${actor.authorizationEvidence.sql}), permitted AS MATERIALIZED(${permission.sql}) SELECT 1 FROM authenticated,permitted LIMIT 1`,
    bindings: [...actor.authorizationEvidence.bindings, ...permission.bindings],
  };
}
