import type { GroupLabel } from "../../../../assets/shared/schemas/groups";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { getGroup, requireGroupManagement } from "../groups";
import { getResourceGrantDefinition, type ResourceGrantCapability, type ResourceGrantKind } from "./definitions";
import type { ResourceGrantListQuery, ResourceGroupGrant } from "./types";

interface OwnedResourceRow {
  owner_group_id: string | null;
}

interface ResourceGroupGrantRow {
  group_id: string;
  group_slug: string;
  group_name: string;
  group_type_key: string;
  group_type_singular_label: string;
  group_type_plural_label: string;
  capability: string;
  created_by_user_id: string | null;
  created_at: string;
}

function mapGranteeGroup(row: ResourceGroupGrantRow): GroupLabel {
  return {
    id: row.group_id,
    slug: row.group_slug,
    name: row.group_name,
    type: {
      key: row.group_type_key,
      singularLabel: row.group_type_singular_label,
      pluralLabel: row.group_type_plural_label,
    },
  };
}

function mapGrant<K extends ResourceGrantKind>(row: ResourceGroupGrantRow): ResourceGroupGrant<K> {
  return {
    granteeGroup: mapGranteeGroup(row),
    capability: row.capability as ResourceGrantCapability<K>,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  };
}

/**
 * SQL identifiers come exclusively from the closed definition catalogue; all
 * request-controlled values remain bound parameters.
 */
export async function resolveOwnedResource<K extends ResourceGrantKind>(
  db: DatabaseLike,
  kind: K,
  ownerGroupIdOrSlug: string,
  resourceId: string,
  actor?: AuthAdmin,
): Promise<{ ownerGroupId: string }> {
  const definition = getResourceGrantDefinition(kind);
  const ownerGroup = await getGroup(db, ownerGroupIdOrSlug);
  if (!ownerGroup) throw new AppError(404, "GROUP_RESOURCE_NOT_FOUND", "Group-owned resource not found");
  const resource = await first<OwnedResourceRow>(
    db,
    `SELECT ${definition.ownerGroupColumn} AS owner_group_id
       FROM ${definition.resourceTable}
      WHERE id = ?`,
    [resourceId],
  );
  if (!resource || resource.owner_group_id !== ownerGroup.id) {
    throw new AppError(404, "GROUP_RESOURCE_NOT_FOUND", "Group-owned resource not found");
  }
  if (actor) await requireGroupManagement(db, actor, ownerGroup.id);
  return { ownerGroupId: ownerGroup.id };
}

const GRANT_COLUMNS = `grant_row.group_id, grantee.slug AS group_slug, grantee.name AS group_name,
  grantee.type_key AS group_type_key, group_type.singular_label AS group_type_singular_label,
  group_type.plural_label AS group_type_plural_label, grant_row.capability,
  grant_row.created_by_user_id, grant_row.created_at`;

export async function getResourceGroupGrant<K extends ResourceGrantKind>(
  db: DatabaseLike,
  kind: K,
  resourceId: string,
  granteeGroupId: string,
  capability: ResourceGrantCapability<K>,
): Promise<ResourceGroupGrant<K> | null> {
  const definition = getResourceGrantDefinition(kind);
  const row = await first<ResourceGroupGrantRow>(
    db,
    `SELECT ${GRANT_COLUMNS}
       FROM ${definition.grantTable} grant_row
       JOIN groups grantee ON grantee.id = grant_row.group_id
       JOIN group_types group_type ON group_type.key = grantee.type_key
      WHERE grant_row.${definition.grantResourceColumn} = ?
        AND grant_row.group_id = ? AND grant_row.capability = ?`,
    [resourceId, granteeGroupId, capability],
  );
  return row ? mapGrant<K>(row) : null;
}

export async function listResourceGroupGrants<K extends ResourceGrantKind>(
  db: DatabaseLike,
  actor: AuthAdmin,
  ownerGroupIdOrSlug: string,
  kind: K,
  resourceId: string,
  query: ResourceGrantListQuery<K>,
): Promise<{ grants: ResourceGroupGrant<K>[]; total: number }> {
  const definition = getResourceGrantDefinition(kind);
  await resolveOwnedResource(db, kind, ownerGroupIdOrSlug, resourceId, actor);
  const conditions = [`grant_row.${definition.grantResourceColumn} = ?`];
  const bindings: unknown[] = [resourceId];
  if (query.granteeGroupId) {
    conditions.push("grant_row.group_id = ?");
    bindings.push(query.granteeGroupId);
  }
  if (query.capability) {
    conditions.push("grant_row.capability = ?");
    bindings.push(query.capability);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["grantee.name", "grantee.slug", "grant_row.capability"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const page = await queryPage<ResourceGroupGrantRow>(db, {
    source: {
      selectSql: `SELECT ${GRANT_COLUMNS}`,
      fromSql: `FROM ${definition.grantTable} grant_row
        JOIN groups grantee ON grantee.id = grant_row.group_id
        JOIN group_types group_type ON group_type.key = grantee.type_key
        WHERE ${conditions.join(" AND ")}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { group: "grantee.name COLLATE NOCASE", capability: "grant_row.capability", created_at: "grant_row.created_at" },
      "grantee.name COLLATE NOCASE ASC",
      "grant_row.group_id ASC, grant_row.capability ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return { grants: page.rows.map(mapGrant<K>), total: page.total };
}
