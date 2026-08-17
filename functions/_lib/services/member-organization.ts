/**
 * Self-service coworker enrollment (member portal).
 *
 * Deliberately self-contained rather than reusing
 * `admin-organizations.ts`'s representative logic — the caller-eligibility
 * check here is the self-service rule: only the org's own primary or
 * secondary contact may enroll a coworker or manage contact/delegate
 * designations, never an arbitrary representative.
 */
import { first, run } from "../db/queries";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { AppError } from "../errors";
import { buildFindOrCreateUserStatement } from "./users";
import { isActiveRepresentative, buildAddRepresentativeStatement } from "./membership/representatives";
import {
  REPRESENTATIVE_ROLE_IDS,
  resolveRepresentativeRoleHolders,
  buildAssignRepresentativeRoleStatements,
  buildRevokeRepresentativeRoleStatement,
} from "./membership/representative-roles";
import type { AuthMember, DatabaseLike } from "../types";

export interface AddedCoworker {
  memberId: string;
  userId: string;
  name: string;
  email: string;
}

async function requireOrgContact(db: DatabaseLike, member: AuthMember): Promise<void> {
  if (!member.organizationId) {
    throw new AppError(403, "NO_ORGANIZATION", "Your membership is not tied to an organization");
  }
  const holders = await resolveRepresentativeRoleHolders(db, member.memberId);
  const isContact = holders.primaryContactUserId === member.userId || holders.secondaryContactUserId === member.userId;
  if (!isContact) {
    throw new AppError(
      403,
      "NOT_ORG_CONTACT",
      "Only your organization's primary or secondary contact can perform this action",
    );
  }
}

export async function addCoworker(
  db: DatabaseLike,
  member: AuthMember,
  input: { name: string; email: string },
): Promise<AddedCoworker> {
  await requireOrgContact(db, member);

  const normalizedEmail = normalizeEmail(input.email);
  const existingUser = await first<{ id: string }>(db, "SELECT id FROM users WHERE normalized_email = ?", [
    normalizedEmail,
  ]);
  if (existingUser) {
    const alreadyRepresenting = await isActiveRepresentative(db, member.memberId, existingUser.id);
    if (alreadyRepresenting) {
      throw new AppError(409, "ALREADY_MEMBER", `${input.email} already represents this organization`);
    }
  }

  const nameParts = input.name.trim().split(/\s+/);
  const firstName = nameParts[0] ?? undefined;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;

  // User creation and the representative-row insert used to be two
  // separate commits (findOrCreateUser executes immediately) — a failure
  // between them could leave a bare user row with no representative
  // relationship to show for it. Both now build (not execute) and commit
  // together in one db.batch() (PR #1 review blocker 4).
  const { user, statement: userStatement } = await buildFindOrCreateUserStatement(db, {
    email: input.email,
    firstName,
    lastName,
    // Public/self-service enrollment must not clobber an existing user's
    // profile — same rationale as every other allowProfileUpdate:false
    // call site in this codebase.
    allowProfileUpdate: false,
  });

  const now = nowIso();
  const { representativeId, statement: representativeStatement } = buildAddRepresentativeStatement(db, {
    memberId: member.memberId,
    userId: user.id,
    now,
  });
  const statements = userStatement ? [userStatement, representativeStatement] : [representativeStatement];
  await db.batch(statements);

  return {
    memberId: representativeId,
    userId: user.id,
    name: input.name.trim(),
    email: user.email,
  };
}

/**
 * Primary contact nominates (or withdraws a nomination for) a secondary
 * contact. Held in `organization_secondary_contact_nominations` (one
 * pending row per organization) until a staff admin confirms it via
 * `POST /api/v1/admin/organizations/:id/confirm-secondary-contact` — the
 * primary contact cannot promote someone directly.
 */
export async function nominateSecondaryContact(
  db: DatabaseLike,
  member: AuthMember,
  nomineeUserId: string | null,
): Promise<{ pendingSecondaryContactUserId: string | null }> {
  if (!member.organizationId) {
    throw new AppError(403, "NO_ORGANIZATION", "Your membership is not tied to an organization");
  }
  const holders = await resolveRepresentativeRoleHolders(db, member.memberId);
  if (holders.primaryContactUserId !== member.userId) {
    throw new AppError(
      403,
      "NOT_PRIMARY_CONTACT",
      "Only your organization's primary contact can nominate a secondary contact",
    );
  }

  if (nomineeUserId === null) {
    await run(db, "DELETE FROM organization_secondary_contact_nominations WHERE member_id = ?", [member.memberId]);
    return { pendingSecondaryContactUserId: null };
  }

  if (nomineeUserId === member.userId) {
    throw new AppError(
      422,
      "SELF_NOMINATION",
      "You cannot nominate yourself as secondary contact — you are already the primary contact",
    );
  }

  const isEligible = await isActiveRepresentative(db, member.memberId, nomineeUserId);
  if (!isEligible) {
    throw new AppError(422, "NOT_ELIGIBLE", "The nominee must be an active representative of your organization");
  }

  const now = nowIso();
  await run(db, "DELETE FROM organization_secondary_contact_nominations WHERE member_id = ?", [member.memberId]);
  await run(
    db,
    `INSERT INTO organization_secondary_contact_nominations
       (id, member_id, nominated_user_id, nominated_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [uuid(), member.memberId, nomineeUserId, member.userId, now],
  );
  return { pendingSecondaryContactUserId: nomineeUserId };
}

/**
 * Sets an organization's standing forum-vote delegate (role-voting_delegate,
 * a singleton user_roles grant — migration 0038). Takes effect immediately,
 * unlike the secondary-contact nomination above (no staff-confirmation
 * step): "the primary or secondary contact can change the voting delegate
 * at any time." A NULL delegate falls back to the primary contact at
 * ballot-cast time (resolved live by votes/ballots.ts's
 * resolveVotingDelegateUserId, never snapshotted) — this is also what makes
 * the "delegate change mid-vote" rule work for free: a ballot already cast
 * by the outgoing delegate is keyed to the organization, not the user, so
 * it stands regardless of a later change.
 */
export async function setVotingDelegate(
  db: DatabaseLike,
  member: AuthMember,
  delegateUserId: string | null,
): Promise<{ votingDelegateUserId: string | null }> {
  await requireOrgContact(db, member);

  const now = nowIso();
  if (delegateUserId === null) {
    await db.batch([
      buildRevokeRepresentativeRoleStatement(db, {
        memberId: member.memberId,
        roleId: REPRESENTATIVE_ROLE_IDS.votingDelegate,
        now,
      }),
    ]);
    return { votingDelegateUserId: null };
  }

  const isEligible = await isActiveRepresentative(db, member.memberId, delegateUserId);
  if (!isEligible) {
    throw new AppError(
      422,
      "NOT_ELIGIBLE",
      "The voting delegate must be an active representative of your organization",
    );
  }

  const statements = await buildAssignRepresentativeRoleStatements(db, {
    memberId: member.memberId,
    userId: delegateUserId,
    roleId: REPRESENTATIVE_ROLE_IDS.votingDelegate,
    grantedByUserId: member.userId,
    now,
  });
  await db.batch(statements);
  return { votingDelegateUserId: delegateUserId };
}
