import { getResourceGrantDefinition, type ResourceGrantCapability, type ResourceGrantKind } from "./definitions";

function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(", ");
}

/**
 * SQL predicate proving a group (referenced by `groupIdExpression`) may reach
 * a resource of the given kind (referenced by `resourceAlias`) at one of
 * `capabilities` — either as the active owning group, or through an active
 * grantee group's `${kind}_group_grants` row. Generalizes the shape
 * `votes/vote-access.ts`'s `voteGroupCapabilityPredicate` established for
 * votes so cross-group self-participation feeds for other resource kinds
 * (events, form placements, ...) share one definition instead of each
 * hand-rolling the owner/grant union again.
 */
export function groupResourceCapabilityPredicate<K extends ResourceGrantKind>(
  kind: K,
  resourceAlias: string,
  groupIdExpression: string,
  capabilities: readonly ResourceGrantCapability<K>[],
): string {
  const definition = getResourceGrantDefinition(kind);
  return `(
    (
      ${groupIdExpression} = ${resourceAlias}.${definition.ownerGroupColumn}
      AND EXISTS (
        SELECT 1 FROM groups active_owner_group
         WHERE active_owner_group.id = ${resourceAlias}.${definition.ownerGroupColumn}
           AND active_owner_group.active = 1
      )
    )
    OR EXISTS (
      SELECT 1
      FROM ${definition.grantTable} resource_grant
      JOIN groups granted_group ON granted_group.id = resource_grant.group_id AND granted_group.active = 1
      WHERE resource_grant.${definition.grantResourceColumn} = ${resourceAlias}.id
        AND resource_grant.group_id = ${groupIdExpression}
        AND resource_grant.capability IN (${quoted(capabilities)})
    )
  )`;
}
