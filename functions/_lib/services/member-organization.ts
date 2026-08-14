/**
 * Self-service coworker enrollment (member portal).
 *
 * Deliberately self-contained rather than reusing
 * `admin-organizations.ts`'s `addOrganizationRepresentative` — two other
 * engineers are concurrently changing that file (and its schema/UI
 * counterparts) for an unrelated org-level-membership-category change, so
 * this writes its own independent primary/secondary-contact check and
 * insert logic instead of importing from files that are mid-flight. The
 * shape mirrors that function's find-or-create + insert pattern, but the
 * caller-eligibility check here is the self-service rule: only the org's
 * own primary or secondary contact may enroll a coworker, never an
 * arbitrary representative.
 */
import { first, run } from "../db/queries";
import { normalizeEmail } from "../validation";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { AppError } from "../errors";
import { findOrCreateUser } from "./users";
import type { AuthMember, DatabaseLike } from "../types";

interface OrganizationContactRow {
  id: string;
  membership_category: string | null;
  primary_contact_user_id: string | null;
  secondary_contact_user_id: string | null;
}

export interface AddedCoworker {
  memberId: string;
  userId: string;
  name: string;
  email: string;
}

export async function addCoworker(
  db: DatabaseLike,
  member: AuthMember,
  input: { name: string; email: string },
): Promise<AddedCoworker> {
  if (!member.organizationId) {
    throw new AppError(403, "NO_ORGANIZATION", "Your membership is not tied to an organization");
  }

  const org = await first<OrganizationContactRow>(
    db,
    "SELECT id, membership_category, primary_contact_user_id, secondary_contact_user_id FROM organizations WHERE id = ?",
    [member.organizationId],
  );
  if (!org) {
    throw new AppError(403, "NOT_ORG_CONTACT", "Organization not found");
  }

  const isContact = member.userId === org.primary_contact_user_id || member.userId === org.secondary_contact_user_id;
  if (!isContact) {
    throw new AppError(
      403,
      "NOT_ORG_CONTACT",
      "Only your organization's primary or secondary contact can enroll a coworker",
    );
  }

  if (!org.membership_category) {
    // Data-integrity edge case: migration 0040 backfills every org that
    // already has representatives, so this should only be reachable for an
    // org whose category was never set by staff. Fail loudly rather than
    // inserting a members row with a NULL member_type (NOT NULL column).
    throw new AppError(
      409,
      "ORG_MISSING_CATEGORY",
      "Your organization has no membership category set — contact PKI Consortium staff",
    );
  }

  const normalizedEmail = normalizeEmail(input.email);
  const existingUser = await first<{ id: string }>(db, "SELECT id FROM users WHERE normalized_email = ?", [
    normalizedEmail,
  ]);
  if (existingUser) {
    const existingActiveMember = await first<{ id: string }>(
      db,
      "SELECT id FROM members WHERE user_id = ? AND status = 'active'",
      [existingUser.id],
    );
    if (existingActiveMember) {
      throw new AppError(409, "ALREADY_MEMBER", `${input.email} already holds an active membership`);
    }
  }

  const nameParts = input.name.trim().split(/\s+/);
  const firstName = nameParts[0] ?? undefined;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;

  const user = await findOrCreateUser(db, {
    email: input.email,
    firstName,
    lastName,
    // Public/self-service enrollment must not clobber an existing user's
    // profile — same rationale as every other allowProfileUpdate:false
    // call site in this codebase.
    allowProfileUpdate: false,
  });

  const now = nowIso();
  const memberId = uuid();
  await run(
    db,
    `INSERT INTO members (id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at, show_on_org_profile)
     VALUES (?, ?, ?, ?, 'active', NULL, NULL, ?, ?, 1)`,
    [memberId, org.membership_category, user.id, member.organizationId, now, now],
  );

  return {
    memberId,
    userId: user.id,
    name: input.name.trim(),
    email: user.email,
  };
}

/**
 * Primary contact nominates (or withdraws a nomination for) a secondary
 * contact. Held in `organizations.pending_secondary_contact_user_id`
 * until a staff admin confirms it via
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

  const org = await first<OrganizationContactRow>(
    db,
    "SELECT id, membership_category, primary_contact_user_id, secondary_contact_user_id FROM organizations WHERE id = ?",
    [member.organizationId],
  );
  if (!org || org.primary_contact_user_id !== member.userId) {
    throw new AppError(
      403,
      "NOT_PRIMARY_CONTACT",
      "Only your organization's primary contact can nominate a secondary contact",
    );
  }

  if (nomineeUserId === null) {
    await run(db, "UPDATE organizations SET pending_secondary_contact_user_id = NULL WHERE id = ?", [org.id]);
    return { pendingSecondaryContactUserId: null };
  }

  if (nomineeUserId === member.userId) {
    throw new AppError(
      422,
      "SELF_NOMINATION",
      "You cannot nominate yourself as secondary contact — you are already the primary contact",
    );
  }

  const nomineeMember = await first<{ id: string; status: string }>(
    db,
    "SELECT id, status FROM members WHERE user_id = ? AND organization_id = ?",
    [nomineeUserId, org.id],
  );
  if (!nomineeMember || nomineeMember.status !== "active") {
    throw new AppError(422, "NOT_ELIGIBLE", "The nominee must be an active member of your organization");
  }

  await run(db, "UPDATE organizations SET pending_secondary_contact_user_id = ? WHERE id = ?", [nomineeUserId, org.id]);
  return { pendingSecondaryContactUserId: nomineeUserId };
}

/**
 * Sets an organization's standing forum-vote delegate. Unlike
 * the secondary-contact nomination above, this takes effect immediately —
 * describes no staff-confirmation step, only "the primary or secondary
 * contact can change the voting delegate at any time." A NULL delegate
 * falls back to the primary contact at ballot-cast time (resolved live by
 * votes.ts's resolveVotingDelegateUserId, never snapshotted) — this is also
 * what makes "delegate change mid-vote" rule work for free: a
 * ballot already cast by the outgoing delegate is keyed to the
 * organization, not the user, so it stands regardless of a later change.
 */
export async function setVotingDelegate(
  db: DatabaseLike,
  member: AuthMember,
  delegateUserId: string | null,
): Promise<{ votingDelegateUserId: string | null }> {
  if (!member.organizationId) {
    throw new AppError(403, "NO_ORGANIZATION", "Your membership is not tied to an organization");
  }

  const org = await first<OrganizationContactRow>(
    db,
    "SELECT id, membership_category, primary_contact_user_id, secondary_contact_user_id FROM organizations WHERE id = ?",
    [member.organizationId],
  );
  const isContact =
    org && (org.primary_contact_user_id === member.userId || org.secondary_contact_user_id === member.userId);
  if (!org || !isContact) {
    throw new AppError(
      403,
      "NOT_ORG_CONTACT",
      "Only your organization's primary or secondary contact can set the voting delegate",
    );
  }

  if (delegateUserId === null) {
    await run(db, "UPDATE organizations SET voting_delegate_user_id = NULL WHERE id = ?", [org.id]);
    return { votingDelegateUserId: null };
  }

  const nomineeMember = await first<{ id: string; status: string }>(
    db,
    "SELECT id, status FROM members WHERE user_id = ? AND organization_id = ?",
    [delegateUserId, org.id],
  );
  if (!nomineeMember || nomineeMember.status !== "active") {
    throw new AppError(422, "NOT_ELIGIBLE", "The voting delegate must be an active member of your organization");
  }

  await run(db, "UPDATE organizations SET voting_delegate_user_id = ? WHERE id = ?", [delegateUserId, org.id]);
  return { votingDelegateUserId: delegateUserId };
}
