/**
 * Shared organization/user/member/working-group-membership creation logic
 * (approval onboarding). Mirrors `admin-members.ts`'s `createAdminMember`
 * (Interim Admin Tool) shape — kept as a separate function rather than a
 * refactor of that already-shipped, tested path, to avoid regression risk
 * on working code; both build on the same underlying primitives
 * (`buildFindOrCreateUserStatement`, `normalizeOrgName`,
 * `buildAddWorkingGroupMemberStatements`,
 * `getOrCreateOrganizationMemberAggregate`, representative/role builders).
 *
 * Adds one thing the Interim Admin Tool didn't need: recording an
 * `organization_domains` row at creation time, closing the duplicate-check
 * gap for organizations approved through this flow going forward (see
 * hasConflictingOrganizationDomain in member-applications.ts).
 */
import { first } from "../db/queries";
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
import { serializeLinks } from "../../../assets/shared/schemas/api";
import { INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "../../../assets/shared/schemas/membership-categories";
import type { DatabaseLike, StatementLike } from "../types";

export interface ProvisionRepresentative {
  name: string;
  email: string;
  jobTitle?: string | null;
  linkedin?: string | null;
}

export interface ProvisionOrganizationAndMembersInput {
  organizationName?: string | null;
  website?: string | null;
  description?: string | null;
  organizationDomain?: string | null;
  membershipCategory: string;
  representatives: ProvisionRepresentative[];
  workingGroupSlugs: string[];
}

export interface ProvisionedMember {
  memberId: string;
  userId: string;
  email: string;
  name: string;
  organizationId: string | null;
  /** True only when this call just assigned this person as primary/secondary contact (not on an already-contacted org). */
  assignedContactRole: "primary" | "secondary" | null;
}

export interface ProvisionOrganizationAndMembersResult {
  organizationId: string | null;
  organizationWasCreated: boolean;
  members: ProvisionedMember[];
}

function splitName(fullName: string): { firstName: string | null; lastName: string | null } {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: null, lastName: null };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: null };
  return { firstName: tokens.slice(0, -1).join(" "), lastName: tokens[tokens.length - 1] };
}

export async function provisionOrganizationAndMembers(
  db: DatabaseLike,
  input: ProvisionOrganizationAndMembersInput,
): Promise<ProvisionOrganizationAndMembersResult> {
  const now = nowIso();
  const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(input.membershipCategory);

  if (isIndividual || !input.organizationName) {
    // Org-less individual (H5/H6/H7): one aggregate per representative,
    // same as the admin tool's individual path.
    const statements: StatementLike[] = [];
    const members: ProvisionedMember[] = [];
    for (const rep of input.representatives) {
      const { firstName, lastName } = splitName(rep.name);
      const { user, statement: userStatement } = await buildFindOrCreateUserStatement(db, {
        email: rep.email,
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        jobTitle: rep.jobTitle ?? undefined,
        linksJson: rep.linkedin ? serializeLinks([rep.linkedin]) : null,
        allowProfileUpdate: true,
      });
      if (userStatement) statements.push(userStatement);
      const { memberId, statements: memberStatements } = buildCreateIndividualMemberStatements(
        db,
        user.id,
        input.membershipCategory,
        now,
      );
      statements.push(...memberStatements);
      members.push({
        memberId,
        userId: user.id,
        email: user.email,
        name: rep.name,
        organizationId: null,
        assignedContactRole: null,
      });
    }
    if (statements.length > 0) await db.batch(statements);
    return { organizationId: null, organizationWasCreated: false, members };
  }

  let organizationId: string;
  let organizationWasCreated = false;

  const normalizedOrgName = normalizeOrgName(input.organizationName);
  const existingOrg = await first<{ id: string }>(db, "SELECT id FROM organizations WHERE normalized_name = ?", [
    normalizedOrgName,
  ]);

  const preStatements: StatementLike[] = [];
  if (existingOrg) {
    organizationId = existingOrg.id;
  } else {
    organizationId = uuid();
    organizationWasCreated = true;
    preStatements.push(
      db
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
        ),
    );
    if (input.organizationDomain) {
      preStatements.push(
        db
          .prepare(`INSERT INTO organization_domains (id, organization_id, domain, created_at) VALUES (?, ?, ?, ?)`)
          .bind(uuid(), organizationId, input.organizationDomain, now),
      );
    }
  }
  if (preStatements.length > 0) await db.batch(preStatements);

  const aggregate = await getOrCreateOrganizationMemberAggregate(db, organizationId, input.membershipCategory, now);

  const statements: StatementLike[] = [];
  const pending: { rep: ProvisionRepresentative; user: UserRecord }[] = [];

  for (const [index, rep] of input.representatives.entries()) {
    const { firstName, lastName } = splitName(rep.name);
    const { user, statement: userStatement } = await buildFindOrCreateUserStatement(db, {
      email: rep.email,
      firstName: firstName ?? undefined,
      lastName: lastName ?? undefined,
      jobTitle: rep.jobTitle ?? undefined,
      linksJson: rep.linkedin ? serializeLinks([rep.linkedin]) : null,
      allowProfileUpdate: true,
    });
    if (userStatement) statements.push(userStatement);

    const { statement: repStatement } = buildAddRepresentativeStatement(db, {
      memberId: aggregate.id,
      userId: user.id,
      now,
    });
    statements.push(repStatement);

    for (const slug of input.workingGroupSlugs) {
      const wg = await getWorkingGroupBySlugOrId(db, slug);
      if (!wg) continue;
      statements.push(...(await buildAddWorkingGroupMemberStatements(db, wg, user.id)));
    }

    pending.push({ rep, user });
    void index;
  }

  if (statements.length > 0) await db.batch(statements);

  // Only assign primary/secondary contact when the organization has none
  // yet — reusing an already-contacted organization must not silently
  // reassign its existing contacts.
  const existingHolders = await first<{ primary: string | null; secondary: string | null }>(
    db,
    `SELECT
       (SELECT user_id FROM user_roles WHERE context_type = 'organization' AND context_id = ? AND role_id = ? AND revoked_at IS NULL) AS "primary",
       (SELECT user_id FROM user_roles WHERE context_type = 'organization' AND context_id = ? AND role_id = ? AND revoked_at IS NULL) AS "secondary"`,
    [aggregate.id, REPRESENTATIVE_ROLE_IDS.primaryContact, aggregate.id, REPRESENTATIVE_ROLE_IDS.secondaryContact],
  );

  const roleStatements: StatementLike[] = [];
  const assignedContactRoles: ("primary" | "secondary" | null)[] = pending.map(() => null);
  if (!existingHolders?.primary && pending.length >= 1) {
    roleStatements.push(
      ...(await buildAssignRepresentativeRoleStatements(db, {
        memberId: aggregate.id,
        userId: pending[0].user.id,
        roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
        now,
      })),
    );
    assignedContactRoles[0] = "primary";
  }
  if (!existingHolders?.secondary && pending.length >= 2) {
    roleStatements.push(
      ...(await buildAssignRepresentativeRoleStatements(db, {
        memberId: aggregate.id,
        userId: pending[1].user.id,
        roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
        now,
      })),
    );
    assignedContactRoles[1] = "secondary";
  }
  if (roleStatements.length > 0) await db.batch(roleStatements);

  const members: ProvisionedMember[] = pending.map(({ rep, user }, index) => ({
    memberId: aggregate.id,
    userId: user.id,
    email: user.email,
    name: rep.name,
    organizationId,
    assignedContactRole: assignedContactRoles[index],
  }));

  return { organizationId, organizationWasCreated, members };
}
