/**
 * Canonical organization/individual membership provisioning use case
 * (Phase 1 §1.5). Creates (or reuses) an organization, its shared
 * membership aggregate, N representative rows (or N individual aggregates
 * for an individual-only category), primary/secondary contact role grants,
 * and working-group membership.
 *
 * Called identically by admin creation (admin-members.ts's
 * `createAdminMember`) and application-approval provisioning
 * (applications/approve.ts's `approveApplication`) — these were
 * previously two independent implementations of the same orchestration
 * (PR #1 review finding: duplicate `INSERT INTO members` logic with
 * slightly different column lists). Both now call this one function and
 * map its result onto their own existing response shape.
 *
 * Atomicity: `getOrCreateOrganizationMemberAggregate` is its own small
 * race-safe get-or-create unit (INSERT OR IGNORE + unconditional re-read —
 * see memberships.ts) and organization/domain creation must commit before
 * it so the aggregate's FK resolves; every write after that — user
 * resolution, representative rows, working-group membership, and contact
 * role grants — lands in one `db.batch()`. Role grants use
 * `buildAssignRepresentativeRoleStatementsForNewRepresentative` (skips the
 * active-representative DB check) rather than
 * `buildAssignRepresentativeRoleStatements`, because the representative row
 * being granted a role is itself being inserted earlier in this same
 * batch — a DB read couldn't see it yet, and the invariant holds by
 * construction.
 */
import { first } from "../../db/queries";
import { normalizeEmail } from "../../validation";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { AppError } from "../../errors";
import { buildFindOrCreateUserStatement, type UserRecord } from "../users";
import { normalizeOrgName } from "../sponsorship";
import { getWorkingGroupBySlugOrId, buildAddWorkingGroupMemberStatements } from "../working-groups";
import { getOrCreateOrganizationMemberAggregate, buildCreateIndividualMemberStatements } from "./memberships";
import { buildAddRepresentativeStatement, isActiveRepresentative } from "./representatives";
import {
  REPRESENTATIVE_ROLE_IDS,
  buildAssignRepresentativeRoleStatementsForNewRepresentative,
  resolveRepresentativeRoleHolders,
} from "./representative-roles";
import { serializeLinks } from "../../../../assets/shared/schemas/api";
import { INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "../../../../assets/shared/schemas/membership-categories";
import type { DatabaseLike, StatementLike } from "../../types";

export interface ProvisionRepresentativeInput {
  name: string;
  email: string;
  jobTitle?: string | null;
  linkedin?: string | null;
}

export interface ProvisionMembershipInput {
  organizationName?: string | null;
  website?: string | null;
  description?: string | null;
  organizationDomain?: string | null;
  membershipCategory: string;
  /** Only applied when given; the organization-tied path never overwrites an already-set member_since. */
  memberSince?: string | null;
  representatives: ProvisionRepresentativeInput[];
  workingGroupSlugs: string[];
  /** Reject (409) a representative who already holds/represents the target membership. Default true. */
  rejectExistingMembership?: boolean;
  /** Only assign primary/secondary contact roles when the organization has no existing holder yet (never silently reassign an already-contacted org's contacts). Default true. */
  onlyAssignContactRolesIfVacant?: boolean;
}

export interface ProvisionedRepresentative {
  userId: string;
  email: string;
  name: string;
  organizationId: string | null;
  /** members.id — the shared aggregate for an organization, or this person's own individual aggregate. */
  membershipId: string;
  /** organization_representatives.id — null for an individual (org-less) membership. */
  representativeId: string | null;
  /** True only when this call just assigned this person as primary/secondary contact (not on an already-contacted org). */
  assignedContactRole: "primary" | "secondary" | null;
  /** The timestamp actually written to this representative's row(s), for callers that echo it back without a re-read. */
  createdAt: string;
}

export interface ProvisionMembershipResult {
  organizationId: string | null;
  organizationWasCreated: boolean;
  representatives: ProvisionedRepresentative[];
}

function splitName(fullName: string): { firstName: string | null; lastName: string | null } {
  const tokens = fullName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: null, lastName: null };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: null };
  return { firstName: tokens.slice(0, -1).join(" "), lastName: tokens[tokens.length - 1] };
}

async function buildRepresentativeUserStatement(db: DatabaseLike, rep: ProvisionRepresentativeInput) {
  const { firstName, lastName } = splitName(rep.name);
  return buildFindOrCreateUserStatement(db, {
    email: rep.email,
    firstName: firstName ?? undefined,
    lastName: lastName ?? undefined,
    jobTitle: rep.jobTitle ?? undefined,
    linksJson: rep.linkedin ? serializeLinks([rep.linkedin]) : null,
    allowProfileUpdate: true,
  });
}

async function provisionIndividualMemberships(
  db: DatabaseLike,
  input: ProvisionMembershipInput,
  now: string,
): Promise<ProvisionMembershipResult> {
  const rejectExisting = input.rejectExistingMembership ?? true;
  const statements: StatementLike[] = [];
  const representatives: ProvisionedRepresentative[] = [];

  for (const rep of input.representatives) {
    if (rejectExisting) {
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

    const { user, statement: userStatement } = await buildRepresentativeUserStatement(db, rep);
    if (userStatement) statements.push(userStatement);

    const { memberId, statements: memberStatements } = buildCreateIndividualMemberStatements(
      db,
      user.id,
      input.membershipCategory,
      now,
    );
    statements.push(...memberStatements);
    if (input.memberSince) {
      statements.push(db.prepare("UPDATE members SET member_since = ? WHERE id = ?").bind(input.memberSince, memberId));
    }

    for (const slug of input.workingGroupSlugs) {
      const wg = await getWorkingGroupBySlugOrId(db, slug);
      if (!wg) continue;
      statements.push(...(await buildAddWorkingGroupMemberStatements(db, wg, user.id)));
    }

    representatives.push({
      userId: user.id,
      email: user.email,
      name: rep.name,
      organizationId: null,
      membershipId: memberId,
      representativeId: null,
      assignedContactRole: null,
      createdAt: now,
    });
  }

  if (statements.length > 0) await db.batch(statements);
  return { organizationId: null, organizationWasCreated: false, representatives };
}

async function resolveOrganizationId(
  db: DatabaseLike,
  input: ProvisionMembershipInput,
): Promise<{ organizationId: string; organizationWasCreated: boolean }> {
  const normalizedOrgName = normalizeOrgName(input.organizationName as string);
  const existingOrg = await first<{ id: string }>(db, "SELECT id FROM organizations WHERE normalized_name = ?", [
    normalizedOrgName,
  ]);
  if (existingOrg) {
    return { organizationId: existingOrg.id, organizationWasCreated: false };
  }

  const organizationId = uuid();
  const now = nowIso();
  const preStatements: StatementLike[] = [
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
  ];
  if (input.organizationDomain) {
    preStatements.push(
      db
        .prepare(`INSERT INTO organization_domains (id, organization_id, domain, created_at) VALUES (?, ?, ?, ?)`)
        .bind(uuid(), organizationId, input.organizationDomain, now),
    );
  }
  await db.batch(preStatements);
  return { organizationId, organizationWasCreated: true };
}

async function provisionOrganizationTiedMemberships(
  db: DatabaseLike,
  input: ProvisionMembershipInput,
  now: string,
): Promise<ProvisionMembershipResult> {
  const rejectExisting = input.rejectExistingMembership ?? true;
  const onlyIfVacant = input.onlyAssignContactRolesIfVacant ?? true;

  const { organizationId, organizationWasCreated } = await resolveOrganizationId(db, input);

  const aggregate = await getOrCreateOrganizationMemberAggregate(db, organizationId, input.membershipCategory, now);
  if (input.memberSince) {
    await db
      .prepare("UPDATE members SET member_since = COALESCE(member_since, ?) WHERE id = ?")
      .bind(input.memberSince, aggregate.id)
      .run();
  }

  if (rejectExisting) {
    for (const rep of input.representatives) {
      const existingUser = await first<{ id: string }>(db, "SELECT id FROM users WHERE normalized_email = ?", [
        normalizeEmail(rep.email),
      ]);
      if (existingUser) {
        const alreadyRepresenting = await isActiveRepresentative(db, aggregate.id, existingUser.id);
        if (alreadyRepresenting) {
          throw new AppError(409, "ALREADY_MEMBER", `${rep.email} already represents this organization`);
        }
      }
    }
  }

  const existingHolders = onlyIfVacant
    ? await resolveRepresentativeRoleHolders(db, aggregate.id)
    : { primaryContactUserId: null, secondaryContactUserId: null, votingDelegateUserId: null };

  const statements: StatementLike[] = [];
  const pending: { rep: ProvisionRepresentativeInput; user: UserRecord; representativeId: string }[] = [];

  for (const rep of input.representatives) {
    const { user, statement: userStatement } = await buildRepresentativeUserStatement(db, rep);
    if (userStatement) statements.push(userStatement);

    const { representativeId, statement: repStatement } = buildAddRepresentativeStatement(db, {
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

    pending.push({ rep, user, representativeId });
  }

  const assignedContactRoles: ("primary" | "secondary" | null)[] = pending.map(() => null);
  if (!existingHolders.primaryContactUserId && pending.length >= 1) {
    statements.push(
      ...buildAssignRepresentativeRoleStatementsForNewRepresentative(db, {
        memberId: aggregate.id,
        userId: pending[0].user.id,
        roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
        now,
      }),
    );
    assignedContactRoles[0] = "primary";
  }
  if (!existingHolders.secondaryContactUserId && pending.length >= 2) {
    statements.push(
      ...buildAssignRepresentativeRoleStatementsForNewRepresentative(db, {
        memberId: aggregate.id,
        userId: pending[1].user.id,
        roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
        now,
      }),
    );
    assignedContactRoles[1] = "secondary";
  }

  if (statements.length > 0) await db.batch(statements);

  const representatives: ProvisionedRepresentative[] = pending.map(({ rep, user, representativeId }, index) => ({
    userId: user.id,
    email: user.email,
    name: rep.name,
    organizationId,
    membershipId: aggregate.id,
    representativeId,
    assignedContactRole: assignedContactRoles[index],
    createdAt: now,
  }));

  return { organizationId, organizationWasCreated, representatives };
}

export async function provisionOrganizationMembership(
  db: DatabaseLike,
  input: ProvisionMembershipInput,
): Promise<ProvisionMembershipResult> {
  const now = nowIso();
  const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(input.membershipCategory);
  if (isIndividual || !input.organizationName) {
    return provisionIndividualMemberships(db, input, now);
  }
  return provisionOrganizationTiedMemberships(db, input, now);
}
