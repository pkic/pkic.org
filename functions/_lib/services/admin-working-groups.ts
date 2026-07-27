/**
 * Admin working-groups CRUD + membership management (PRD §2.3/§4.9, §7's
 * "Working Groups (staff admin / WG chair in context)" endpoint list).
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

export interface AdminWorkingGroupSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  mailingListEmail: string | null;
  minEndorsersForBallot: number;
  active: boolean;
  chairUserId: string | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminWorkingGroupMember {
  userId: string;
  name: string;
  email: string;
  organizationName: string | null;
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
  chair_user_id: string | null;
  created_at: string;
  updated_at: string;
  member_count: number;
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
    chairUserId: row.chair_user_id,
    memberCount: row.member_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SUMMARY_SELECT = `
  SELECT wg.id, wg.name, wg.slug, wg.description, wg.mailing_list_email, wg.min_endorsers_for_ballot,
         wg.active, wg.chair_user_id, wg.created_at, wg.updated_at,
         (SELECT COUNT(*) FROM working_group_members wgm
           WHERE wgm.working_group_id = wg.id AND wgm.left_at IS NULL) AS member_count
  FROM working_groups wg
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
    joined_at: string;
  }>(
    db,
    `SELECT u.id AS user_id, u.first_name, u.last_name, u.email, o.name AS org_name, wgm.joined_at
     FROM working_group_members wgm
     JOIN users u ON u.id = wgm.user_id
     LEFT JOIN members m ON m.user_id = wgm.user_id AND m.status = 'active'
     LEFT JOIN organizations o ON o.id = m.organization_id
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
       (id, name, slug, description, mailing_list_email, chair_user_id, min_endorsers_for_ballot, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, 1, ?, ?)`,
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
    chairUserId: null,
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

  const membership = await first<{ member_type: string }>(db, "SELECT member_type FROM members WHERE user_id = ?", [
    targetUserId,
  ]);
  assertCaConstraint(wg, membership?.member_type ?? null);

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
