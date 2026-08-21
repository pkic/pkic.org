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
 * Atomicity: every write for the organization-tied path — organization,
 * domain, membership aggregate, category assignment, `member_since`,
 * representative rows, contact-role grants, and working-group memberships
 * — is built as statements (never executed) and committed exactly once in
 * a single `db.batch()` at the end of `provisionOrganizationTiedMemberships`.
 * Everything that decides *what* to build (does the organization/aggregate
 * already exist, is a contact role vacant, does a rejected-membership
 * conflict exist) is a plain read that runs before any statement is built
 * — never a branch on the result of an earlier write in the same request
 * — so a failure anywhere in the batch can never leave a
 * partially-provisioned organization (PR #1 review blocker 4: "the use
 * case should build one command set and commit once"). Role grants use
 * `buildAssignRepresentativeRoleStatementsForNewRepresentative` (skips the
 * active-representative DB check) rather than
 * `buildAssignRepresentativeRoleStatements`, because the representative row
 * being granted a role is itself being inserted earlier in this same
 * batch — a DB read couldn't see it yet, and the invariant holds by
 * construction. See buildResolveOrCreateAggregateStatements's own comment
 * for the one residual race this design accepts (a rare concurrent
 * request racing to create the aggregate for a *pre-existing*
 * organization fails its whole batch cleanly via a foreign-key check,
 * rather than writing anything against the wrong aggregate).
 */
import { first } from "../../db/queries";
import { normalizeEmail } from "../../validation";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { AppError } from "../../errors";
import { buildFindOrCreateUserStatement, type UserRecord } from "../users";
import { normalizeOrgName } from "../sponsorship";
import { getWorkingGroupBySlugOrId, buildAddWorkingGroupMemberStatements } from "../working-groups";
import {
  buildGetOrCreateOrganizationMemberAggregateStatements,
  buildCreateIndividualMemberStatements,
  readOrganizationMemberAggregate,
  assertNoAggregateCategoryConflict,
} from "./memberships";
import { buildAddRepresentativeStatement, isActiveRepresentative } from "./representatives";
import {
  REPRESENTATIVE_ROLE_IDS,
  buildAssignRepresentativeRoleStatementsForNewRepresentative,
  resolveRepresentativeRoleHolders,
} from "./representative-roles";
import { serializeLinks } from "../../../../assets/shared/schemas/links";
import { INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "../../../../assets/shared/schemas/membership-categories";
import { prepareClaimDomainForOrganization, prepareTransferApplicationDomainClaim } from "./organization-domain-claims";
import type { DatabaseLike, StatementLike } from "../../types";

export interface ProvisionRepresentativeInput {
  name: string;
  email: string;
  jobTitle?: string | null;
  links?: string[] | null;
}

export interface ProvisionMembershipInput {
  organizationName?: string | null;
  website?: string | null;
  description?: string | null;
  organizationDomain?: string | null;
  /** Set when approval transfers the application's existing domain claim. */
  domainClaimApplicationId?: string | null;
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
    linksJson: rep.links && rep.links.length > 0 ? serializeLinks(rep.links) : null,
    allowProfileUpdate: true,
  });
}

export interface BuiltProvisioning {
  statements: StatementLike[];
  /**
   * Constructs the final result after the caller commits `statements`
   * (via this module's own `db.batch()`, or folded into a larger one —
   * see membership/applications/approve.ts). Pure and synchronous: every
   * id and decision it reports was already resolved by a pre-batch read
   * before `statements` was built, so it needs no further DB access.
   */
  buildResult: () => ProvisionMembershipResult;
}

async function buildProvisionIndividualMemberships(
  db: DatabaseLike,
  input: ProvisionMembershipInput,
  now: string,
): Promise<BuiltProvisioning> {
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
      statements.push(...(await buildAddWorkingGroupMemberStatements(db, wg, user.id, memberId)));
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

  return {
    statements,
    buildResult: () => ({ organizationId: null, organizationWasCreated: false, representatives }),
  };
}

/**
 * Resolves (via a pre-batch read, not a write) whether the organization
 * already exists, and builds — without executing — the statements needed
 * to create it if not. The caller folds these into one final `db.batch()`
 * alongside the aggregate/representative/role statements, so organization
 * creation is no longer its own separate commit (PR #1 review blocker 4:
 * "Organization creation commits... member aggregate creation commits
 * separately... representatives/roles commit later").
 */
async function buildResolveOrganizationStatements(
  db: DatabaseLike,
  input: ProvisionMembershipInput,
  now: string,
): Promise<{ organizationId: string; organizationWasCreated: boolean; statements: StatementLike[] }> {
  const normalizedOrgName = normalizeOrgName(input.organizationName as string);
  const existingOrg = await first<{ id: string }>(db, "SELECT id FROM organizations WHERE normalized_name = ?", [
    normalizedOrgName,
  ]);
  if (existingOrg) {
    return { organizationId: existingOrg.id, organizationWasCreated: false, statements: [] };
  }

  const organizationId = uuid();
  const statements: StatementLike[] = [
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
  return { organizationId, organizationWasCreated: true, statements };
}

/**
 * Resolves (via a pre-batch read) whether the organization's shared
 * membership aggregate already exists, throwing the same
 * `MEMBER_CATEGORY_CONFLICT` `getOrCreateOrganizationMemberAggregate`
 * would — but *before* anything is built or written, not after a batch
 * that already committed representative/role rows against the wrong
 * aggregate. Builds the create statements only when no aggregate exists
 * yet. `INSERT OR IGNORE` in the built statements still guards the rare
 * concurrent-request race (two callers both see "no aggregate yet" for a
 * pre-existing organization and both mint their own id): the losing
 * batch's own aggregate insert is silently ignored, so its *subsequent*
 * representative-row insert in the same batch (referencing its own
 * unpersisted candidate id) fails its `member_id` foreign-key check —
 * the whole batch rolls back cleanly rather than writing a representative
 * against an aggregate that doesn't exist. For a brand-new organization
 * (created in this same batch) there is no such race at all: nothing else
 * can reference an organization id no other request has ever seen.
 */
async function buildResolveOrCreateAggregateStatements(
  db: DatabaseLike,
  organizationId: string,
  categoryCode: string,
  now: string,
): Promise<{ aggregateId: string; statements: StatementLike[] }> {
  const existing = await readOrganizationMemberAggregate(db, organizationId);
  if (existing) {
    assertNoAggregateCategoryConflict(existing, categoryCode);
    return { aggregateId: existing.id, statements: [] };
  }
  const { proposedId, statements } = buildGetOrCreateOrganizationMemberAggregateStatements(
    db,
    organizationId,
    categoryCode,
    now,
  );
  return { aggregateId: proposedId, statements };
}

/**
 * Every write this function makes — organization, aggregate, category
 * assignment, `member_since`, representative rows, contact-role grants,
 * and working-group memberships — is built here without executing
 * anything, then committed exactly once via a single `db.batch()` at the
 * end of `provisionOrganizationTiedMemberships`. All decisions about
 * *what* to build (does the org/aggregate already exist, is a contact
 * role vacant, does a rejected-membership conflict exist) are resolved by
 * plain reads before any statement is built, never by branching on the
 * result of an earlier write in the same request — so a failure anywhere
 * in the batch can never leave a partially-provisioned organization (PR
 * #1 review blocker 4).
 */
async function buildProvisionOrganizationTiedMemberships(
  db: DatabaseLike,
  input: ProvisionMembershipInput,
  now: string,
): Promise<BuiltProvisioning> {
  const rejectExisting = input.rejectExistingMembership ?? true;
  const onlyIfVacant = input.onlyAssignContactRolesIfVacant ?? true;

  const statements: StatementLike[] = [];

  const {
    organizationId,
    organizationWasCreated,
    statements: orgStatements,
  } = await buildResolveOrganizationStatements(db, input, now);
  statements.push(...orgStatements);

  if (input.organizationDomain) {
    const domainStatement = input.domainClaimApplicationId
      ? await prepareTransferApplicationDomainClaim(db, {
          domain: input.organizationDomain,
          applicationId: input.domainClaimApplicationId,
          organizationId,
          now,
        })
      : await prepareClaimDomainForOrganization(db, {
          domain: input.organizationDomain,
          organizationId,
          now,
        });
    if (domainStatement) statements.push(domainStatement);
  }

  const { aggregateId, statements: aggregateStatements } = await buildResolveOrCreateAggregateStatements(
    db,
    organizationId,
    input.membershipCategory,
    now,
  );
  statements.push(...aggregateStatements);

  if (input.memberSince) {
    statements.push(
      db
        .prepare("UPDATE members SET member_since = COALESCE(member_since, ?) WHERE id = ?")
        .bind(input.memberSince, aggregateId),
    );
  }

  if (rejectExisting) {
    for (const rep of input.representatives) {
      const existingUser = await first<{ id: string }>(db, "SELECT id FROM users WHERE normalized_email = ?", [
        normalizeEmail(rep.email),
      ]);
      if (existingUser) {
        const alreadyRepresenting = await isActiveRepresentative(db, aggregateId, existingUser.id);
        if (alreadyRepresenting) {
          throw new AppError(409, "ALREADY_MEMBER", `${rep.email} already represents this organization`);
        }
      }
    }
  }

  const existingHolders = onlyIfVacant
    ? await resolveRepresentativeRoleHolders(db, aggregateId)
    : { primaryContactUserId: null, secondaryContactUserId: null, votingDelegateUserId: null };

  const pending: { rep: ProvisionRepresentativeInput; user: UserRecord; representativeId: string }[] = [];

  for (const rep of input.representatives) {
    const { user, statement: userStatement } = await buildRepresentativeUserStatement(db, rep);
    if (userStatement) statements.push(userStatement);

    const { representativeId, statement: repStatement } = buildAddRepresentativeStatement(db, {
      memberId: aggregateId,
      userId: user.id,
      now,
    });
    statements.push(repStatement);

    for (const slug of input.workingGroupSlugs) {
      const wg = await getWorkingGroupBySlugOrId(db, slug);
      if (!wg) continue;
      statements.push(...(await buildAddWorkingGroupMemberStatements(db, wg, user.id, aggregateId)));
    }

    pending.push({ rep, user, representativeId });
  }

  const assignedContactRoles: ("primary" | "secondary" | null)[] = pending.map(() => null);
  if (!existingHolders.primaryContactUserId && pending.length >= 1) {
    statements.push(
      ...buildAssignRepresentativeRoleStatementsForNewRepresentative(db, {
        memberId: aggregateId,
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
        memberId: aggregateId,
        userId: pending[1].user.id,
        roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
        now,
      }),
    );
    assignedContactRoles[1] = "secondary";
  }

  return {
    statements,
    buildResult: () => ({
      organizationId,
      organizationWasCreated,
      representatives: pending.map(({ rep, user, representativeId }, index) => ({
        userId: user.id,
        email: user.email,
        name: rep.name,
        organizationId,
        membershipId: aggregateId,
        representativeId,
        assignedContactRole: assignedContactRoles[index],
        createdAt: now,
      })),
    }),
  };
}

/**
 * Builds every provisioning statement without executing anything — for
 * callers that need to fold this into a larger atomic `db.batch()`
 * alongside their own statements (e.g. membership/applications/approve.ts,
 * which commits provisioning together with the application's stage
 * transition and Google Groups sync enqueues in one boundary instead of
 * three).
 */
export async function buildProvisionOrganizationMembership(
  db: DatabaseLike,
  input: ProvisionMembershipInput,
): Promise<BuiltProvisioning> {
  const now = nowIso();
  const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(input.membershipCategory);
  if (isIndividual || !input.organizationName) {
    return buildProvisionIndividualMemberships(db, input, now);
  }
  return buildProvisionOrganizationTiedMemberships(db, input, now);
}

/** Builds and immediately commits, for callers that don't need to fold this into a larger batch. */
export async function provisionOrganizationMembership(
  db: DatabaseLike,
  input: ProvisionMembershipInput,
): Promise<ProvisionMembershipResult> {
  const { statements, buildResult } = await buildProvisionOrganizationMembership(db, input);
  if (statements.length > 0) await db.batch(statements);
  return buildResult();
}
