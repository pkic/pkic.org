import {
  GROUP_FORMS_SORT_COLUMNS,
  groupFormDefinitionResponseSchema,
  groupFormPlacementSummarySchema,
  type GroupFormPlacementSummary,
  type GroupFormsListQuery,
} from "../../../../assets/shared/schemas/group-forms";
import type { FormGroupCapability } from "../../../../assets/shared/schemas/resource-grants";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import {
  buildLiveAccessibleGroupResourceIdsCte,
  effectiveResourceCapabilitiesForContext,
  getResourceGrantDefinition,
  isResourceGrantCapability,
  liveGroupResourceContextAccess,
  type GroupResourceViewer,
} from "../resource-grants";
import { getFormDefinitionByPlacement } from "./read";

export type GroupFormViewer = GroupResourceViewer;

interface GroupFormPlacementRow {
  form_id: string;
  form_key: string;
  form_purpose: GroupFormPlacementSummary["form"]["purpose"];
  form_status: GroupFormPlacementSummary["form"]["status"];
  form_title: string;
  form_description: string | null;
  form_updated_at: string;
  placement_id: string;
  owner_group_id: string | null;
  context_type: GroupFormPlacementSummary["placement"]["contextType"];
  context_ref: string | null;
  audience: string;
  active: number;
  opens_at: string | null;
  closes_at: string | null;
  placement_created_at: string;
  placement_updated_at: string;
  accepting_responses: number;
  granted_capabilities: string | null;
  member_access: number;
  manager_access: number;
}

function grantedCapabilities(row: Pick<GroupFormPlacementRow, "granted_capabilities">): FormGroupCapability[] {
  const definition = getResourceGrantDefinition("formPlacement");
  return (row.granted_capabilities?.split(",") ?? []).filter((capability): capability is FormGroupCapability =>
    isResourceGrantCapability(definition, capability),
  );
}

function mapGroupFormPlacement(row: GroupFormPlacementRow, groupId: string): GroupFormPlacementSummary {
  const definition = getResourceGrantDefinition("formPlacement");
  return groupFormPlacementSummarySchema.parse({
    form: {
      id: row.form_id,
      key: row.form_key,
      purpose: row.form_purpose,
      status: row.form_status,
      title: row.form_title,
      description: row.form_description,
      updatedAt: row.form_updated_at,
    },
    placement: {
      id: row.placement_id,
      formId: row.form_id,
      ownerGroupId: row.owner_group_id,
      contextType: row.context_type,
      contextRef: row.context_ref,
      audience: row.audience,
      active: row.active === 1,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
      createdAt: row.placement_created_at,
      updatedAt: row.placement_updated_at,
    },
    capabilities: effectiveResourceCapabilitiesForContext(definition, {
      owner: row.owner_group_id === groupId,
      member: row.member_access === 1,
      manager: row.manager_access === 1,
      grantedCapabilities: grantedCapabilities(row),
    }),
    acceptingResponses: row.accepting_responses === 1,
  });
}

const FORM_PLACEMENT_SELECT = `SELECT
  form.id AS form_id, form.key AS form_key, form.purpose AS form_purpose,
  form.status AS form_status, form.title AS form_title,
  form.description AS form_description, form.updated_at AS form_updated_at,
  placement.id AS placement_id, placement.owner_group_id, placement.context_type,
  placement.context_ref, placement.audience, placement.active, placement.opens_at,
  placement.closes_at, placement.created_at AS placement_created_at,
  placement.updated_at AS placement_updated_at,
  CASE WHEN form.status = 'active' AND placement.active = 1
         AND (placement.opens_at IS NULL OR unixepoch(placement.opens_at) <= unixepoch())
         AND (placement.closes_at IS NULL OR unixepoch(placement.closes_at) > unixepoch())
       THEN 1 ELSE 0 END AS accepting_responses,
  GROUP_CONCAT(DISTINCT grant_row.capability) AS granted_capabilities`;

export async function listGroupFormPlacements(
  db: DatabaseLike,
  viewer: GroupFormViewer,
  groupId: string,
  query: GroupFormsListQuery,
): Promise<{ forms: GroupFormPlacementSummary[]; total: number }> {
  const accessiblePlacements = buildLiveAccessibleGroupResourceIdsCte(
    "formPlacement",
    groupId,
    liveGroupResourceContextAccess(viewer, groupId),
    "view_definition",
  );
  const conditions = ["placement.active = ?"];
  const bindings: unknown[] = [...accessiblePlacements.bindings, groupId, query.active === "true" ? 1 : 0];
  if (query.purpose) {
    conditions.push("form.purpose = ?");
    bindings.push(query.purpose);
  }
  if (query.status) {
    conditions.push("form.status = ?");
    bindings.push(query.status);
  }
  if (query.contextType) {
    conditions.push("placement.context_type = ?");
    bindings.push(query.contextType);
  }
  if (query.audience) {
    conditions.push("placement.audience = ?");
    bindings.push(query.audience);
  }
  const search = query.q
    ? buildD1TextSearchFilter(query.q, [
        "form.key",
        "form.title",
        "form.description",
        "placement.audience",
        "placement.context_ref",
      ])
    : null;
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const sql = `WITH ${accessiblePlacements.sql}
    ${FORM_PLACEMENT_SELECT}, group_access.member_access, group_access.manager_access
    FROM accessible_resource accessible
    JOIN form_placements placement ON placement.id = accessible.resource_id
    JOIN forms form ON form.id = placement.form_id
    CROSS JOIN group_access
    LEFT JOIN form_placement_group_grants grant_row
      ON grant_row.placement_id = placement.id AND grant_row.group_id = ?
    WHERE ${conditions.join(" AND ")}
    GROUP BY placement.id`;
  const page = await queryPage<GroupFormPlacementRow>(db, {
    sql,
    bindings,
    orderBy: resolveMappedOrderBy(
      query.sort,
      {
        title: "form_title COLLATE NOCASE",
        purpose: "form_purpose",
        audience: "audience COLLATE NOCASE",
        opens_at: "opens_at",
        created_at: "placement_created_at",
      } satisfies Record<(typeof GROUP_FORMS_SORT_COLUMNS)[number], string>,
      "form_title COLLATE NOCASE ASC",
      "placement_id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return { forms: page.rows.map((row) => mapGroupFormPlacement(row, groupId)), total: page.total };
}

export async function getGroupFormDefinition(
  db: DatabaseLike,
  viewer: GroupFormViewer,
  groupId: string,
  placementId: string,
) {
  const accessiblePlacements = buildLiveAccessibleGroupResourceIdsCte(
    "formPlacement",
    groupId,
    liveGroupResourceContextAccess(viewer, groupId),
    "view_definition",
  );
  const row = await first<GroupFormPlacementRow>(
    db,
    `WITH ${accessiblePlacements.sql}
     ${FORM_PLACEMENT_SELECT}, group_access.member_access, group_access.manager_access
       FROM accessible_resource accessible
       JOIN form_placements placement ON placement.id = accessible.resource_id
       JOIN forms form ON form.id = placement.form_id
       CROSS JOIN group_access
       LEFT JOIN form_placement_group_grants grant_row
         ON grant_row.placement_id = placement.id AND grant_row.group_id = ?
      WHERE placement.id = ?
      GROUP BY placement.id`,
    [...accessiblePlacements.bindings, groupId, placementId],
  );
  if (!row) throw new AppError(404, "FORM_NOT_FOUND", "The form is not available through this group");
  const summary = mapGroupFormPlacement(row, groupId);
  const definition = await getFormDefinitionByPlacement(db, placementId);
  if (!definition) throw new AppError(404, "FORM_NOT_FOUND", "The form is not available through this group");
  return groupFormDefinitionResponseSchema.parse({ ...summary, fields: definition.fields });
}
