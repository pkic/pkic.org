import { ownedIdentityLifecycleSql } from "../../services/identities/selection";
import { activeUserCapacityDefinitions } from "../../services/membership/capacity-query";

/** Aliases are trusted source names, never request input. Identity eligibility shares the canonical capacity query. */
export function oauthAuthorizationIdentitySql(alias: string): string {
  return `(${alias}.identity_id IS NULL OR EXISTS(SELECT 1 FROM identities frozen_identity
    WHERE frozen_identity.id=${alias}.identity_id AND frozen_identity.user_id=${alias}.user_id
      AND ${ownedIdentityLifecycleSql("frozen_identity", null)}))
    AND (${alias}.member_id IS NULL OR EXISTS(WITH ${activeUserCapacityDefinitions(`SELECT ${alias}.user_id`)}
    SELECT 1 FROM active_user_capacities WHERE identity_id=${alias}.identity_id AND member_id=${alias}.member_id))`;
}
export function activeOauthAuthorizationSql(alias: string): string {
  return `${alias}.status='active' AND ${alias}.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND ${oauthAuthorizationIdentitySql(alias)}`;
}
/** One requirement's ceiling; the live role/direct-grant requirement is enforced separately in the same D1 command. */
export function oauthPermissionCeilingSql(authorizationAlias: string, requirementAlias: string): string {
  return `EXISTS(SELECT 1 FROM oauth_authorization_permissions ceiling
    WHERE ceiling.authorization_id=${authorizationAlias}.id
      AND (ceiling.permission=${requirementAlias}.permission OR
        (${requirementAlias}.scanner_legacy_compatible=1 AND ceiling.permission='agenda:scan'))
      AND ((ceiling.context_type IS NULL AND ceiling.context_id IS NULL) OR
        (${requirementAlias}.context_type IS NOT NULL AND ceiling.context_type=${requirementAlias}.context_type
          AND ceiling.context_id=${requirementAlias}.context_id)))`;
}
