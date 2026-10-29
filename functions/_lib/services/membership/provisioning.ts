import {
  resolveProvisioningGroups,
  type ProvisionedGroup,
  type ProvisioningGroupSelection,
} from "./provisioning-groups";
/**
 * Canonical organization and individual membership provisioning.
 *
 * Application approval, staff provisioning, and imports use the same prepared
 * atomic command: organization, membership, identity, contact roles, and group
 * relationships commit together. Existing approved organization affiliations
 * are reused unchanged; membership is projected through their canonical link.
 *
 * All build decisions use pre-batch reads. Guarded identity reuse, unique
 * constraints, and the caller's approval/permission evidence reject stale
 * decisions inside the final batch. Ended affiliations retain their history;
 * a reviewed later period creates a successor rather than overwriting them.
 */
import { first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { buildIndividualMembershipIdentity } from "./individual-identity";
import { uuid } from "../../utils/ids";
import { AppError } from "../../errors";
import type { UserRecord } from "../users";
import { normalizeOrgName } from "../../../../assets/shared/organization-name";
import { buildGroupCapacityJoinStatements } from "../groups/membership";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import {
  buildGetOrCreateOrganizationMemberAggregateStatements,
  buildCreateIndividualMemberStatements,
  INDIVIDUAL_MEMBERSHIP_OF_USER_SQL,
  readOrganizationMemberAggregate,
  assertNoAggregateCategoryConflict,
} from "./memberships";
import { buildCreateIdentityStatement, isActiveIdentityForMember, type IdentitySource } from "./identities";
import {
  REPRESENTATIVE_ROLE_IDS,
  buildAssignRepresentativeRoleStatementsForNewRepresentative,
  resolveRepresentativeRoleHolders,
} from "./representative-roles";
import { serializeLinks } from "../../../../assets/shared/schemas/links";
import { requireProvisioningCategory } from "./provisioning-policy";
import { prepareClaimDomainForOrganization, prepareTransferApplicationDomainClaim } from "./organization-domain-claims";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareSitePublicationRequest } from "../site-publication-requests";
import { firstFreeSlug, slugifyOr } from "../../../../assets/shared/slug";
import { prepareExistingOrganizationAffiliation } from "./affiliation-reuse";

import { buildProvisioningUser, findProvisioningUser, type ProvisionIdentityInput } from "./provisioning-users";
export type { ProvisionIdentityInput } from "./provisioning-users";

export interface ProvisionMembershipInput extends ProvisioningGroupSelection {
  organizationName?: string | null;
  website?: string | null;
  description?: string | null;
  /** The organization's own profile links (canonical links contract). Only applied when the organization is created here. */
  links?: string[] | null;
  organizationDomain?: string | null;
  /** Set when approval transfers the application's existing domain claim. */
  domainClaimApplicationId?: string | null;
  /** Only applied when given; the organization-tied path never overwrites an already-set member_since. */
  memberSince?: string | null;
  identities: ProvisionIdentityInput[];
  /** Only the verified application continuation may assert mailbox proof. */
  mailboxVerified?: boolean;
  /** Provenance for the approved identity rows. */
  identitySource: IdentitySource;
  /** True only for an approved membership or a separately authorized staff activation. */
  activateIdentities: boolean;
  /** Backing users.id for relational role-grant attribution; null for synthetic/system actors. */
  grantedByUserId?: string | null;
  /** Reject (409) a representative who already holds/represents the target membership. Default true. */
  rejectExistingMembership?: boolean;
  /** Only assign primary/secondary contact roles when the organization has no existing holder yet (never silently reassign an already-contacted org's contacts). Default true. */
  onlyAssignContactRolesIfVacant?: boolean;
}

export interface ProvisionedIdentity {
  userId: string;
  email: string;
  name: string;
  organizationId: string | null;
  /** members.id — the shared aggregate for an organization, or this person's own individual aggregate. */
  membershipId: string;
  /** identities.id for the exact acting capacity created by this command. */
  identityId: string;
  /** True only when this call just assigned this person as primary/secondary contact (not on an already-contacted org). */
  assignedContactRole: "primary" | "secondary" | null;
  /** The timestamp actually written to this identity, for callers that echo it back without a re-read. */
  createdAt: string;
}

export interface ProvisionMembershipResult {
  organizationId: string | null;
  organizationWasCreated: boolean;
  identities: ProvisionedIdentity[];
  groups: ProvisionedGroup[];
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
  groups: readonly ProvisionedGroup[],
  now: string,
): Promise<BuiltProvisioning> {
  const rejectExisting = input.rejectExistingMembership ?? true;
  const statements: StatementLike[] = [];
  const identities: ProvisionedIdentity[] = [];

  for (const rep of input.identities) {
    if (rejectExisting) {
      const existingUser = await findProvisioningUser(db, rep.email, input.mailboxVerified);
      if (existingUser) {
        const existingMember = await first<{ id: string }>(db, INDIVIDUAL_MEMBERSHIP_OF_USER_SQL, [existingUser.id]);
        if (existingMember) {
          throw new AppError(409, "ALREADY_MEMBER", `${rep.email} already holds a membership`);
        }
      }
    }

    const { user, statements: userStatements } = await buildProvisioningUser(db, rep, input.mailboxVerified);
    statements.push(...userStatements);

    const { identityId, statements: identityStatements } = await buildIndividualMembershipIdentity(db, {
      userId: user.id,
      biography: rep.biography ?? null,
      linksJson: rep.links ? serializeLinks(rep.links) : null,
      source: input.identitySource,
      startImmediately: input.activateIdentities,
      now,
    });
    statements.push(...identityStatements);

    const { memberId, statements: memberStatements } = buildCreateIndividualMemberStatements(
      db,
      identityId,
      input.membershipCategory,
      now,
    );
    statements.push(...memberStatements);
    if (input.memberSince) {
      statements.push(db.prepare("UPDATE members SET member_since = ? WHERE id = ?").bind(input.memberSince, memberId));
    }

    if (input.activateIdentities) {
      for (const group of groups) {
        statements.push(
          ...buildGroupCapacityJoinStatements(db, {
            groupId: group.id,
            targetUserId: user.id,
            memberIds: [memberId],
            source: "staff",
            actorUserId: input.grantedByUserId ?? null,
            actorDatabaseUserId: input.grantedByUserId ?? null,
            allowManaged: input.allowManagedGroupEnrollment ?? true,
            at: now,
          }),
        );
      }
      statements.push(...prepareAutomaticGroupEnrollmentForUserStatements(db, user.id, now));
    }

    statements.push(
      prepareSitePublicationRequest(
        db,
        {
          resourceType: "membership",
          resourceId: memberId,
          revision: Date.parse(now),
          reasonCode: "membership_changed",
          deduplicationKey: `membership-provision:${memberId}:${crypto.randomUUID()}`,
        },
        {
          sql: "EXISTS(SELECT 1 FROM members WHERE id=? AND status='active')",
          bindings: [memberId],
        },
      ),
    );

    identities.push({
      userId: user.id,
      email: user.email,
      name: rep.name,
      organizationId: null,
      membershipId: memberId,
      identityId,
      assignedContactRole: null,
      createdAt: now,
    });
  }

  return {
    statements,
    buildResult: () => ({ organizationId: null, organizationWasCreated: false, identities, groups: [...groups] }),
  };
}

/**
 * Resolves (via a pre-batch read, not a write) whether the organization
 * already exists, and builds — without executing — the statements needed
 * to create it if not. The caller folds these into one final `db.batch()`
 * alongside the aggregate, identity, and role statements, so organization
 * creation is no longer its own separate commit (PR #1 review blocker 4:
 * "Organization creation commits... member aggregate creation commits
 * separately while identity and role statements commit later").
 */
/** The organization's own fields — all this builder reads, membership aside. */
export interface OrganizationRecordInput {
  organizationName?: string | null;
  website?: string | null;
  description?: string | null;
  links?: string[] | null;
}

export async function buildResolveOrganizationStatements(
  db: DatabaseLike,
  input: OrganizationRecordInput,
  now: string,
  observed?: { existingOrganizationId: string | null; takenSlugs: readonly string[] },
): Promise<{ organizationId: string; organizationWasCreated: boolean; statements: StatementLike[] }> {
  const normalizedOrgName = normalizeOrgName(input.organizationName as string);
  // A merged organization's name keeps meaning the organization it was merged into.
  const existingOrg = observed
    ? observed.existingOrganizationId
      ? { id: observed.existingOrganizationId }
      : null
    : await first<{ id: string }>(
        db,
        "SELECT COALESCE(merged_into_organization_id, id) AS id FROM organizations WHERE normalized_name = ?",
        [normalizedOrgName],
      );
  if (existingOrg) {
    return { organizationId: existingOrg.id, organizationWasCreated: false, statements: [] };
  }

  const organizationId = uuid();
  /*
   * The organization's public URL, decided here rather than left null.
   *
   * `organizations.slug` was introduced for the YAML import, which carried a
   * hand-written id per member, and nothing else ever wrote it — so an
   * organization created through the portal had no clean URL and its member
   * page fell back to `/members/profile/?id=<uuid>`, which is what issue #15
   * reports. The slug is decided once, at creation, and never rewritten by a
   * later rename: a member page other sites link to must not move because
   * somebody corrected a spelling.
   *
   * The read is one more pre-batch query alongside the normalized-name lookup
   * above; the unique index remains the authority, so a slug taken between
   * this read and the batch fails the insert rather than silently colliding.
   */
  const slug = await firstFreeSlug(slugifyOr(input.organizationName as string, "member"), async (candidate) =>
    observed
      ? observed.takenSlugs.includes(candidate)
      : Boolean(await first<{ id: string }>(db, "SELECT id FROM organizations WHERE slug = ?", [candidate])),
  );
  const statements: StatementLike[] = [
    db
      .prepare(
        `INSERT INTO organizations (id, name, normalized_name, slug, data_json, description, website, links_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      )
      .bind(
        organizationId,
        input.organizationName,
        normalizedOrgName,
        slug,
        input.description ?? null,
        input.website ?? null,
        input.links && input.links.length > 0 ? serializeLinks(input.links) : null,
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
 * and group memberships — is built here without executing
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
  groups: readonly ProvisionedGroup[],
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
  const publication = {
    resourceType: "membership",
    resourceId: aggregateId,
    revision: Date.parse(now),
    reasonCode: "membership_changed",
    deduplicationKey: `membership-provision:${aggregateId}:${crypto.randomUUID()}`,
  } as const;
  // Compare before filling member_since. The same receipt is reused after the new public identities are inserted.
  if (input.memberSince)
    statements.push(
      prepareSitePublicationRequest(db, publication, {
        sql: "EXISTS(SELECT 1 FROM members WHERE id=? AND status='active' AND member_since IS NULL)",
        bindings: [aggregateId],
      }),
    );

  if (input.memberSince) {
    statements.push(
      db
        .prepare("UPDATE members SET member_since = COALESCE(member_since, ?) WHERE id = ?")
        .bind(input.memberSince, aggregateId),
    );
  }

  if (rejectExisting) {
    for (const rep of input.identities) {
      const existingUser = await findProvisioningUser(db, rep.email, input.mailboxVerified);
      if (existingUser) {
        const alreadyRepresenting = await isActiveIdentityForMember(db, aggregateId, existingUser.id);
        if (alreadyRepresenting) {
          throw new AppError(409, "ALREADY_MEMBER", `${rep.email} already represents this organization`);
        }
      }
    }
  }

  const existingHolders = onlyIfVacant
    ? await resolveRepresentativeRoleHolders(db, aggregateId)
    : { primaryContactUserId: null, secondaryContactUserId: null };

  const publicIdentityIds: string[] = [];
  const pending: { rep: ProvisionIdentityInput; user: UserRecord; identityId: string; identityCreatedAt: string }[] =
    [];

  for (const rep of input.identities) {
    const { user, statements: userStatements } = await buildProvisioningUser(db, rep, input.mailboxVerified);
    statements.push(...userStatements);

    const existingAffiliation = input.activateIdentities
      ? await prepareExistingOrganizationAffiliation(db, user, organizationId, rep.email)
      : null;
    const prepared =
      existingAffiliation ??
      (await buildCreateIdentityStatement(db, {
        userId: user.id,
        organizationId,
        jobTitle: rep.jobTitle ?? null,
        biography: rep.biography ?? null,
        linksJson: rep.links ? serializeLinks(rep.links) : null,
        source: input.identitySource,
        startImmediately: input.activateIdentities,
        now,
      }));
    const identityId = prepared.identityId;
    if (!existingAffiliation && input.activateIdentities) publicIdentityIds.push(identityId);
    statements.push(prepared.statement);

    if (input.activateIdentities) {
      for (const group of groups) {
        statements.push(
          ...buildGroupCapacityJoinStatements(db, {
            groupId: group.id,
            targetUserId: user.id,
            memberIds: [aggregateId],
            source: "staff",
            actorUserId: input.grantedByUserId ?? null,
            actorDatabaseUserId: input.grantedByUserId ?? null,
            allowManaged: input.allowManagedGroupEnrollment ?? true,
            at: now,
          }),
        );
      }
      statements.push(...prepareAutomaticGroupEnrollmentForUserStatements(db, user.id, now));
    }

    pending.push({ rep, user, identityId, identityCreatedAt: existingAffiliation?.createdAt ?? now });
  }

  const assignedContactRoles: ("primary" | "secondary" | null)[] = pending.map(() => null);
  if (input.activateIdentities && !existingHolders.primaryContactUserId && pending.length >= 1) {
    statements.push(
      ...buildAssignRepresentativeRoleStatementsForNewRepresentative(db, {
        memberId: aggregateId,
        identityId: pending[0].identityId,
        userId: pending[0].user.id,
        roleId: REPRESENTATIVE_ROLE_IDS.primaryContact,
        grantedByUserId: input.grantedByUserId,
        now,
      }),
    );
    assignedContactRoles[0] = "primary";
  }
  if (input.activateIdentities && !existingHolders.secondaryContactUserId && pending.length >= 2) {
    statements.push(
      ...buildAssignRepresentativeRoleStatementsForNewRepresentative(db, {
        memberId: aggregateId,
        identityId: pending[1].identityId,
        userId: pending[1].user.id,
        roleId: REPRESENTATIVE_ROLE_IDS.secondaryContact,
        grantedByUserId: input.grantedByUserId,
        now,
      }),
    );
    assignedContactRoles[1] = "secondary";
  }

  statements.push(
    prepareSitePublicationRequest(db, publication, {
      sql: `EXISTS(SELECT 1 FROM members member WHERE member.id=? AND member.status='active' AND (?=1 OR EXISTS(
      SELECT 1 FROM identities identity JOIN json_each(?) fresh ON fresh.value=identity.id
      WHERE identity.organization_id=member.organization_id AND identity.started_at IS NOT NULL
      AND identity.ended_at IS NULL AND identity.blocked_at IS NULL AND identity.show_on_organization_profile=1)))`,
      bindings: [aggregateId, aggregateStatements.length > 0 ? 1 : 0, JSON.stringify(publicIdentityIds)],
    }),
  );

  return {
    statements,
    buildResult: () => ({
      organizationId,
      organizationWasCreated,
      groups: [...groups],
      identities: pending.map(({ rep, user, identityId, identityCreatedAt }, index) => ({
        userId: user.id,
        email: user.email,
        name: rep.name,
        organizationId,
        membershipId: aggregateId,
        identityId,
        assignedContactRole: assignedContactRoles[index],
        createdAt: identityCreatedAt,
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
  const groups = await resolveProvisioningGroups(db, input);

  const category = await requireProvisioningCategory(db, input.membershipCategory, {
    organizationName: input.organizationName ?? undefined,
    identities: input.identities.map(({ name, email }) => ({ name, email })),
  });
  if (category.isIndividual) {
    return buildProvisionIndividualMemberships(db, input, groups, now);
  }
  return buildProvisionOrganizationTiedMemberships(db, input, groups, now);
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
