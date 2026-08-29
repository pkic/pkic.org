/**
 * Self-service coworker enrollment (member portal).
 *
 * Deliberately self-contained rather than reusing
 * the organization-management representative logic — the caller-eligibility
 * check here is the self-service rule: only the org's own primary or
 * secondary contact may enroll a coworker or manage contact
 * designations, never an arbitrary representative.
 */
import { first } from "../db/queries";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { AppError } from "../errors";
import { prepareAuditLogAfterOneChange } from "./audit";
import { buildFindOrCreateUserStatement } from "./users";
import { isActiveRepresentative, buildAddRepresentativeStatement } from "./membership/representatives";
import { resolveRepresentativeRoleHolders } from "./membership/representative-roles";
import {
  prepareOrganizationPrimaryContactGuard,
  prepareOrganizationRepresentativeManagementGuard,
} from "./organization-representations/authorization";
import type { AuthMember, DatabaseLike } from "../types";

export interface AddedCoworker {
  representativeId: string;
  membershipId: string;
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
  const { representativeId, statement: representativeStatement } = await buildAddRepresentativeStatement(db, {
    memberId: member.memberId,
    userId: user.id,
    source: "organization_contact",
    now,
  });
  const statements = [
    prepareOrganizationRepresentativeManagementGuard(db, {
      memberId: member.memberId,
      actorUserId: member.userId,
      staffAuthorized: false,
    }),
    ...(userStatement ? [userStatement] : []),
    representativeStatement,
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "ORGANIZATION_REPRESENTATION_MANAGEMENT_CHANGED",
        "Representative-management access changed while the coworker was being saved",
      );
    }
    throw error;
  }

  return {
    representativeId,
    membershipId: member.memberId,
    userId: user.id,
    name: input.name.trim(),
    email: user.email,
  };
}

/**
 * Primary contact nominates (or withdraws a nomination for) a secondary
 * contact. Held in `organization_secondary_contact_nominations` (one
 * pending row per organization) until a staff admin confirms it via
 * `POST /api/v1/organizations/:organizationId/contacts/secondary/confirmation` — the
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
    const existing = await first<{ id: string; nominated_user_id: string }>(
      db,
      "SELECT id, nominated_user_id FROM organization_secondary_contact_nominations WHERE member_id = ?",
      [member.memberId],
    );
    if (!existing) return { pendingSecondaryContactUserId: null };
    try {
      await db.batch([
        prepareOrganizationPrimaryContactGuard(db, member.memberId, member.userId),
        db
          .prepare(
            "DELETE FROM organization_secondary_contact_nominations WHERE id = ? AND member_id = ? AND nominated_user_id = ?",
          )
          .bind(existing.id, member.memberId, existing.nominated_user_id),
        prepareAuditLogAfterOneChange(
          db,
          "member",
          member.userId,
          "organization_secondary_contact_nomination_withdrawn",
          "member",
          member.memberId,
          { nominatedUserId: existing.nominated_user_id },
          nowIso(),
        ),
      ]);
    } catch (error) {
      if (isAuthorizationGuardFailure(error)) {
        throw new AppError(
          409,
          "ORGANIZATION_PRIMARY_CONTACT_CHANGED",
          "Primary-contact access changed while the nomination was being withdrawn",
        );
      }
      throw error;
    }
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
  const nominationId = uuid();
  try {
    await db.batch([
      prepareOrganizationPrimaryContactGuard(db, member.memberId, member.userId),
      db.prepare("DELETE FROM organization_secondary_contact_nominations WHERE member_id = ?").bind(member.memberId),
      db
        .prepare(
          `INSERT INTO organization_secondary_contact_nominations
             (id, member_id, nominated_user_id, nominated_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(nominationId, member.memberId, nomineeUserId, member.userId, now),
      prepareAuditLogAfterOneChange(
        db,
        "member",
        member.userId,
        "organization_secondary_contact_nominated",
        "member",
        member.memberId,
        { nominatedUserId: nomineeUserId },
        now,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "ORGANIZATION_PRIMARY_CONTACT_CHANGED",
        "Primary-contact access changed while the nomination was being saved",
      );
    }
    throw error;
  }
  return { pendingSecondaryContactUserId: nomineeUserId };
}
