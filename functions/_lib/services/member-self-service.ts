/**
 * Member profile & working-group self-service (PRD §4.9, §4.10). All
 * functions here operate on the caller's own AuthMember identity —
 * `/api/v1/me/*` never accepts a target user/member id, by design.
 */
import { all, first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { stringifyJson, parseJsonSafe } from "../utils/json";
import { AppError } from "../errors";
import { enqueueGoogleGroupsSync } from "./google-groups";
import { VOTING_CATEGORIES } from "./member-applications";
import type { AuthMember, DatabaseLike } from "../types";

const CA_WORKING_GROUP_SLUG = "ca";
const CA_ONLY_CATEGORY = "A";

export interface MyProfile {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  jobTitle: string | null;
  biography: string | null;
  links: string[];
  membershipCategory: string;
  organizationId: string | null;
  organizationName: string | null;
  memberSince: string;
  showOnOrgProfile: boolean;
  canEditOrganizationName: boolean;
}

interface MyProfileRow {
  email: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  organization_name: string | null;
  member_type: string;
  organization_id: string | null;
  show_on_org_profile: number;
  member_created_at: string;
  org_name: string | null;
}

function normalizeLinks(linksJson: string | null): string[] {
  const raw = parseJsonSafe<unknown[]>(linksJson, []);
  return raw
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .map((url) => url.trim())
    .filter(Boolean);
}

function toProfile(row: MyProfileRow, member: AuthMember): MyProfile {
  const isIndividual = row.organization_id === null;
  return {
    userId: member.userId,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    preferredName: row.preferred_name,
    jobTitle: row.job_title,
    biography: row.biography,
    links: normalizeLinks(row.links_json),
    membershipCategory: row.member_type,
    organizationId: row.organization_id,
    organizationName: row.org_name ?? row.organization_name,
    memberSince: row.member_created_at,
    showOnOrgProfile: row.show_on_org_profile === 1,
    // §4.10: organization is locked to membership for org-tied categories;
    // H5/H6/H7 (org-less) may set a free-text organization name.
    canEditOrganizationName: isIndividual,
  };
}

export async function getMyProfile(db: DatabaseLike, member: AuthMember): Promise<MyProfile> {
  const row = await first<MyProfileRow>(
    db,
    `SELECT u.email, u.first_name, u.last_name, u.preferred_name, u.job_title, u.biography, u.links_json,
            u.organization_name, m.member_type, m.organization_id, m.show_on_org_profile, m.created_at AS member_created_at,
            o.name AS org_name
     FROM users u
     JOIN members m ON m.user_id = u.id
     LEFT JOIN organizations o ON o.id = m.organization_id
     WHERE u.id = ?`,
    [member.userId],
  );
  if (!row) {
    throw new AppError(404, "NOT_FOUND", "Profile not found");
  }
  return toProfile(row, member);
}

export interface MyProfileUpdateInput {
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  jobTitle?: string;
  biography?: string;
  links?: string[];
  /** Only honored for org-less categories (H5/H6/H7) — see §4.10. */
  organizationName?: string;
}

export async function updateMyProfile(
  db: DatabaseLike,
  member: AuthMember,
  input: MyProfileUpdateInput,
): Promise<MyProfile> {
  const now = nowIso();

  await run(
    db,
    `UPDATE users
     SET first_name = COALESCE(?, first_name),
         last_name = COALESCE(?, last_name),
         preferred_name = COALESCE(?, preferred_name),
         job_title = COALESCE(?, job_title),
         biography = COALESCE(?, biography),
         links_json = COALESCE(?, links_json),
         updated_at = ?
     WHERE id = ?`,
    [
      input.firstName ?? null,
      input.lastName ?? null,
      input.preferredName ?? null,
      input.jobTitle ?? null,
      input.biography ?? null,
      input.links ? stringifyJson(input.links) : null,
      now,
      member.userId,
    ],
  );

  // organization is locked to membership for org-tied categories (§4.10) —
  // only H5/H6/H7 (member.organizationId === null) may set a free-text name.
  if (member.organizationId === null && input.organizationName !== undefined) {
    await run(db, `UPDATE users SET organization_name = ?, updated_at = ? WHERE id = ?`, [
      input.organizationName,
      now,
      member.userId,
    ]);
  }

  return getMyProfile(db, member);
}

export async function updateOrganizationVisibility(
  db: DatabaseLike,
  member: AuthMember,
  showOnOrgProfile: boolean,
): Promise<void> {
  await run(db, `UPDATE members SET show_on_org_profile = ?, updated_at = ? WHERE id = ?`, [
    showOnOrgProfile ? 1 : 0,
    nowIso(),
    member.memberId,
  ]);
}

export interface MyApplicationSummary {
  id: string;
  status: string;
  stage: string;
  membershipCategory: string;
  createdAt: string;
}

export async function listMyApplications(db: DatabaseLike, member: AuthMember): Promise<MyApplicationSummary[]> {
  const rows = await all<{
    id: string;
    status: string;
    stage: string;
    membership_category: string;
    created_at: string;
  }>(
    db,
    `SELECT id, status, stage, membership_category, created_at FROM member_applications WHERE applicant_email = ? ORDER BY created_at DESC`,
    [member.email],
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    stage: r.stage,
    membershipCategory: r.membership_category,
    createdAt: r.created_at,
  }));
}

// ── Working group self-service (§4.9) ────────────────────────────────────

export interface MyWorkingGroupMembership {
  workingGroupId: string;
  slug: string;
  name: string;
  joinedAt: string;
}

export async function listMyWorkingGroups(db: DatabaseLike, member: AuthMember): Promise<MyWorkingGroupMembership[]> {
  const rows = await all<{ id: string; slug: string; name: string; joined_at: string }>(
    db,
    `SELECT wg.id, wg.slug, wg.name, wgm.joined_at
     FROM working_group_members wgm
     JOIN working_groups wg ON wg.id = wgm.working_group_id
     WHERE wgm.user_id = ? AND wgm.left_at IS NULL
     ORDER BY wgm.joined_at ASC`,
    [member.userId],
  );
  return rows.map((r) => ({ workingGroupId: r.id, slug: r.slug, name: r.name, joinedAt: r.joined_at }));
}

async function getWorkingGroupBySlugOrId(db: DatabaseLike, wgIdOrSlug: string) {
  return first<{ id: string; slug: string; name: string; mailing_list_email: string | null }>(
    db,
    `SELECT id, slug, name, mailing_list_email FROM working_groups WHERE id = ? OR slug = ?`,
    [wgIdOrSlug, wgIdOrSlug],
  );
}

export async function joinMyWorkingGroup(db: DatabaseLike, member: AuthMember, wgIdOrSlug: string): Promise<void> {
  const wg = await getWorkingGroupBySlugOrId(db, wgIdOrSlug);
  if (!wg) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }
  if (wg.slug === CA_WORKING_GROUP_SLUG && member.membershipCategory !== CA_ONLY_CATEGORY) {
    throw new AppError(403, "CA_CATEGORY_REQUIRED", "Only category A members may join the CA working group");
  }

  const existing = await first<{ id: string }>(
    db,
    `SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL`,
    [wg.id, member.userId],
  );
  if (existing) return;

  await run(
    db,
    `INSERT INTO working_group_members (id, working_group_id, user_id, joined_at, left_at) VALUES (?, ?, ?, ?, NULL)`,
    [uuid(), wg.id, member.userId, nowIso()],
  );

  if (wg.mailing_list_email) {
    await enqueueGoogleGroupsSync(db, {
      userId: member.userId,
      googleGroupEmail: wg.mailing_list_email,
      action: "add_to_list",
    });
  }
}

export async function leaveMyWorkingGroup(db: DatabaseLike, member: AuthMember, wgIdOrSlug: string): Promise<void> {
  const wg = await getWorkingGroupBySlugOrId(db, wgIdOrSlug);
  if (!wg) {
    throw new AppError(404, "WORKING_GROUP_NOT_FOUND", "Working group not found");
  }

  const result = await run(
    db,
    `UPDATE working_group_members SET left_at = ? WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL`,
    [nowIso(), wg.id, member.userId],
  );
  if (result.changes === 0) return;

  if (wg.mailing_list_email) {
    await enqueueGoogleGroupsSync(db, {
      userId: member.userId,
      googleGroupEmail: wg.mailing_list_email,
      action: "remove_from_list",
    });
  }
}

/** True for A-G members — used by /api/v1/me/votes (currently a stub, see route) to at least gate on category shape. */
export function isVotingCategory(category: string): boolean {
  return VOTING_CATEGORIES.has(category);
}
