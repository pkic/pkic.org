import type { UserBackedAuthAdmin } from "../../types";
import { hasPermission, permissionGrantAllows } from "../permissions";
import type { Permission } from "../../../../assets/shared/schemas/permissions";
import type { OauthAuthorizationScope } from "../../../../assets/shared/schemas/oauth-authorizations";

function compact(scopes: OauthAuthorizationScope[]): OauthAuthorizationScope[] {
  const global = new Set(
    scopes.filter((scope) => scope.contextType === null && scope.contextId === null).map((scope) => scope.permission),
  );
  return [
    ...new Map(
      scopes
        .filter((scope) => scope.contextType === null || !global.has(scope.permission))
        .map((scope) => [JSON.stringify([scope.permission, scope.contextType, scope.contextId]), scope]),
    ).values(),
  ];
}
/** Snapshot only selected permissions at their current resource boundaries. No later grant can add a boundary. */
export function delegablePermissionContexts(
  actor: UserBackedAuthAdmin,
  selected: readonly Permission[],
): OauthAuthorizationScope[] {
  const scopes: OauthAuthorizationScope[] = [];
  for (const permission of selected)
    for (const grant of actor.grants ?? []) {
      const context =
        grant.contextType && grant.contextId ? { type: grant.contextType, id: grant.contextId } : undefined;
      if ((grant.contextType === null) !== (grant.contextId === null)) continue;
      if (!permissionGrantAllows(grant, permission, context) || !hasPermission(actor, permission, context)) continue;
      scopes.push({
        permission,
        contextType: grant.contextType as OauthAuthorizationScope["contextType"],
        contextId: grant.contextId,
      });
    }
  return compact(scopes);
}
/** Intersect both dimensions: a current global grant cannot widen an approved contextual grant. */
export function effectiveMcpPermissionContexts(
  actor: UserBackedAuthAdmin,
  approved: readonly OauthAuthorizationScope[],
  selected: readonly Permission[],
): OauthAuthorizationScope[] {
  const allowed = new Set(selected),
    scopes: OauthAuthorizationScope[] = [];
  for (const ceiling of approved) {
    if (!allowed.has(ceiling.permission)) continue;
    if (ceiling.contextType && ceiling.contextId) {
      if (hasPermission(actor, ceiling.permission, { type: ceiling.contextType, id: ceiling.contextId }))
        scopes.push(ceiling);
    } else scopes.push(...delegablePermissionContexts(actor, [ceiling.permission]));
  }
  return compact(scopes);
}

/** The frozen permission/context tuple is also the exact live database requirement. */
export function oauthScopeRequirements(scopes: readonly OauthAuthorizationScope[]) {
  return scopes.map((scope) => ({
    permission: scope.permission,
    ...(scope.contextType && scope.contextId ? { context: { type: scope.contextType, id: scope.contextId } } : {}),
  }));
}
