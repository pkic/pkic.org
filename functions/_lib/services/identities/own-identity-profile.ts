/**
 * The owner's edit of one identity they hold: its job title, biography,
 * links and organization-page visibility, and with the acting identity also the person's names.
 * Both the current-user profile and the per-identity edit write through
 * `updateOwnIdentityProfile`, so there is one rule, one audit and one batch.
 */
import { first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import type { OwnIdentityProfile } from "../../../../assets/shared/schemas/own-identity-profile";
import type { DatabaseLike } from "../../types";
import type { OwnAccount } from "../../auth/member";
import { memberSessionAuthorizationEvidence, userSessionAuthorizationEvidence } from "../../auth/identity-capacities";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { identityJobTitleSql } from "./affiliation-projection";
import { prepareIdentityEmailOwnershipStatements, requireIdentityEmailAssignable } from "./email-ownership";
import { prepareUserProfileStatements } from "../users";
import { prepareIdentityProfileEdit, type EditableIdentityProfile } from "./profile-statement";

export interface OwnIdentityProfileUpdateInput {
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  emailId?: string | null;
  jobTitle?: string;
  biography?: string;
  links?: string[];
  showOnOrgProfile?: boolean;
}

interface EditableIdentityRow extends EditableIdentityProfile {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}

/** An identity the person holds now: started, not ended, not blocked. */
const HELD_IDENTITY_SQL = `identity.id = ? AND identity.user_id = ?
  AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL`;

/** A field present in the patch whose value differs from the stored one, as an audit delta. */
function nameChanges(current: EditableIdentityRow, input: OwnIdentityProfileUpdateInput) {
  const changes: Record<string, { from: string | null; to: string }> = {};
  if (input.firstName !== undefined && input.firstName !== current.first_name)
    changes.firstName = { from: current.first_name, to: input.firstName };
  if (input.lastName !== undefined && input.lastName !== current.last_name)
    changes.lastName = { from: current.last_name, to: input.lastName };
  if (input.preferredName !== undefined && input.preferredName !== current.preferred_name)
    changes.preferredName = { from: current.preferred_name, to: input.preferredName };
  return changes;
}

/** One identity's profile as its owner edits it. */
export async function readOwnIdentityProfile(
  db: DatabaseLike,
  userId: string,
  identityId: string,
): Promise<OwnIdentityProfile> {
  const row = await first<{
    id: string;
    organization_id: string | null;
    organization_name: string | null;
    job_title: string | null;
    biography: string | null;
    links_json: string | null;
  }>(
    db,
    `SELECT identity.id, identity.organization_id, organization.name AS organization_name,
            ${identityJobTitleSql("identity.id")} AS job_title, identity.biography, identity.links_json
       FROM identities identity
       LEFT JOIN organizations organization ON organization.id = identity.organization_id
      WHERE ${HELD_IDENTITY_SQL}`,
    [identityId, userId],
  );
  if (!row) throw new AppError(404, "NOT_FOUND", "Identity not found");
  return {
    identityId: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    jobTitle: row.job_title,
    biography: row.biography,
    links: parseLinksJson(row.links_json),
  };
}

/**
 * Edit one identity the person holds, without changing the identity the
 * session acts as. Names belong to the person, not the identity, and are only
 * offered with the acting identity.
 */
export async function updateOwnIdentityProfile(
  db: DatabaseLike,
  account: OwnAccount,
  identityId: string,
  input: OwnIdentityProfileUpdateInput,
): Promise<void> {
  const now = nowIso();
  const current = await first<EditableIdentityRow>(
    db,
    `SELECT identity.id, identity.user_id, identity.organization_id, identity.email_id, identity.job_title, identity.biography,
            identity.links_json, identity.show_on_organization_profile, identity.updated_at,
            title.job_title AS individual_job_title, u.first_name, u.last_name, u.preferred_name
       FROM identities identity
       JOIN users u ON u.id = identity.user_id
       LEFT JOIN individual_job_titles title ON title.user_id = identity.user_id
      WHERE ${HELD_IDENTITY_SQL}`,
    [identityId, account.userId],
  );
  if (!current) throw new AppError(404, "NOT_FOUND", "Profile not found");
  const isOrganizationIdentity = current.organization_id !== null;
  if (input.showOnOrgProfile !== undefined && !isOrganizationIdentity) {
    throw new AppError(422, "NO_ORGANIZATION", "This preference only applies to organization identities");
  }
  if (input.emailId !== undefined && !isOrganizationIdentity) {
    throw new AppError(422, "NO_ORGANIZATION", "An individual identity uses the account's primary email");
  }
  await requireIdentityEmailAssignable(db, { userId: account.userId, emailId: input.emailId, identityId: current.id });

  const edit = prepareIdentityProfileEdit(
    db,
    current,
    {
      emailId: input.emailId,
      jobTitle: input.jobTitle,
      biography: input.biography,
      links: input.links,
      showOnOrganizationProfile: input.showOnOrgProfile,
    },
    now,
  );
  const names = nameChanges(current, input);

  const statements = [
    prepareAuthorizationGuard(
      db,
      account.member
        ? memberSessionAuthorizationEvidence(account.member)
        : userSessionAuthorizationEvidence(account.userId, account.sessionId),
    ),
  ];
  if (input.firstName !== undefined || input.lastName !== undefined || input.preferredName !== undefined)
    statements.push(
      ...prepareUserProfileStatements(
        db,
        account.userId,
        {
          firstName: input.firstName,
          lastName: input.lastName,
          preferredName: input.preferredName,
        },
        now,
      ),
    );
  statements.push(
    ...(edit.publication ? [edit.publication] : []),
    edit.update,
    // The identity is the one edited: every registration, proposal or other
    // record that names it shows the new values, so the audit keeps the old.
    prepareAuditLogAfterOneChange(
      db,
      "member",
      account.userId,
      "identity_profile_updated",
      "identity",
      current.id,
      { ...names, ...edit.changes, memberId: account.member?.memberId ?? null },
      now,
    ),
    ...prepareIdentityEmailOwnershipStatements(db, {
      userId: account.userId,
      emailId: input.emailId,
      identityId: current.id,
    }),
  );
  if (edit.individualJobTitle) statements.push(edit.individualJobTitle);
  try {
    await db.batch(statements);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "MEMBERSHIP_CONTEXT_CHANGED",
        "The active membership changed before the profile was saved",
      );
    }
    if (error instanceof Error && error.message.includes("IDENTITY_EMAIL_INVALID")) {
      throw new AppError(422, "IDENTITY_EMAIL_INVALID", "Select a verified email address owned by this account");
    }
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "PROFILE_CHANGED", "The profile changed before it was saved");
    }
    throw error;
  }
}
