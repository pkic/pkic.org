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
import { all, first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { AppError } from "../errors";
import {
  getWorkingGroupBySlugOrId,
  assertCaConstraint,
  addWorkingGroupMember,
  removeWorkingGroupMember,
} from "./working-groups";
import type { DatabaseLike } from "../types";

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

export interface AdminWorkingGroupDetail extends AdminWorkingGroupSummary {
  members: AdminWorkingGroupMember[];
}

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

// Resolves the current chair/vice-chair per WG from user_roles via
// role-wg_chair/role-wg_vice_chair, context_type='working_group'. A ROW_NUMBER() window
// picks the most-recently-created active (non-revoked, non-expired)
// assignment per WG so a stray double-assignment can't multiply rows in
// the outer query.
const ACTIVE_USER_ROLE_FILTER = `
  ur.revoked_at IS NULL
  AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
`;

function chairSubquery(roleId: string): string {
  return `
    SELECT wg_id, user_role_id, user_id, first_name, last_name, email, expires_at FROM (
      SELECT ur.context_id AS wg_id, ur.id AS user_role_id, u.id AS user_id, u.first_name, u.last_name, u.email,
             ur.expires_at,
             ROW_NUMBER() OVER (PARTITION BY ur.context_id ORDER BY ur.created_at DESC) AS rn
      FROM user_roles ur
      JOIN users u ON u.id = ur.user_id
      WHERE ur.context_type = 'working_group' AND ur.role_id = '${roleId}' AND ${ACTIVE_USER_ROLE_FILTER}
    ) WHERE rn = 1
  `;
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
  LEFT JOIN (${chairSubquery("role-wg_chair")}) chair ON chair.wg_id = wg.id
  LEFT JOIN (${chairSubquery("role-wg_vice_chair")}) vice_chair ON vice_chair.wg_id = wg.id
`;

export async function listAdminWorkingGroups(db: DatabaseLike): Promise<AdminWorkingGroupSummary[]> {
  const rows = await all<WorkingGroupSummaryRow>(db, `${SUMMARY_SELECT} ORDER BY wg.name ASC`);
  return rows.map(toSummary);
}

export async function getAdminWorkingGroupDetail(
  db: DatabaseLike,
  idOrSlug: string,
): Promise<AdminWorkingGroupDetail | null> {
  const row = await first<WorkingGroupSummaryRow>(db, `${SUMMARY_SELECT} WHERE wg.id = ? OR wg.slug = ?`, [
    idOrSlug,
    idOrSlug,
  ]);
  if (!row) return null;

  const members = await all<{
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    org_name: string | null;
    category_code: string | null;
    joined_at: string;
  }>(
    db,
    `SELECT u.id AS user_id, u.first_name, u.last_name, u.email, o.name AS org_name, mca.category_code, wgm.joined_at
     FROM working_group_members wgm
     JOIN users u ON u.id = wgm.user_id
     LEFT JOIN organization_representatives rep ON rep.user_id = wgm.user_id AND rep.left_at IS NULL
     LEFT JOIN members m ON m.id = rep.member_id
     LEFT JOIN members mi ON mi.user_id = wgm.user_id AND mi.status = 'active'
     LEFT JOIN organizations o ON o.id = m.organization_id
     LEFT JOIN member_category_assignments mca ON mca.member_id = COALESCE(m.id, mi.id)
     WHERE wgm.working_group_id = ? AND wgm.left_at IS NULL
     ORDER BY u.last_name ASC, u.first_name ASC`,
    [row.id],
  );

  return {
    ...toSummary(row),
    members: members.map((m) => ({
      userId: m.user_id,
      name: [m.first_name, m.last_name].filter(Boolean).join(" ") || "Unknown",
      email: m.email,
      organizationName: m.org_name,
      memberCategory: m.category_code,
      joinedAt: m.joined_at,
    })),
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

  await run(
    db,
    `INSERT INTO working_groups
       (id, name, slug, description, mailing_list_email, min_endorsers_for_ballot, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      input.name,
      slug,
      input.description ?? null,
      input.mailingListEmail ?? null,
      input.minEndorsersForBallot ?? 0,
      now,
      now,
    ],
  );

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
    await run(db, `UPDATE working_groups SET ${setClauses.join(", ")} WHERE id = ?`, values);
  }

  const detail = await getAdminWorkingGroupDetail(db, id);
  if (!detail) {
    throw new AppError(500, "WORKING_GROUP_UPDATE_FAILED", "Failed to load working group after update");
  }
  const { members: _members, ...summary } = detail;
  return summary;
}

export async function addMemberToWorkingGroup(db: DatabaseLike, wgId: string, targetUserId: string): Promise<void> {
  const wg = await getWorkingGroupBySlugOrId(db, wgId);
  if (!wg) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }

  const targetUser = await first<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", [targetUserId]);
  if (!targetUser) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const membership = await first<{ category_code: string }>(
    db,
    `SELECT mca.category_code
     FROM member_category_assignments mca
     WHERE mca.member_id = COALESCE(
       (SELECT m.id FROM members m
          JOIN organization_representatives rep ON rep.member_id = m.id
          WHERE rep.user_id = ? AND rep.left_at IS NULL),
       (SELECT id FROM members WHERE user_id = ? AND status = 'active')
     )`,
    [targetUserId, targetUserId],
  );
  assertCaConstraint(wg, membership?.category_code ?? null);

  await addWorkingGroupMember(db, wg, targetUserId);
}

export async function removeMemberFromWorkingGroup(
  db: DatabaseLike,
  wgId: string,
  targetUserId: string,
): Promise<void> {
  const wg = await getWorkingGroupBySlugOrId(db, wgId);
  if (!wg) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }
  await removeWorkingGroupMember(db, wg, targetUserId);
}
