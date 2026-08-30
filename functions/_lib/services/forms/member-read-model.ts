/**
 * Cross-group self-participation projection for the sign-in dashboard: every
 * currently open form placement the caller may submit — through owner-group
 * membership or a `form_placement_group_grants` `submit` grant to a group
 * they belong to — evaluated as one set-based D1 query rather than a query
 * per group. Mirrors the access predicates `group-placement-read.ts`'s
 * `listGroupFormPlacements` applies for a single group.
 */
import { memberFormPlacementSchema, type MemberFormPlacement } from "../../../../assets/shared/schemas/member-forms";
import type { OffsetPageQuery } from "../../db/pagination";
import { queryPage } from "../../db/pagination";
import { getResourceGrantDefinition, memberResourceGrantCapabilitiesFor } from "../resource-grants";
import type { DatabaseLike } from "../../types";

const FORM_GRANT_DEFINITION = getResourceGrantDefinition("formPlacement");
const FORM_SUBMIT_CAPABILITIES = memberResourceGrantCapabilitiesFor(FORM_GRANT_DEFINITION, "submit");

export interface MemberFormPlacementsQuery {
  limit: number;
  offset: number;
}

interface MemberFormPlacementRow {
  placement_id: string;
  form_id: string;
  title: string;
  purpose: string;
  owner_group_id: string;
  owner_group_name: string;
  opens_at: string | null;
  closes_at: string | null;
  accepting_responses: number;
  has_submitted: number;
}

function toMemberFormPlacement(row: MemberFormPlacementRow): MemberFormPlacement {
  return memberFormPlacementSchema.parse({
    placementId: row.placement_id,
    formId: row.form_id,
    title: row.title,
    purpose: row.purpose,
    ownerGroupId: row.owner_group_id,
    ownerGroupName: row.owner_group_name,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    acceptingResponses: row.accepting_responses === 1,
    hasSubmitted: row.has_submitted === 1,
  });
}

const ACCEPTING_RESPONSES_SQL = `form.status = 'active' AND placement.active = 1
  AND (placement.opens_at IS NULL OR unixepoch(placement.opens_at) <= unixepoch())
  AND (placement.closes_at IS NULL OR unixepoch(placement.closes_at) > unixepoch())`;

/** Canonical page/count query, also used by the D1 EXPLAIN plan regression test. */
export function buildMemberFormPlacementsPageQuery(userId: string, query: MemberFormPlacementsQuery): OffsetPageQuery {
  const grantPlaceholders = FORM_SUBMIT_CAPABILITIES.map(() => "?").join(", ");
  const sql = `WITH member_groups AS (
      SELECT group_id FROM group_memberships WHERE user_id = ? AND left_at IS NULL
    ),
    accessible_placement(placement_id) AS (
      SELECT owned.id
        FROM form_placements owned INDEXED BY idx_form_placements_owner_active
        JOIN member_groups member_group ON member_group.group_id = owned.owner_group_id
        JOIN groups owner_group ON owner_group.id = owned.owner_group_id AND owner_group.active = 1
       WHERE owned.active = 1
      UNION
      SELECT shared.placement_id
        FROM form_placement_group_grants shared INDEXED BY idx_form_placement_group_grants_group
        JOIN member_groups member_group ON member_group.group_id = shared.group_id
        JOIN groups granted_group ON granted_group.id = shared.group_id AND granted_group.active = 1
       WHERE shared.capability IN (${grantPlaceholders})
    )
    SELECT placement.id AS placement_id, form.id AS form_id, form.title AS title, form.purpose AS purpose,
           placement.owner_group_id AS owner_group_id, owner_group.name AS owner_group_name,
           placement.opens_at, placement.closes_at,
           CASE WHEN ${ACCEPTING_RESPONSES_SQL} THEN 1 ELSE 0 END AS accepting_responses,
           CASE WHEN EXISTS (
                  SELECT 1 FROM form_submissions submission INDEXED BY idx_form_submissions_placement_status
                   WHERE submission.form_id = form.id
                     AND submission.placement_id = placement.id
                     AND submission.submitted_by_user_id = ?
                     AND submission.status = 'submitted'
                ) THEN 1 ELSE 0 END AS has_submitted
      FROM accessible_placement accessible
      JOIN form_placements placement ON placement.id = accessible.placement_id
      JOIN forms form ON form.id = placement.form_id
      JOIN groups owner_group ON owner_group.id = placement.owner_group_id
     WHERE ${ACCEPTING_RESPONSES_SQL}`;
  return {
    sql,
    bindings: [userId, ...FORM_SUBMIT_CAPABILITIES, userId],
    orderBy: "ORDER BY placement.closes_at IS NULL, placement.closes_at ASC, placement.id ASC",
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listOpenFormPlacementsForMember(
  db: DatabaseLike,
  userId: string,
  query: MemberFormPlacementsQuery,
): Promise<{ forms: MemberFormPlacement[]; total: number }> {
  const { rows, total } = await queryPage<MemberFormPlacementRow>(
    db,
    buildMemberFormPlacementsPageQuery(userId, query),
  );
  return { forms: rows.map(toMemberFormPlacement), total };
}
