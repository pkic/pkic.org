import type { z } from "zod";
import { firstNameSchema, lastNameSchema } from "../../../assets/shared/schemas/api-common";
import type { proposalCreateSchema } from "../../../assets/shared/schemas/proposal-management";
import { mailboxKind } from "../email-domains/classification";
import type { AuthenticatedIdentity } from "../auth/user-session";
import { first } from "../db/queries";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import type { DatabaseLike, StatementLike } from "../types";
import { AppError } from "../errors";
import { userRecordColumns, type UserRecord } from "./users";
import { prepareProposalActingIdentity } from "./proposal-speaker-identity";
import { ownedIdentityEmailEvidence } from "./identities/owned-email";

type Input = z.infer<typeof proposalCreateSchema>;

function completeProfile(user: UserRecord | null, profile: Input["proposer"], email: string) {
  const names = { firstName: user?.first_name ?? profile.firstName, lastName: user?.last_name ?? profile.lastName };
  if (!firstNameSchema.safeParse(names.firstName).success || !lastNameSchema.safeParse(names.lastName).success)
    throw new AppError(422, "PROPOSAL_PERSON_DETAILS_REQUIRED", "Complete your first and last name.", {
      firstName: "Complete missing personal details.",
      lastName: "Complete missing personal details.",
    });
  return {
    email,
    firstName: names.firstName!,
    lastName: names.lastName!,
    bio: profile.bio,
    links: profile.links,
  };
}

function officialEmail(email: string) {
  if (mailboxKind(email) !== "work")
    throw new AppError(422, "PROPOSAL_OFFICIAL_EMAIL_REQUIRED", "Use your organization's official email address.");
}

/**
 * The signed-in proposer and the identity they chose to speak as. Their
 * session is the proof of who they are; the address is the verified one the
 * chosen identity carries.
 */
export async function prepareProposalSubmitter(
  db: DatabaseLike,
  input: {
    eventId: string;
    body: Input;
    actor?: AuthenticatedIdentity;
    at: string;
  },
) {
  const statements: StatementLike[] = [];
  const kind = input.body.unaffiliatedAttestation ? "individual" : "organization";
  if (!input.actor) throw new AppError(401, "AUTH_REQUIRED", "Sign in to submit a proposal.");
  const selected = input.body.proposer.actingIdentityId;
  if (
    selected === undefined ||
    (kind === "individual" && selected !== null) ||
    (kind === "organization" && selected === null)
  )
    throw new AppError(
      422,
      "PROPOSAL_QUALIFICATION_CONFLICT",
      "Choose the affiliation that matches your qualification.",
    );
  const canonical = await first<UserRecord>(
    db,
    `SELECT ${userRecordColumns()} FROM users WHERE id=? AND active=1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL`,
    [input.actor.userId],
  );
  if (!canonical) throw new AppError(403, "PROPOSAL_PERSON_AUTHORITY_REQUIRED", "Your account is unavailable.");
  let user = canonical;
  statements.push(
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM sessions session JOIN users user ON user.id=session.user_id WHERE session.id=? AND session.user_id=? AND session.revoked_at IS NULL AND session.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND user.active=1 AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL",
      bindings: [input.actor.sessionId, user.id],
    }),
  );
  let email = user.normalized_email;
  if (selected) {
    const owned = await first<{ email_id: string | null; email: string; organization_id: string | null }>(
      db,
      "SELECT identity.email_id,COALESCE(address.normalized_email,user.normalized_email) AS email,identity.organization_id FROM identities identity JOIN users user ON user.id=identity.user_id LEFT JOIN user_emails address ON address.id=identity.email_id AND address.user_id=identity.user_id WHERE identity.id=? AND identity.user_id=?",
      [selected, user.id],
    );
    if (!owned?.organization_id)
      throw new AppError(403, "PROPOSAL_IDENTITY_UNAVAILABLE", "Choose your own organization affiliation.");
    email = owned.email;
    officialEmail(email);
    statements.push(
      prepareAuthorizationGuard(
        db,
        ownedIdentityEmailEvidence({
          userId: user.id,
          emailId: owned.email_id,
          normalizedEmail: email,
          requireVerifiedPrimary: true,
        }),
      ),
    );
  }
  if (input.body.proposer.email !== undefined && input.body.proposer.email !== email)
    throw new AppError(422, "PROPOSAL_PERSON_EMAIL_CONFLICT", "Use the selected identity's email address.");
  const profile = completeProfile(user, input.body.proposer, email);
  const identity = await prepareProposalActingIdentity(db, {
    userId: user.id,
    actingIdentityId: selected,
    at: input.at,
    jobTitleField: "proposer.jobTitle",
  });
  if (kind === "organization" && !identity.representation.organizationName)
    throw new AppError(422, "PROPOSAL_QUALIFICATION_CONFLICT", "Choose your organization affiliation.");
  if (identity.identityId) {
    const selectedEmail = await first<{ email_id: string | null; email: string }>(
      db,
      "SELECT identity.email_id,COALESCE(address.normalized_email,user.normalized_email) AS email FROM identities identity JOIN users user ON user.id=identity.user_id LEFT JOIN user_emails address ON address.id=identity.email_id AND address.user_id=identity.user_id WHERE identity.id=? AND identity.user_id=?",
      [identity.identityId, user.id],
    );
    if (selectedEmail) {
      officialEmail(selectedEmail.email);
      statements.push(
        prepareAuthorizationGuard(
          db,
          ownedIdentityEmailEvidence({
            userId: user.id,
            emailId: selectedEmail.email_id,
            normalizedEmail: selectedEmail.email,
            requireVerifiedPrimary: true,
          }),
        ),
      );
    }
  }
  if (input.body.speakers.some((speaker) => speaker.email === profile.email))
    throw new AppError(
      422,
      "PROPOSAL_PARTICIPANT_DUPLICATE",
      "Each proposal participant must use a unique email address.",
    );
  // Only fill absent canonical names; submitted edits remain proposal-local.
  if (!user.first_name || !user.last_name) {
    statements.push(
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM users WHERE id=? AND active=1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL AND first_name IS ? AND last_name IS ?",
        bindings: [user.id, user.first_name, user.last_name],
      }),
      db
        .prepare(
          "UPDATE users SET first_name=COALESCE(first_name,?),last_name=COALESCE(last_name,?),updated_at=? WHERE id=?",
        )
        .bind(profile.firstName, profile.lastName, input.at, user.id),
    );
    user = { ...user, first_name: user.first_name ?? profile.firstName, last_name: user.last_name ?? profile.lastName };
  }
  return { user, identity, profile, statements };
}
