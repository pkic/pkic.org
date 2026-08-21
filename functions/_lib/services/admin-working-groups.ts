/**
 * Admin working-groups CRUD + membership management (
 * Working Groups (staff admin / WG chair in context) endpoint list).
 * The public GET /api/v1/working-groups[/:id] (members-directory.ts) stays
 * read-only and filtered to active groups / a name-only member subset —
 * this module is the admin-only, unfiltered, full-detail counterpart that
 * also supports create/update/deactivate and direct member add/remove
 * (self-service join/leave already existed; only staff-driven add/remove
 * on behalf of another user was missing).
 */
import { first } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { AppError } from "../errors";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy, resolveOrderBy } from "../db/sort";
import {
  ADMIN_WORKING_GROUP_MEMBER_SORT_COLUMNS,
  ADMIN_WORKING_GROUP_SORT_COLUMNS,
} from "../../../assets/shared/schemas/working-groups";
import {
  getWorkingGroupBySlugOrId,
  assertCaConstraint,
  buildAddWorkingGroupMemberStatements,
  buildRemoveWorkingGroupMemberStatements,
} from "./working-groups";
import { prepareAuditLog } from "./audit";
import { deterministicRepresentativeJoinSql } from "./membership/representative-lookup";
import { findEligibleMemberById } from "../auth/member";
import type { DatabaseLike } from "../types";
import {
  currentWorkingGroupRoleHolderSql,
  WORKING_GROUP_CHAIR_ROLE_ID,
  WORKING_GROUP_VICE_CHAIR_ROLE_ID,
} from "./working-group-leadership";

/**
 * Current holder of a chair/vice-chair designation — resolved from
 * `user_roles` (role `role-wg_chair`/`role-wg_vice_chair`,
 * context_type='working_group', context_id=<wg id>). `userRoleId` is the
 * `user_roles.id` needed to revoke the assignment via the existing
 * DELETE /api/v1/admin/users/:userId/roles/:userRoleId endpoint.
 */
export interface ChairInfo {
  userRoleId: string;
  userId: string;
  name: string;
  email: string;
  expiresAt: string | null;
}

export interface AdminWorkingGroupSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  mailingListEmail: string | null;
  minEndorsersForBallot: number;
  active: boolean;
  chair: ChairInfo | null;
  viceChair: ChairInfo | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminWorkingGroupMember {
  userId: string;
  name: string;
  email: string;
  organizationName: string | null;
  memberCategory: string | null;
  joinedAt: string;
}

export type AdminWorkingGroupDetail = AdminWorkingGroupSummary;

interface WorkingGroupSummaryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  mailing_list_email: string | null;
  min_endorsers_for_ballot: number;
  active: number;
  created_at: string;
  updated_at: string;
  member_count: number;
  chair_user_role_id: string | null;
  chair_user_id_resolved: string | null;
  chair_first_name: string | null;
  chair_last_name: string | null;
  chair_email: string | null;
  chair_expires_at: string | null;
  vice_chair_user_role_id: string | null;
  vice_chair_user_id: string | null;
  vice_chair_first_name: string | null;
  vice_chair_last_name: string | null;
  vice_chair_email: string | null;
  vice_chair_expires_at: string | null;
}

function toChairInfo(
  userRoleId: string | null,
  userId: string | null,
  firstName: string | null,
  lastName: string | null,
  email: string | null,
  expiresAt: string | null,
): ChairInfo | null {
  if (!userRoleId || !userId) return null;
  return {
    userRoleId,
    userId,
    name: [firstName, lastName].filter(Boolean).join(" ") || email || "Unknown",
    email: email ?? "",
    expiresAt,
  };
}

function toSummary(row: WorkingGroupSummaryRow): AdminWorkingGroupSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    mailingListEmail: row.mailing_list_email,
    minEndorsersForBallot: row.min_endorsers_for_ballot,
    active: row.active === 1,
    chair: toChairInfo(
      row.chair_user_role_id,
      row.chair_user_id_resolved,
      row.chair_first_name,
      row.chair_last_name,
      row.chair_email,
      row.chair_expires_at,
    ),
    viceChair: toChairInfo(
      row.vice_chair_user_role_id,
      row.vice_chair_user_id,
      row.vice_chair_first_name,
      row.vice_chair_last_name,
      row.vice_chair_email,
      row.vice_chair_expires_at,
    ),
    memberCount: row.member_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SUMMARY_SELECT = `
  SELECT wg.id, wg.name, wg.slug, wg.description, wg.mailing_list_email, wg.min_endorsers_for_ballot,
         wg.active, wg.created_at, wg.updated_at,
         (SELECT COUNT(*) FROM working_group_members wgm
           WHERE wgm.working_group_id = wg.id AND wgm.left_at IS NULL) AS member_count,
         chair.user_role_id AS chair_user_role_id, chair.user_id AS chair_user_id_resolved,
         chair.first_name AS chair_first_name, chair.last_name AS chair_last_name, chair.email AS chair_email,
         chair.expires_at AS chair_expires_at,
         vice_chair.user_role_id AS vice_chair_user_role_id, vice_chair.user_id AS vice_chair_user_id,
         vice_chair.first_name AS vice_chair_first_name, vice_chair.last_name AS vice_chair_last_name,
         vice_chair.email AS vice_chair_email, vice_chair.expires_at AS vice_chair_expires_at
  FROM working_groups wg
  LEFT JOIN (${currentWorkingGroupRoleHolderSql(WORKING_GROUP_CHAIR_ROLE_ID)}) chair ON chair.wg_id = wg.id
  LEFT JOIN (${currentWorkingGroupRoleHolderSql(WORKING_GROUP_VICE_CHAIR_ROLE_ID)}) vice_chair ON vice_chair.wg_id = wg.id
`;

export async function listAdminWorkingGroups(
  db: DatabaseLike,
  query: { limit: number; offset: number; q?: string; sort?: string; active?: "true" | "false" },
): Promise<{ workingGroups: AdminWorkingGroupSummary[]; total: number }> {
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["wg.name", "wg.slug", "wg.description", "wg.mailing_list_email"])
    : null;
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.active) {
    conditions.push("wg.active = ?");
    bindings.push(query.active === "true" ? 1 : 0);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = resolveOrderBy(query.sort, ADMIN_WORKING_GROUP_SORT_COLUMNS, "ORDER BY wg.name ASC", "wg.id ASC");
  const { rows, total } = await queryPage<WorkingGroupSummaryRow>(
    db,
    {
      sql: `${SUMMARY_SELECT} ${where} ${orderBy} LIMIT ? OFFSET ?`,
      bindings: [...bindings, query.limit, query.offset],
    },
    {
      sql: `SELECT COUNT(*) AS total FROM working_groups wg ${where}`,
      bindings,
    },
  );
  return { workingGroups: rows.map(toSummary), total };
}

export async function getAdminWorkingGroupDetail(
  db: DatabaseLike,
  idOrSlug: string,
): Promise<AdminWorkingGroupSummary | null> {
  const row = await first<WorkingGroupSummaryRow>(db, `${SUMMARY_SELECT} WHERE wg.id = ? OR wg.slug = ?`, [
    idOrSlug,
    idOrSlug,
  ]);
  if (!row) return null;

  return toSummary(row);
}

const WORKING_GROUP_MEMBER_FROM_SQL = `FROM working_group_members wgm
  JOIN users u ON u.id = wgm.user_id
${deterministicRepresentativeJoinSql("wgm.user_id")}
  LEFT JOIN members m ON m.id = COALESCE(
    wgm.member_id,
    rep.member_id,
    (
      SELECT fallback.id FROM members fallback
      WHERE fallback.user_id = wgm.user_id AND fallback.status = 'active'
      ORDER BY datetime(fallback.created_at) ASC, fallback.id ASC
      LIMIT 1
    )
  )
  LEFT JOIN organizations o ON o.id = m.organization_id
  LEFT JOIN member_category_assignments mca ON mca.member_id = m.id`;

const WORKING_GROUP_MEMBER_SORT_EXPRESSIONS = {
  name: "LOWER(COALESCE(u.last_name, '') || ' ' || COALESCE(u.first_name, '') || ' ' || u.email)",
  email: "LOWER(u.email)",
  organization_name: "LOWER(o.name)",
  member_category: "mca.category_code",
  joined_at: "wgm.joined_at",
} satisfies Record<(typeof ADMIN_WORKING_GROUP_MEMBER_SORT_COLUMNS)[number], string>;

export async function listAdminWorkingGroupMembers(
  db: DatabaseLike,
  idOrSlug: string,
  query: { limit: number; offset: number; q?: string; sort?: string },
): Promise<{ members: AdminWorkingGroupMember[]; total: number }> {
  const workingGroup = await getWorkingGroupBySlugOrId(db, idOrSlug);
  if (!workingGroup) throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["u.first_name", "u.last_name", "u.email", "o.name", "mca.category_code"])
    : null;
  const where = `WHERE wgm.working_group_id = ? AND wgm.left_at IS NULL${search ? ` AND ${search.sql}` : ""}`;
  const bindings = [workingGroup.id, ...(search?.bindings ?? [])];
  const orderBy = resolveMappedOrderBy(
    query.sort,
    WORKING_GROUP_MEMBER_SORT_EXPRESSIONS,
    WORKING_GROUP_MEMBER_SORT_EXPRESSIONS.name,
    "u.id ASC",
  );
  const { rows, total } = await queryPage<{
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    org_name: string | null;
    category_code: string | null;
    joined_at: string;
  }>(
    db,
    {
      sql: `SELECT u.id AS user_id, u.first_name, u.last_name, u.email,
                   o.name AS org_name, mca.category_code, wgm.joined_at
            ${WORKING_GROUP_MEMBER_FROM_SQL}
            ${where}
            ${orderBy}
            LIMIT ? OFFSET ?`,
      bindings: [...bindings, query.limit, query.offset],
    },
    {
      sql: `SELECT COUNT(*) AS total ${WORKING_GROUP_MEMBER_FROM_SQL} ${where}`,
      bindings,
    },
  );

  return {
    members: rows.map((m) => ({
      userId: m.user_id,
      name: [m.first_name, m.last_name].filter(Boolean).join(" ") || "Unknown",
      email: m.email,
      organizationName: m.org_name,
      memberCategory: m.category_code,
      joinedAt: m.joined_at,
    })),
    total,
  };
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function uniqueSlug(db: DatabaseLike, base: string): Promise<string> {
  const root = base || "wg";
  let candidate = root;
  let suffix = 2;
  while (await first<{ id: string }>(db, "SELECT id FROM working_groups WHERE slug = ?", [candidate])) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export async function createWorkingGroup(
  db: DatabaseLike,
  actorUserId: string,
  input: {
    name: string;
    description?: string | null;
    mailingListEmail?: string | null;
    minEndorsersForBallot?: number;
  },
): Promise<AdminWorkingGroupSummary> {
  const existing = await first<{ id: string }>(db, "SELECT id FROM working_groups WHERE lower(name) = lower(?)", [
    input.name,
  ]);
  if (existing) {
    throw new AppError(409, "DUPLICATE", "A working group with this name already exists");
  }

  const id = uuid();
  const now = nowIso();
  const slug = await uniqueSlug(db, slugify(input.name));

  await db.batch([
    db
      .prepare(
        `INSERT INTO working_groups
       (id, name, slug, description, mailing_list_email, min_endorsers_for_ballot, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        id,
        input.name,
        slug,
        input.description ?? null,
        input.mailingListEmail ?? null,
        input.minEndorsersForBallot ?? 0,
        now,
        now,
      ),
    prepareAuditLog(db, "admin", actorUserId, "working_group_created", "working_group", id, {
      name: input.name,
    }),
  ]);

  return {
    id,
    name: input.name,
    slug,
    description: input.description ?? null,
    mailingListEmail: input.mailingListEmail ?? null,
    minEndorsersForBallot: input.minEndorsersForBallot ?? 0,
    active: true,
    chair: null,
    viceChair: null,
    memberCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateWorkingGroup(
  db: DatabaseLike,
  actorUserId: string,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    mailingListEmail?: string | null;
    minEndorsersForBallot?: number;
    active?: boolean;
  },
): Promise<AdminWorkingGroupSummary> {
  const existing = await first<{ id: string }>(db, "SELECT id FROM working_groups WHERE id = ?", [id]);
  if (!existing) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }

  if (patch.name !== undefined) {
    const nameCollision = await first<{ id: string }>(
      db,
      "SELECT id FROM working_groups WHERE lower(name) = lower(?) AND id != ?",
      [patch.name, id],
    );
    if (nameCollision) {
      throw new AppError(409, "DUPLICATE", "A working group with this name already exists");
    }
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    setClauses.push("name = ?");
    values.push(patch.name);
  }
  if (patch.description !== undefined) {
    setClauses.push("description = ?");
    values.push(patch.description);
  }
  if (patch.mailingListEmail !== undefined) {
    setClauses.push("mailing_list_email = ?");
    values.push(patch.mailingListEmail);
  }
  if (patch.minEndorsersForBallot !== undefined) {
    setClauses.push("min_endorsers_for_ballot = ?");
    values.push(patch.minEndorsersForBallot);
  }
  if (patch.active !== undefined) {
    setClauses.push("active = ?");
    values.push(patch.active ? 1 : 0);
  }

  if (setClauses.length > 0) {
    setClauses.push("updated_at = ?");
    values.push(nowIso());
    values.push(id);
    await db.batch([
      db.prepare(`UPDATE working_groups SET ${setClauses.join(", ")} WHERE id = ?`).bind(...values),
      prepareAuditLog(db, "admin", actorUserId, "working_group_updated", "working_group", id, patch),
    ]);
  }

  const detail = await getAdminWorkingGroupDetail(db, id);
  if (!detail) {
    throw new AppError(500, "WORKING_GROUP_UPDATE_FAILED", "Failed to load working group after update");
  }
  return detail;
}

export async function addMemberToWorkingGroup(
  db: DatabaseLike,
  actorUserId: string,
  wgId: string,
  targetUserId: string,
): Promise<void> {
  const wg = await getWorkingGroupBySlugOrId(db, wgId);
  if (!wg) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }

  const targetUser = await first<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", [targetUserId]);
  if (!targetUser) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  // Check every membership category the target holds, not one arbitrarily
  // picked by an unordered scalar subquery — a staff-driven add has no
  // "acting as" context to key off, so eligibility must consider all of
  // the target's affiliations (findEligibleMemberById, the same canonical
  // deterministic multi-membership resolver the member-session/portal
  // switcher uses), not just one.
  const eligibleMember = await findEligibleMemberById(db, targetUserId);
  const activeMemberships = eligibleMember?.activeMemberships ?? [];
  const membershipCategories = activeMemberships.map((m) => m.membershipCategory);
  assertCaConstraint(wg, membershipCategories);

  // Only record member_id when it's unambiguous — a target with more than
  // one active membership has no single "acting as" context a staff-driven
  // add can infer (see buildAddWorkingGroupMemberStatements's own note).
  const memberId = activeMemberships.length === 1 ? activeMemberships[0].memberId : null;
  const statements = await buildAddWorkingGroupMemberStatements(db, wg, targetUserId, memberId);
  if (statements.length === 0) return;
  statements.push(
    prepareAuditLog(db, "admin", actorUserId, "working_group_member_added", "working_group", wg.id, {
      userId: targetUserId,
    }),
  );
  await db.batch(statements);
}

export async function removeMemberFromWorkingGroup(
  db: DatabaseLike,
  actorUserId: string,
  wgId: string,
  targetUserId: string,
): Promise<void> {
  const wg = await getWorkingGroupBySlugOrId(db, wgId);
  if (!wg) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }
  const statements = await buildRemoveWorkingGroupMemberStatements(db, wg, targetUserId);
  if (statements.length === 0) return;
  statements.push(
    prepareAuditLog(db, "admin", actorUserId, "working_group_member_removed", "working_group", wg.id, {
      userId: targetUserId,
    }),
  );
  await db.batch(statements);
}
