/**
 * The groups an organization is represented in.
 *
 * One aggregate row per group: how many of the organization's representatives
 * hold an active capacity in it, and the window their capacities span. The
 * page groups; the count says `COUNT(DISTINCT g.id)` over the same source, so
 * the two cannot disagree and the count carries no aggregate projection.
 */
import {
  ORGANIZATION_GROUPS_SORT_COLUMNS,
  organizationGroupsListResponseSchema,
  type OrganizationGroupParticipation,
  type OrganizationGroupsListQuery,
  type OrganizationGroupsListResponse,
} from "../../../../assets/shared/schemas/organization-activity";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { queryPage, type OffsetPageQuery } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { ACTIVE_ORGANIZATION_IDENTITY_PREDICATE } from "./representative-users";

interface GroupParticipationRow {
  group_id: string;
  group_slug: string;
  group_name: string;
  group_kind: string;
  group_kind_label: string;
  representative_count: number;
  first_joined_at: string;
  latest_joined_at: string;
}

/**
 * Driven from the organization, not from the groups table.
 *
 * The obvious spelling — `FROM groups JOIN group_memberships JOIN identities`
 * — makes SQLite scan every active capacity in the system and filter down to
 * the handful this organization holds (`SCAN gm USING INDEX
 * uq_group_memberships_active_capacity`). Leading with the organization's
 * identities instead puts the driving lookup on
 * `idx_identities_organization_lifecycle`, which is the selective side: an
 * organization has a few representatives, the system has many memberships.
 *
 * `gm.user_id` is joined alongside `gm.identity_id` deliberately. The identity
 * predicate is the one that decides correctness — a capacity is this
 * organization's only when it was taken up under this organization's identity,
 * never merely by the same person acting elsewhere. `group_memberships` stores
 * the identity's own `user_id` beside it, so the extra equality is redundant
 * by construction and buys the covering `idx_group_memberships_user_active`
 * access path, which no identity-keyed index offers.
 */
const ORGANIZATION_GROUPS_FROM = `FROM identities representative
  JOIN group_memberships gm
    ON gm.user_id = representative.user_id
   AND gm.identity_id = representative.id
   AND gm.left_at IS NULL
  JOIN groups g ON g.id = gm.group_id`;

/** The label join belongs to the projection only; the count never needs it. */
const ORGANIZATION_GROUPS_PAGE_FROM = `${ORGANIZATION_GROUPS_FROM}
  JOIN group_types gt ON gt.key = g.type_key`;

const ORGANIZATION_GROUPS_SELECT = `SELECT g.id AS group_id, g.slug AS group_slug, g.name AS group_name,
         g.type_key AS group_kind, gt.singular_label AS group_kind_label,
         COUNT(DISTINCT representative.id) AS representative_count,
         MIN(gm.joined_at) AS first_joined_at,
         MAX(gm.joined_at) AS latest_joined_at`;

const ORGANIZATION_GROUPS_SORT_EXPRESSIONS = {
  name: "g.name COLLATE NOCASE",
  representativeCount: "representative_count",
  latestJoinedAt: "latest_joined_at",
} satisfies Record<(typeof ORGANIZATION_GROUPS_SORT_COLUMNS)[number], string>;

/** Exported so `tests/admin-list-query-plans.test.ts` can assert the page/count pair. */
export function buildOrganizationGroupsPageQuery(
  organizationId: string,
  query: OrganizationGroupsListQuery,
): OffsetPageQuery {
  const search = query.q ? buildD1TextSearchFilter(query.q, ["g.name"]) : null;
  const conditions = [ACTIVE_ORGANIZATION_IDENTITY_PREDICATE, ...(search ? [search.sql] : [])];
  const where = `\n WHERE ${conditions.join(" AND ")}`;
  const bindings: unknown[] = [organizationId, ...(search?.bindings ?? [])];

  return {
    source: {
      selectSql: ORGANIZATION_GROUPS_SELECT,
      fromSql: `${ORGANIZATION_GROUPS_PAGE_FROM}${where}\n GROUP BY g.id`,
      countSelectSql: "SELECT COUNT(DISTINCT g.id) AS total",
      countFromSql: `${ORGANIZATION_GROUPS_FROM}${where}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      ORGANIZATION_GROUPS_SORT_EXPRESSIONS,
      ORGANIZATION_GROUPS_SORT_EXPRESSIONS.name,
      "g.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

function mapGroupParticipation(row: GroupParticipationRow): OrganizationGroupParticipation {
  return {
    groupId: row.group_id,
    groupSlug: row.group_slug,
    groupName: row.group_name,
    groupKind: row.group_kind,
    groupKindLabel: row.group_kind_label,
    representativeCount: row.representative_count,
    firstJoinedAt: row.first_joined_at,
    latestJoinedAt: row.latest_joined_at,
  };
}

export async function listOrganizationGroups(
  db: DatabaseLike,
  organizationId: string,
  query: OrganizationGroupsListQuery,
): Promise<OrganizationGroupsListResponse> {
  const { rows, total } = await queryPage<GroupParticipationRow>(
    db,
    buildOrganizationGroupsPageQuery(organizationId, query),
  );
  return organizationGroupsListResponseSchema.parse({
    groups: rows.map(mapGroupParticipation),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}
