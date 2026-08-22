/** Member-owned working-group catalog and membership commands. */
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import { AppError } from "../errors";
import type { AuthMember, DatabaseLike } from "../types";
import {
  CA_ONLY_CATEGORY,
  CA_WORKING_GROUP_SLUG,
  addWorkingGroupMember,
  assertCaConstraint,
  getWorkingGroupBySlugOrId,
  removeWorkingGroupMember,
} from "./working-groups";

export interface MyWorkingGroupMembership {
  workingGroupId: string;
  slug: string;
  name: string;
  joinedAt: string;
}

export interface AvailableWorkingGroup {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  active: boolean;
}

interface MyWorkingGroupCatalogRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  active: number;
  joined_at: string | null;
}

export interface MyWorkingGroupEntry extends AvailableWorkingGroup {
  workingGroupId: string;
  joinedAt: string | null;
}

/**
 * Returns the caller's memberships and eligible catalog in one bounded D1
 * query. Eligibility belongs here, not in browser-side filtering. A joined
 * group remains visible even when it is inactive or the caller switches away
 * from the membership context that originally made it eligible, so it can
 * still be left cleanly.
 */
export async function listMyWorkingGroups(
  db: DatabaseLike,
  member: AuthMember,
  params: { view: "joined" | "catalog"; q?: string; sort?: string; limit: number; offset: number },
): Promise<{ workingGroups: MyWorkingGroupEntry[]; total: number }> {
  const search = params.q ? buildD1TextSearchFilter(params.q, ["wg.name", "wg.slug", "wg.description"]) : null;
  const viewPredicate =
    params.view === "joined"
      ? "wgm.id IS NOT NULL"
      : "(wg.active = 1 AND (wg.slug <> ? OR ? = ?)) OR wgm.id IS NOT NULL";
  const searchPredicate = search ? ` AND ${search.sql}` : "";
  const bindings = [
    member.userId,
    ...(params.view === "catalog" ? [CA_WORKING_GROUP_SLUG, member.membershipCategory, CA_ONLY_CATEGORY] : []),
    ...(search?.bindings ?? []),
  ];
  const result = await queryPage<MyWorkingGroupCatalogRow>(db, {
    sql: `SELECT wg.id, wg.slug, wg.name, wg.description, wg.active, wgm.joined_at
       FROM working_groups wg
       LEFT JOIN working_group_members wgm
         ON wgm.working_group_id = wg.id
        AND wgm.user_id = ?
        AND wgm.left_at IS NULL
      WHERE (${viewPredicate})${searchPredicate}`,
    bindings,
    orderBy: resolveMappedOrderBy(
      params.sort,
      { name: "wg.name COLLATE NOCASE", slug: "wg.slug COLLATE NOCASE", joinedAt: "wgm.joined_at" },
      "wg.name COLLATE NOCASE ASC",
      "wg.id ASC",
    ),
    limit: params.limit,
    offset: params.offset,
  });

  return {
    workingGroups: result.rows.map((row) => ({
      workingGroupId: row.id,
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      active: row.active === 1,
      joinedAt: row.joined_at,
    })),
    total: result.total,
  };
}

export async function joinMyWorkingGroup(db: DatabaseLike, member: AuthMember, wgIdOrSlug: string): Promise<void> {
  const wg = await getWorkingGroupBySlugOrId(db, wgIdOrSlug);
  if (!wg) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }
  if (wg.active !== 1) {
    throw new AppError(409, "WORKING_GROUP_INACTIVE", "This working group is not accepting members");
  }
  assertCaConstraint(wg, [member.membershipCategory]);
  await addWorkingGroupMember(db, wg, member.userId, member.memberId);
}

export async function leaveMyWorkingGroup(db: DatabaseLike, member: AuthMember, wgIdOrSlug: string): Promise<void> {
  const wg = await getWorkingGroupBySlugOrId(db, wgIdOrSlug);
  if (!wg) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }
  await removeWorkingGroupMember(db, wg, member.userId);
}
