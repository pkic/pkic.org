/**
 * Interim Admin Tool (Interim Admin Tool — Manual Member
 * Management). Creates an organization (or org-less individual) plus
 * representative(s) directly, and lists every representative/individual
 * for the admin UI (unfiltered by status, unlike the public directory in
 * members-directory.ts which only surfaces active members).
 */
import { all, first } from "../db/queries";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { buildFindOrCreateUserStatement, type UserRecord } from "./users";
import { normalizeOrgName } from "./sponsorship";
import { getWorkingGroupBySlugOrId, buildAddWorkingGroupMemberStatements } from "./working-groups";
import {
  getOrCreateOrganizationMemberAggregate,
  buildCreateIndividualMemberStatements,
} from "./membership/memberships";
import { buildAddRepresentativeStatement } from "./membership/representatives";
import { REPRESENTATIVE_ROLE_IDS, buildAssignRepresentativeRoleStatements } from "./membership/representative-roles";
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
 * Creates (or reuses) one membership aggregate plus N representative rows
 * (org-tied) or one individual aggregate (org-less). Idempotent on the
 * organization (an existing org with the same normalized name is reused,
 * matching the migration script's upsert convention).
 *
 * The aggregate is resolved first via `getOrCreateOrganizationMemberAggregate`
 * (its own small race-safe batch+read, org-tied case only), then every
 * remaining write — user resolution, representative rows, representative
 * role grants, working-group membership — lands in one atomic `db.batch()`.
 */
export async function createAdminMember(
  db: DatabaseLike,
  input: AdminMemberCreateInput,
): Promise<{ organizationId: string | null; members: AdminMemberSummary[] }> {
  const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(input.membershipCategory);
  const now = nowIso();

  if (isIndividual) {
    const rep = input.representatives[0];
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

    const { firstName, lastName } = splitName(rep.name);
    const { user, statement: userStatement } = await buildFindOrCreateUserStatement(db, {
      email: rep.email,
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      jobTitle: rep.role,
      linksJson: rep.linkedin ? serializeLinks([rep.linkedin]) : null,
      allowProfileUpdate: true,
    });

    const statements: StatementLike[] = [];
    if (userStatement) statements.push(userStatement);
    const { memberId, statements: memberStatements } = buildCreateIndividualMemberStatements(
      db,
      user.id,
      input.membershipCategory,
      now,
    );
    statements.push(...memberStatements);
    statements.push(db.prepare("UPDATE members SET member_since = ? WHERE id = ?").bind(input.memberSince, memberId));

    for (const slug of input.workingGroupSlugs) {
      const wg = await getWorkingGroupBySlugOrId(db, slug);
      if (!wg) continue;
      statements.push(...(await buildAddWorkingGroupMemberStatements(db, wg, user.id)));
    }

    await db.batch(statements);

    return {
      organizationId: null,
      members: [
        {
          id: memberId,
          userId: user.id,
          organizationId: null,
          organizationName: null,
          name: rep.name,
          email: user.email,
          membershipCategory: input.membershipCategory,
          status: "active",
          showOnOrgProfile: true,
          createdAt: now,
        },
      ],
    };
  }

  const normalizedOrgName = normalizeOrgName(input.organizationName as string);
  const existingOrg = await first<{ id: string }>(db, "SELECT id FROM organizations WHERE normalized_name = ?", [
    normalizedOrgName,
  ]);

  let organizationId: string;
  if (existingOrg) {
    organizationId = existingOrg.id;
  } else {
    organizationId = uuid();
    await db
      .prepare(
        `INSERT INTO organizations (id, name, normalized_name, data_json, description, website, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .bind(
        organizationId,
        input.organizationName,
        normalizedOrgName,
        input.description ?? null,
        input.website ?? null,
        now,
        now,
      )
      .run();
  }

  const aggregate = await getOrCreateOrganizationMemberAggregate(db, organizationId, input.membershipCategory, now);
  await db
    .prepare("UPDATE members SET member_since = COALESCE(member_since, ?) WHERE id = ?")
    .bind(input.memberSince, aggregate.id)
    .run();

  for (const rep of input.representatives) {
    const existingUser = await first<{ id: string }>(db, "SELECT id FROM users WHERE normalized_email = ?", [
      normalizeEmail(rep.email),
    ]);
    if (existingUser) {
      const alreadyRepresenting = await first<{ id: string }>(
        db,
        "SELECT id FROM organization_representatives WHERE member_id = ? AND user_id = ? AND left_at IS NULL",
        [aggregate.id, existingUser.id],
      );
      if (alreadyRepresenting) {
        throw new AppError(409, "ALREADY_MEMBER", `${rep.email} already represents this organization`);
      }
    }
  }

  const statements: StatementLike[] = [];
  const users: UserRecord[] = [];
  const representativeIds: string[] = [];

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

    const { representativeId, statement: repStatement } = buildAddRepresentativeStatement(db, {
      memberId: aggregate.id,
      userId: user.id,
      now,
    });
    representativeIds.push(representativeId);
    statements.push(repStatement);

    for (const slug of input.workingGroupSlugs) {
      const wg = await getWorkingGroupBySlugOrId(db, slug);
      if (!wg) continue;
      statements.push(...(await buildAddWorkingGroupMemberStatements(db, wg, user.id)));
    }
  }

  await db.batch(statements);

  // Representative role grants run after the representative rows commit —
  // buildAssignRepresentativeRoleStatements verifies an active
  // organization_representatives row exists before granting, so it must
  // observe the rows just inserted above.
  const roleStatements: StatementLike[] = [];
  if (input.representatives.length >= 1) {
    roleStatements.push(
      ...(await buildAssignRepresentativeRoleStatements(db, {
        memberId: aggregate.id,
        userId: users[0].id,
        roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
        now,
      })),
    );
  }
  if (input.representatives.length >= 2) {
    roleStatements.push(
      ...(await buildAssignRepresentativeRoleStatements(db, {
        memberId: aggregate.id,
        userId: users[1].id,
        roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
        now,
      })),
    );
  }
  if (roleStatements.length > 0) {
    await db.batch(roleStatements);
  }

  const members: AdminMemberSummary[] = input.representatives.map((rep, index) => ({
    id: representativeIds[index],
    userId: users[index].id,
    organizationId,
    organizationName: input.organizationName ?? null,
    name: rep.name,
    email: users[index].email,
    membershipCategory: aggregate.categoryCode,
    status: "active",
    showOnOrgProfile: true,
    createdAt: now,
  }));

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
  category_code: string;
  status: string;
  show_on_org_profile: number;
  created_at: string;
}

// One row per individual member (organization_id IS NULL) unioned with one
// row per active organization representative — a single bounded, sorted
// query so LIMIT/OFFSET apply to the combined set once, not to each half
// independently (which would produce wrong pages beyond page 1).
const ADMIN_MEMBERS_SELECT = `
  SELECT m.id AS id, m.user_id, NULL AS organization_id, NULL AS org_name,
         u.first_name, u.last_name, u.email, mca.category_code, m.status,
         1 AS show_on_org_profile, m.created_at
  FROM members m
  JOIN users u ON u.id = m.user_id
  JOIN member_category_assignments mca ON mca.member_id = m.id
  WHERE m.organization_id IS NULL

  UNION ALL

  SELECT r.id AS id, r.user_id, m.organization_id, o.name AS org_name,
         u.first_name, u.last_name, u.email, mca.category_code, m.status,
         r.show_on_org_profile, r.created_at
  FROM organization_representatives r
  JOIN members m ON m.id = r.member_id
  JOIN organizations o ON o.id = m.organization_id
  JOIN users u ON u.id = r.user_id
  JOIN member_category_assignments mca ON mca.member_id = m.id
  WHERE r.left_at IS NULL
`;

function toAdminMemberSummary(row: AdminMemberRow): AdminMemberSummary {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    organizationName: row.org_name,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    email: row.email,
    membershipCategory: row.category_code,
    status: row.status,
    showOnOrgProfile: row.show_on_org_profile === 1,
    createdAt: row.created_at,
  };
}

/**
 * Unfiltered-by-status admin listing — one row per individual member or
 * per active organization representative, unlike the public directory
 * (members-directory.ts) which collapses each organization to a single
 * "primary contact" row and only shows status='active' members.
 */
export async function listAdminMembers(
  db: DatabaseLike,
  params: { limit: number; offset: number },
): Promise<{ members: AdminMemberSummary[]; total: number }> {
  const [rows, totalRow] = await Promise.all([
    all<AdminMemberRow>(
      db,
      `SELECT * FROM (${ADMIN_MEMBERS_SELECT}) combined ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [params.limit, params.offset],
    ),
    first<{ total: number }>(db, `SELECT COUNT(*) AS total FROM (${ADMIN_MEMBERS_SELECT}) combined`),
  ]);

  return { members: rows.map(toAdminMemberSummary), total: totalRow?.total ?? 0 };
}
