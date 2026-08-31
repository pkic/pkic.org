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
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { AppError } from "../errors";
import { prepareAuditLogAfterOneChange } from "./audit";
import { isActiveIdentityForMember } from "./membership/identities";
import { createOrganizationIdentityByEmail } from "./identities";
import { resolveRepresentativeRoleHolders } from "./membership/representative-roles";
import { prepareOrganizationPrimaryContactGuard } from "./identities/authorization";
import type { AuthMember, DatabaseLike } from "../types";

export interface AddedCoworker {
  identityId: string;
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
  const organizationId = member.organizationId!;

  const created = await createOrganizationIdentityByEmail(
    db,
    {
      userId: member.userId,
      databaseUserId: member.userId,
      actorType: "member",
      staffAuthorized: false,
      immediateActivationAuthorized: false,
    },
    {
      organizationId,
      email: input.email,
      name: input.name,
      showOnOrganizationProfile: true,
      activation: { mode: "invitation" },
    },
  );
  const invited = await first<{ user_id: string; name: string; email: string }>(
    db,
    `SELECT identity.user_id,
            trim(COALESCE(user.first_name, '') || ' ' || COALESCE(user.last_name, '')) AS name,
            user.email
       FROM identities identity
       JOIN users user ON user.id = identity.user_id
      WHERE identity.id = ?`,
    [created.identityId],
  );
  if (!invited) throw new AppError(409, "IDENTITY_CHANGED", "The identity invitation could not be reloaded");

  return {
    identityId: created.identityId,
    membershipId: member.memberId,
    userId: invited.user_id,
    name: invited.name || input.name.trim(),
    email: invited.email,
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

  const isEligible = await isActiveIdentityForMember(db, member.memberId, nomineeUserId);
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
