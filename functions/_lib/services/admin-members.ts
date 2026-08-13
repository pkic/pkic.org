/**
 * Interim Admin Tool Interim Admin Tool — Manual Member
 * Management). Creates an organization (or org-less
 * individual) plus representative(s) plus member row(s) directly, and
 * lists every `members` row for the admin UI (unfiltered by status,
 * unlike the public directory in members-directory.ts which only
 * surfaces one "primary" row per organization).
 */
import { all, first } from "../db/queries";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { buildFindOrCreateUserStatement, type UserRecord } from "./users";
import { normalizeOrgName } from "./sponsorship";
import { getWorkingGroupBySlugOrId, buildAddWorkingGroupMemberStatements } from "./working-groups";
import { AppError } from "../errors";
import { serializeLinks } from "../../../assets/shared/schemas/api";
import { INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "../../../assets/shared/schemas/membership-categories";
import type { DatabaseLike, StatementLike } from "../types";

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
 * Creates active organizations/users/members(/working_group_members) rows.
 * Idempotent on the organization (an existing org with the same normalized
 * name is reused, matching the migration script's upsert convention), but
 * NOT on membership: `members.user_id` is UNIQUE, so a representative who
 * already holds a membership causes the whole request to fail with 409
 * before anything is written — this is an interactive admin tool, not a
 * bulk import, so a silent no-op (the migration script's behavior) would be
 * a confusing UX here.
 *
 * Every write past the pre-flight checks lands in one atomic `db.batch()`
 * — user resolution (via `buildFindOrCreateUserStatement`, unexecuted
 * until the batch runs), organization create/update, member rows,
 * primary/secondary contact assignment, and working-group membership (via
 * working-groups.ts's canonical `buildAddWorkingGroupMemberStatements`,
 * not a reimplementation) — so a later failure can't leave a partially
 * provisioned membership or an orphaned `users` row.
 */
export async function createAdminMember(
  db: DatabaseLike,
  input: AdminMemberCreateInput,
): Promise<{ organizationId: string | null; members: AdminMemberSummary[] }> {
  const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(input.membershipCategory);
  const now = nowIso();

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
  let isNewOrganization = false;

  if (!isIndividual && input.organizationName) {
    const normalizedOrgName = normalizeOrgName(input.organizationName);
    const existingOrg = await first<{ id: string }>(db, "SELECT id FROM organizations WHERE normalized_name = ?", [
      normalizedOrgName,
    ]);

    if (existingOrg) {
      organizationId = existingOrg.id;
    } else {
      organizationId = uuid();
      isNewOrganization = true;
    }
  }

  const statements: StatementLike[] = [];
  const users: UserRecord[] = [];
  for (const rep of input.representatives) {
    const { firstName, lastName } = splitName(rep.name);
    const { user, statement } = await buildFindOrCreateUserStatement(db, {
      email: rep.email,
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      jobTitle: rep.role,
      linksJson: rep.linkedin ? serializeLinks([rep.linkedin]) : null,
      allowProfileUpdate: true,
    });
    users.push(user);
    if (statement) statements.push(statement);
  }

  if (organizationId && isNewOrganization) {
    statements.push(
      db
        .prepare(
          `INSERT INTO organizations (id, name, normalized_name, data_json, description, website, membership_category, member_since, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          organizationId,
          input.organizationName,
          normalizeOrgName(input.organizationName as string),
          input.description ?? null,
          input.website ?? null,
          input.membershipCategory,
          input.memberSince,
          now,
          now,
        ),
    );
  } else if (organizationId) {
    // Category is an organization-level fact (migration 0040). Keep it (and
    // every existing org-tied representative's member_type mirror) in sync
    // with what was just submitted — matters when this call reuses an
    // existing organization rather than creating a new one.
    statements.push(
      db
        .prepare("UPDATE organizations SET membership_category = ?, updated_at = ? WHERE id = ?")
        .bind(input.membershipCategory, now, organizationId),
      // Don't clobber an already-set member_since (e.g. from the
      // migration script) just because this submission reuses an existing
      // organization.
      db
        .prepare("UPDATE organizations SET member_since = ?, updated_at = ? WHERE id = ? AND member_since IS NULL")
        .bind(input.memberSince, now, organizationId),
      db
        .prepare("UPDATE members SET member_type = ?, updated_at = ? WHERE organization_id = ?")
        .bind(input.membershipCategory, now, organizationId),
    );
  }

  const members: AdminMemberSummary[] = [];

  for (const [index, rep] of input.representatives.entries()) {
    const user = users[index];
    const memberId = uuid();
    statements.push(
      db
        .prepare(
          `INSERT INTO members (id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at, show_on_org_profile, member_since)
           VALUES (?, ?, ?, ?, 'active', NULL, NULL, ?, ?, 1, ?)`,
        )
        .bind(memberId, input.membershipCategory, user.id, organizationId, now, now, input.memberSince),
    );

    if (organizationId && index === 0) {
      statements.push(
        db
          .prepare(
            `UPDATE organizations SET primary_contact_user_id = ?, updated_at = ? WHERE id = ? AND primary_contact_user_id IS NULL`,
          )
          .bind(user.id, now, organizationId),
      );
    }
    if (organizationId && index === 1) {
      statements.push(
        db
          .prepare(
            `UPDATE organizations SET secondary_contact_user_id = ?, updated_at = ? WHERE id = ? AND secondary_contact_user_id IS NULL`,
          )
          .bind(user.id, now, organizationId),
      );
    }

    for (const slug of input.workingGroupSlugs) {
      const wg = await getWorkingGroupBySlugOrId(db, slug);
      if (!wg) continue;
      statements.push(...(await buildAddWorkingGroupMemberStatements(db, wg, user.id)));
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

  if (statements.length > 0) {
    await db.batch(statements);
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
