import type { z } from "zod";
import { firstNameSchema, lastNameSchema } from "../../../assets/shared/schemas/api-common";
import type { proposalCreateSchema } from "../../../assets/shared/schemas/proposal-management";
import { parseLinksJson, serializeLinks } from "../../../assets/shared/schemas/links";
import {
  emailDomainOf,
  isDisposableEmailDomain,
  isPersonalEmailDomain,
} from "../../../assets/shared/constants/email-domains";
import type { AuthenticatedIdentity } from "../auth/user-session";
import { first } from "../db/queries";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import type { DatabaseLike, StatementLike } from "../types";
import { AppError } from "../errors";
import { userRecordColumns, type UserRecord } from "./users";
import { prepareProposalActingIdentity, type PreparedProposalActingIdentity } from "./proposal-speaker-identity";
import { ownedIdentityEmailEvidence } from "./identities/owned-email";
import { prepareVerifiedOrganizationAffiliation } from "./identities";
import { prepareEventProposalProofRedemption } from "./event-proposal-proof-redemption";
import { assertEventProposalEntry } from "./event-proposal-proof-entry";
import type { InviteRecord } from "./invites";

type Input = z.infer<typeof proposalCreateSchema>;

function completeProfile(user: UserRecord | null, profile: Input["proposer"], email: string) {
  const names = { firstName: user?.first_name ?? profile.firstName, lastName: user?.last_name ?? profile.lastName };
  if (!firstNameSchema.safeParse(names.firstName).success || !lastNameSchema.safeParse(names.lastName).success)
    throw new AppError(422, "PROPOSAL_PERSON_DETAILS_REQUIRED", "Complete your first and last name.", {
      firstName: "Complete missing personal details.",
      lastName: "Complete missing personal details.",
    });
  return {
    ...profile,
    email,
    firstName: names.firstName!,
    lastName: names.lastName!,
    bio: profile.bio ?? user?.biography ?? undefined,
    links: profile.links.length ? profile.links : parseLinksJson(user?.links_json ?? null),
  };
}

function officialEmail(email: string) {
  const domain = emailDomainOf(email);
  if (isPersonalEmailDomain(domain) || isDisposableEmailDomain(domain))
    throw new AppError(422, "PROPOSAL_OFFICIAL_EMAIL_REQUIRED", "Use your organization's official email address.");
}

/** Prepared self context; only the proposal aggregate commits person, proof, and affiliation. */
export async function prepareProposalSubmitter(
  db: DatabaseLike,
  input: {
    eventId: string;
    body: Input;
    actor?: AuthenticatedIdentity;
    signingSecret: string;
    at: string;
    acceptedInvite?: InviteRecord | null;
  },
) {
  const statements: StatementLike[] = [];
  let user: UserRecord;
  let created = false;
  let identity: PreparedProposalActingIdentity;
  let profile: ReturnType<typeof completeProfile>;
  const kind = input.body.unaffiliatedAttestation ? "individual" : "organization";
  if (input.body.continuationToken) {
    const person = await prepareEventProposalProofRedemption(db, {
      eventId: input.eventId,
      continuationToken: input.body.continuationToken,
      signingSecret: input.signingSecret,
      actor: input.actor,
      operation: "proposal_submission",
      at: input.at,
      profile: {
        email: input.body.proposer.email ?? "",
        firstName: input.body.proposer.firstName,
        lastName: input.body.proposer.lastName,
        biography: input.body.proposer.bio,
        linksJson: serializeLinks(input.body.proposer.links),
      },
    });
    assertEventProposalEntry({ entry: person.entryContext, body: input.body, acceptedInvite: input.acceptedInvite });
    if (
      person.applicantKind !== kind ||
      (input.body.proposer.email !== undefined && input.body.proposer.email !== person.normalizedEmail)
    )
      throw new AppError(422, "PROPOSAL_PROOF_CONTEXT_MISMATCH", "Use the qualification and email you confirmed.");
    if (input.actor && input.actor.userId !== person.user.id)
      throw new AppError(
        403,
        "PROPOSAL_PERSON_AUTHORITY_REQUIRED",
        "The confirmed person must match your signed-in account.",
      );
    user = person.user;
    created = person.created;
    profile = completeProfile(user, input.body.proposer, person.normalizedEmail);
    statements.push(...person.statements);
    if (kind === "individual") {
      if (input.body.proposer.actingIdentityId)
        throw new AppError(
          422,
          "PROPOSAL_QUALIFICATION_CONFLICT",
          "Individual qualification cannot select an organization affiliation.",
        );
      identity = await prepareProposalActingIdentity(db, {
        userId: user.id,
        actingIdentityId: null,
        at: input.at,
        profile: {
          organizationName: profile.organizationName,
          jobTitle: profile.jobTitle,
          biography: profile.bio,
          linksJson: serializeLinks(profile.links),
        },
      });
    } else {
      officialEmail(person.normalizedEmail);
      if (input.body.proposer.actingIdentityId === null)
        throw new AppError(422, "PROPOSAL_QUALIFICATION_CONFLICT", "Choose your organization affiliation.");
      if (input.body.proposer.actingIdentityId) {
        identity = await prepareProposalActingIdentity(db, {
          userId: user.id,
          actingIdentityId: input.body.proposer.actingIdentityId,
          at: input.at,
          profile: {
            organizationName: profile.organizationName,
            jobTitle: profile.jobTitle,
            biography: profile.bio,
            linksJson: serializeLinks(profile.links),
          },
        });
      } else {
        const affiliation = await prepareVerifiedOrganizationAffiliation(db, {
          userId: user.id,
          normalizedEmail: person.normalizedEmail,
          emailId: person.emailId,
          organizationName: profile.organizationName,
          at: input.at,
          proofEvidence: person.proofEvidence,
          profile: {
            jobTitle: profile.jobTitle,
            biography: profile.bio,
            linksJson: serializeLinks(profile.links),
          },
        });
        statements.push(...affiliation.statements);
        identity = {
          identityId: affiliation.identityId,
          selectedAt: input.at,
          snapshot: affiliation.snapshot,
          guards: [],
        };
      }
    }
  } else {
    if (!input.actor)
      throw new AppError(
        403,
        "PROPOSAL_MAILBOX_PROOF_REQUIRED",
        "Confirm your email address before submitting a proposal.",
      );
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
    user = canonical;
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
    profile = completeProfile(user, input.body.proposer, email);
    identity = await prepareProposalActingIdentity(db, {
      userId: user.id,
      actingIdentityId: selected,
      at: input.at,
      profile: {
        organizationName: profile.organizationName,
        jobTitle: profile.jobTitle,
        biography: profile.bio,
        linksJson: serializeLinks(profile.links),
      },
    });
  }
  if (kind === "organization" && !identity.snapshot.organizationName)
    throw new AppError(422, "PROPOSAL_QUALIFICATION_CONFLICT", "Choose your organization affiliation.");
  if (identity.identityId) {
    const selectedEmail = await first<{ email_id: string | null; email: string }>(
      db,
      "SELECT identity.email_id,COALESCE(address.normalized_email,user.normalized_email) AS email FROM identities identity JOIN users user ON user.id=identity.user_id LEFT JOIN user_emails address ON address.id=identity.email_id AND address.user_id=identity.user_id WHERE identity.id=? AND identity.user_id=?",
      [identity.identityId, user.id],
    );
    // Newly prepared affiliations are already guarded by their exact proved address.
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
  return { user, created, identity, profile, statements };
}
