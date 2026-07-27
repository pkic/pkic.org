/**
 * Interim Admin Tool (PRD §6 "Interim Admin Tool — Manual Member
 * Management (pre-Phase 4A)"). Creates an organization (or org-less
 * individual) plus representative(s) plus member row(s) directly, and
 * lists every `members` row for the admin UI (unfiltered by status,
 * unlike the public directory in members-directory.ts which only
 * surfaces one "primary" row per organization).
 */
import { all, first, run } from "../db/queries";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { findOrCreateUser } from "./users";
import { normalizeOrgName } from "./sponsorship";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

const INDIVIDUAL_MEMBERSHIP_CATEGORIES = new Set(["H5", "H6", "H7"]);

export interface AdminMemberCreateRepresentative {
  name: string;
  email: string;
  role?: string;
  linkedin?: string;
}

export interface AdminMemberCreateInput {
  organizationName?: string;
  website?: string;
  description?: string;
  membershipCategory: string;
  memberSince: string;
  representatives: AdminMemberCreateRepresentative[];
  workingGroupSlugs: string[];
}

export interface AdminMemberSummary {
  id: string;
  userId: string;
  organizationId: string | null;
  organizationName: string | null;
  name: string;
  email: string;
  membershipCategory: string;
  status: string;
  showOnOrgProfile: boolean;
  createdAt: string;
}

function splitName(fullName: string): { firstName: string | null; lastName: string | null } {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: null, lastName: null };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: null };
  return { firstName: tokens.slice(0, -1).join(" "), lastName: tokens[tokens.length - 1] };
}

/**
 * Creates active organizations/users/members(/working_group_members) rows
 * immediately. Idempotent on the organization (an existing org with the
 * same normalized name is reused, matching the migration script's upsert
 * convention), but NOT on membership: `members.user_id` is UNIQUE, so a
 * representative who already holds a membership causes the whole request
 * to fail with 409 before anything is written — this is an interactive
 * admin tool, not a bulk import, so a silent no-op (the migration script's
 * behavior) would be a confusing UX here.
 */
export async function createAdminMember(
  db: DatabaseLike,
  input: AdminMemberCreateInput,
): Promise<{ organizationId: string | null; members: AdminMemberSummary[] }> {
  const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(input.membershipCategory);

  for (const rep of input.representatives) {
    const existingUser = await first<{ id: string }>(db, "SELECT id FROM users WHERE normalized_email = ?", [
      normalizeEmail(rep.email),
    ]);
    if (existingUser) {
      const existingMember = await first<{ id: string }>(db, "SELECT id FROM members WHERE user_id = ?", [
        existingUser.id,
      ]);
      if (existingMember) {
        throw new AppError(409, "ALREADY_MEMBER", `${rep.email} already holds a membership`);
      }
    }
  }

  let organizationId: string | null = null;

  if (!isIndividual && input.organizationName) {
    const normalizedOrgName = normalizeOrgName(input.organizationName);
    const existingOrg = await first<{ id: string }>(db, "SELECT id FROM organizations WHERE normalized_name = ?", [
      normalizedOrgName,
    ]);

    if (existingOrg) {
      organizationId = existingOrg.id;
    } else {
      organizationId = uuid();
      const now = nowIso();
      await run(
        db,
        `INSERT INTO organizations (id, name, normalized_name, data_json, description, website, membership_category, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        [
          organizationId,
          input.organizationName,
          normalizedOrgName,
          input.description ?? null,
          input.website ?? null,
          input.membershipCategory,
          now,
          now,
        ],
      );
    }
  }

  if (!isIndividual && organizationId) {
    // Category is an organization-level fact (migration 0040). Keep it (and
    // every existing org-tied representative's member_type mirror) in sync
    // with what was just submitted — matters when this call reuses an
    // existing organization rather than creating a new one.
    const now = nowIso();
    await run(db, "UPDATE organizations SET membership_category = ?, updated_at = ? WHERE id = ?", [
      input.membershipCategory,
      now,
      organizationId,
    ]);
    await run(db, "UPDATE members SET member_type = ?, updated_at = ? WHERE organization_id = ?", [
      input.membershipCategory,
      now,
      organizationId,
    ]);
  }

  const members: AdminMemberSummary[] = [];

  for (const [index, rep] of input.representatives.entries()) {
    const { firstName, lastName } = splitName(rep.name);
    const user = await findOrCreateUser(db, {
      email: rep.email,
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      jobTitle: rep.role,
      linksJson: rep.linkedin ? JSON.stringify({ linkedin: rep.linkedin }) : null,
      allowProfileUpdate: true,
    });

    const now = nowIso();
    const memberId = uuid();
    await run(
      db,
      `INSERT INTO members (id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at, show_on_org_profile)
       VALUES (?, ?, ?, ?, 'active', NULL, NULL, ?, ?, 1)`,
      [memberId, input.membershipCategory, user.id, organizationId, now, now],
    );

    if (organizationId && index === 0) {
      await run(
        db,
        `UPDATE organizations SET primary_contact_user_id = ?, updated_at = ? WHERE id = ? AND primary_contact_user_id IS NULL`,
        [user.id, now, organizationId],
      );
    }
    if (organizationId && index === 1) {
      await run(
        db,
        `UPDATE organizations SET secondary_contact_user_id = ?, updated_at = ? WHERE id = ? AND secondary_contact_user_id IS NULL`,
        [user.id, now, organizationId],
      );
    }

    for (const slug of input.workingGroupSlugs) {
      const wg = await first<{ id: string }>(db, "SELECT id FROM working_groups WHERE slug = ?", [slug]);
      if (!wg) continue;
      const existingMembership = await first<{ id: string }>(
        db,
        "SELECT id FROM working_group_members WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL",
        [wg.id, user.id],
      );
      if (existingMembership) continue;
      await run(
        db,
        `INSERT INTO working_group_members (id, working_group_id, user_id, joined_at, left_at) VALUES (?, ?, ?, ?, NULL)`,
        [uuid(), wg.id, user.id, now],
      );
    }

    members.push({
      id: memberId,
      userId: user.id,
      organizationId,
      organizationName: input.organizationName ?? null,
      name: rep.name,
      email: user.email,
      membershipCategory: input.membershipCategory,
      status: "active",
      showOnOrgProfile: true,
      createdAt: now,
    });
  }

  return { organizationId, members };
}

interface AdminMemberRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  org_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  member_type: string;
  status: string;
  show_on_org_profile: number;
  created_at: string;
}

const ADMIN_MEMBERS_SELECT = `
  SELECT m.id, m.user_id, m.organization_id, o.name AS org_name,
         u.first_name, u.last_name, u.email, m.member_type, m.status, m.show_on_org_profile, m.created_at
  FROM members m
  LEFT JOIN organizations o ON o.id = m.organization_id
  JOIN users u ON u.id = m.user_id
`;

function toAdminMemberSummary(row: AdminMemberRow): AdminMemberSummary {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    organizationName: row.org_name,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    email: row.email,
    membershipCategory: row.member_type,
    status: row.status,
    showOnOrgProfile: row.show_on_org_profile === 1,
    createdAt: row.created_at,
  };
}

/**
 * Unfiltered-by-status admin listing — one row per representative, unlike
 * the public directory (members-directory.ts) which collapses each
 * organization to a single "primary contact" row and only shows
 * status='active' members.
 */
export async function listAdminMembers(
  db: DatabaseLike,
  params: { limit: number; offset: number },
): Promise<{ members: AdminMemberSummary[]; total: number }> {
  const [rows, totalRow] = await Promise.all([
    all<AdminMemberRow>(db, `${ADMIN_MEMBERS_SELECT} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`, [
      params.limit,
      params.offset,
    ]),
    first<{ total: number }>(db, `SELECT COUNT(*) AS total FROM members`),
  ]);

  return { members: rows.map(toAdminMemberSummary), total: totalRow?.total ?? 0 };
}
