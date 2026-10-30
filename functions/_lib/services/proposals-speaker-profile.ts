import type { ParticipantAuthority } from "./participant-authority";
import type { z } from "zod";
import type { speakerSelfProfilePatchSchema } from "../../../assets/shared/schemas/proposal-management";
import { all, first } from "../db/queries";
import { AppError } from "../errors";
import { nowIso } from "../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { validateRequiredConsents } from "./consent";
import { readEventAffiliationContext } from "./identities/event-affiliation-context";
import { planVerifiedAffiliation } from "./identities/verified-affiliation-plan";
import { prepareUserProfileStatements, type UserProfilePatch } from "./users";
import { prepareProposalSpeakerWriteGuard, type ProposalSpeakerWriteContext } from "./proposal-speaker-authority";
import { proposalSpeakerProfileColumns } from "./proposal-speakers";
import type { DatabaseLike, StatementLike } from "../types";
import { prepareProposalActingIdentity, type PreparedProposalActingIdentity } from "./proposal-speaker-identity";
import {
  prepareEventProposalProofRedemption,
  isEventProposalProofReplay,
  eventProposalProofReplayError,
} from "./event-proposal-proof-redemption";
import { prepareVerifiedOrganizationAffiliation } from "./identities";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../db/authorization-guard";
import { parseCapabilityToken } from "../auth/capability-token";
import { activeEffectiveInviteExpirySql, effectiveProposalSpeakerInviteExpirySql } from "../invite-validity";
import { isProposalSpeakerRosterEditableStatus } from "../../../assets/shared/schemas/proposal-status";
import { assertProvedCapacity, prepareSelectedCapacityDisclosure } from "./proposal-speaker-capacity-selection";
import {
  speakerAccountAuthorityEvidence,
  speakerAccountSignInRequiredError,
  unclaimedAccountSql,
  type SpeakerAccountAuthority,
} from "./proposal-speaker-account-authority";

/** Rechecks the verified link/session and current invitation scope inside the profile/confirmation batch. */
export function prepareSpeakerSelfAuthorityGuard(
  db: DatabaseLike,
  authority: ParticipantAuthority,
  context: {
    proposalSpeakerId: string;
    proposalId: string;
    userId: string;
    inviteGeneration: number;
    expectedManageLinkSecret?: string | null;
  },
) {
  const capability = typeof authority === "string" ? parseCapabilityToken(authority, "speaker_manage") : null;
  if (typeof authority === "string" && (!capability || capability.resourceId !== context.proposalSpeakerId)) {
    throw new AppError(403, "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED", "Invalid speaker authority.");
  }
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 FROM proposal_speakers ps
          JOIN session_proposals sp ON sp.id=ps.proposal_id AND sp.deleted_at IS NULL
          JOIN events e ON e.id=sp.event_id
          WHERE ps.id=? AND ps.proposal_id=? AND ps.user_id=? AND ps.invite_generation=?
            AND (ps.status NOT IN ('invited','pending') OR (${activeEffectiveInviteExpirySql(
              effectiveProposalSpeakerInviteExpirySql("ps", "e"),
              "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            )}))
            AND ${
              capability
                ? "ps.manage_link_secret IS ? AND ? > unixepoch('now')"
                : "EXISTS (SELECT 1 FROM sessions WHERE id=? AND user_id=ps.user_id AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
            }`,
    bindings: [
      context.proposalSpeakerId,
      context.proposalId,
      context.userId,
      context.inviteGeneration,
      ...(capability
        ? [context.expectedManageLinkSecret ?? null, capability.expiresAt]
        : [typeof authority === "string" ? "" : (authority.sessionId ?? "")]),
    ],
  });
}

/**
 * The other speakers on the proposal, as one speaker's link shows them. A speaker who has not accepted is
 * named only by the name the proposer typed on an account no one has claimed; an existing person's own name
 * stays theirs until they accept.
 */
export async function getProposalCoSpeakers(
  db: DatabaseLike,
  proposalId: string,
  excludeUserId: string,
): Promise<{ firstName: string | null; lastName: string | null; status: string }[]> {
  const rows = await all<{
    first_name: string | null;
    last_name: string | null;
    status: string;
    account_claimed: 0 | 1;
  }>(
    db,
    `SELECT ${proposalSpeakerProfileColumns("u", "ps", "", ["firstName", "lastName"])}, ps.status,
            CASE WHEN ${unclaimedAccountSql("u")} THEN 0 ELSE 1 END AS account_claimed
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.proposal_id = ? AND ps.user_id != ?
     ORDER BY ps.created_at ASC`,
    [proposalId, excludeUserId],
  );
  return rows.map((row) => {
    const named = row.status === "confirmed" || !row.account_claimed;
    return {
      firstName: named ? row.first_name : null,
      lastName: named ? row.last_name : null,
      status: row.status,
    };
  });
}

export async function getPresentationUploader(
  db: DatabaseLike,
  proposalId: string,
): Promise<{ firstName: string | null; lastName: string | null; uploadedAt: string } | null> {
  const row = await first<{
    first_name: string | null;
    last_name: string | null;
    uploaded_at: string;
  }>(
    db,
    `SELECT u.first_name, u.last_name, pv.uploaded_at
     FROM presentation_versions pv
     LEFT JOIN users u ON u.id = pv.uploaded_by_user_id
     WHERE pv.proposal_id = ? AND pv.is_current = 1 AND pv.deleted_at IS NULL`,
    [proposalId],
  );
  if (!row) return null;
  return { firstName: row.first_name, lastName: row.last_name, uploadedAt: row.uploaded_at };
}

export async function updateSpeakerProfile(
  db: DatabaseLike,
  payload: Pick<UserProfilePatch, "firstName" | "lastName"> &
    Pick<
      z.infer<typeof speakerSelfProfilePatchSchema>,
      | "actingIdentityId"
      | "continuationToken"
      | "unaffiliatedAttestation"
      | "independentCapacity"
      | "consents"
      | "organizationName"
      | "jobTitle"
      | "organizationContextToken"
    >,
  context: ProposalSpeakerWriteContext & {
    selectionAuthority?: { userId: string; sessionId: string };
    signingSecret?: string;
    /** What lets the person's own name change without a mailbox proof in this request. */
    accountAuthority?: SpeakerAccountAuthority;
  },
): Promise<void> {
  const at = nowIso();
  const proofSelection = payload.continuationToken !== undefined;
  if (proofSelection && (!context.signingSecret || !context.authority)) {
    throw new AppError(403, "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED", "Confirm your own speaker affiliation.");
  }
  const fields: Array<"firstName" | "lastName"> = [];
  if (payload.firstName !== undefined) fields.push("firstName");
  if (payload.lastName !== undefined) fields.push("lastName");
  if (fields.length === 0 && payload.actingIdentityId === undefined && !proofSelection) return;
  // The speaker's own session that selects a representation also signs them in to their account.
  const accountAuthority =
    context.accountAuthority ??
    (context.selectionAuthority?.userId === context.userId
      ? { sessionId: context.selectionAuthority.sessionId }
      : undefined);
  if (fields.length > 0 && !proofSelection && !accountAuthority) throw speakerAccountSignInRequiredError();
  if (context.currentStatus === "declined")
    throw new AppError(403, "SPEAKER_DECLINED", "You have declined participation.");
  if (!isProposalSpeakerRosterEditableStatus(context.proposalStatus)) {
    throw new AppError(409, "PROPOSAL_CLOSED", "Speaker profiles cannot be changed on a closed proposal");
  }
  const selectionAuthority =
    context.selectionAuthority ??
    (context.authority && typeof context.authority !== "string" ? context.authority : undefined);
  if (
    payload.actingIdentityId !== undefined &&
    !proofSelection &&
    (!selectionAuthority?.sessionId || selectionAuthority.userId !== context.userId)
  ) {
    throw new AppError(
      403,
      "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED",
      "Sign in to select your own speaker representation.",
    );
  }
  const proof = proofSelection
    ? await prepareEventProposalProofRedemption(db, {
        eventId:
          (
            await first<{ event_id: string }>(
              db,
              "SELECT event_id FROM session_proposals WHERE id=? AND deleted_at IS NULL",
              [context.proposalId],
            )
          )?.event_id ?? "",
        continuationToken: payload.continuationToken!,
        signingSecret: context.signingSecret!,
        operation: "speaker_profile",
        speakerId: context.proposalSpeakerId,
        speakerAuthority: context.authority!,
        actor: selectionAuthority?.sessionId
          ? { userId: selectionAuthority.userId, sessionId: selectionAuthority.sessionId }
          : undefined,
        at,
      })
    : null;
  const claiming = Boolean(proof?.speakerClaimSessionId);
  const profileUserId = claiming ? proof!.user.id : context.userId;
  if (proof && (proof.created || (!claiming && proof.user.id !== context.userId)))
    throw new AppError(403, "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED", "Confirm the mailbox for this speaker.");
  assertProvedCapacity(proof?.applicantKind, payload);
  if (proof && payload.consents !== undefined) await validateRequiredConsents(proof.terms, payload.consents);
  let selected: PreparedProposalActingIdentity | null =
    payload.actingIdentityId === undefined
      ? null
      : await prepareProposalActingIdentity(db, {
          userId: profileUserId,
          actingIdentityId: payload.actingIdentityId,
          at,
          jobTitleField: "jobTitle",
        });
  const affiliationStatements: StatementLike[] = [];
  if (proof && !selected) {
    if (proof.applicantKind === "individual") {
      selected = await prepareProposalActingIdentity(db, {
        userId: profileUserId,
        actingIdentityId: null,
        at,
      });
    } else {
      const observed = payload.organizationContextToken
        ? await readEventAffiliationContext(
            context.signingSecret!,
            payload.organizationContextToken,
            proof.eventId,
            proof.normalizedEmail,
            "proposal-affiliation",
            {
              name: payload.organizationName ?? "",
              jobTitle: payload.jobTitle ?? "",
            },
          )
        : null;
      const affiliation = observed
        ? await planVerifiedAffiliation(
            db,
            {
              userId: profileUserId,
              proofEvidence: proof.proofEvidence,
              profile: { ...payload, jobTitle: payload.jobTitle || null },
            },
            observed.input,
            observed.basis,
            at,
          )
        : await prepareVerifiedOrganizationAffiliation(db, {
            userId: profileUserId,
            normalizedEmail: proof.normalizedEmail,
            emailId: proof.emailId,
            organizationName: payload.organizationName || undefined,
            at,
            proofEvidence: proof.proofEvidence,
            profile: { ...payload, jobTitle: payload.jobTitle || null },
          });
      affiliationStatements.push(...affiliation.statements);
      selected = {
        identityId: affiliation.identityId,
        selectedAt: at,
        representation: affiliation.representation,
        guards: [],
      };
    }
  }
  const knownPerson = selected
    ? await first<{ first_name: string | null; last_name: string | null; email: string }>(
        db,
        "SELECT first_name,last_name,email FROM users WHERE id=? AND active=1",
        [profileUserId],
      )
    : null;
  const namePatch = {
    firstName: selected && knownPerson?.first_name ? undefined : payload.firstName,
    lastName: selected && knownPerson?.last_name ? undefined : payload.lastName,
  };
  if (selected && !knownPerson)
    throw new AppError(403, "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED", "The speaker account is unavailable.");
  const disclosureStatements = selected
    ? prepareSelectedCapacityDisclosure(db, {
        ...context,
        userId: profileUserId,
        identityId: selected.identityId,
        email: proof?.normalizedEmail ?? knownPerson!.email,
        disclosure: payload.independentCapacity,
        at,
      })
    : [];
  const authorityGuard = context.authority ? prepareSpeakerSelfAuthorityGuard(db, context.authority, context) : null;
  const selectionSessionGuard =
    selected && !proof && selectionAuthority?.sessionId
      ? prepareAuthorizationGuard(db, {
          sql: "SELECT 1 FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
          bindings: [selectionAuthority.sessionId, context.userId],
        })
      : null;
  if (selected && !authorityGuard)
    throw new AppError(
      403,
      "PROPOSAL_IDENTITY_AUTHORITY_REQUIRED",
      "Select your representation through your own speaker page.",
    );
  const statements = [
    ...(authorityGuard ? [authorityGuard] : []),
    ...(proof?.statements ?? []),
    ...affiliationStatements,
    ...(selectionSessionGuard ? [selectionSessionGuard] : []),
    ...(!proof && accountAuthority && (namePatch.firstName !== undefined || namePatch.lastName !== undefined)
      ? [prepareAuthorizationGuard(db, speakerAccountAuthorityEvidence(accountAuthority, profileUserId))]
      : []),
    ...(selected?.guards ?? []),
    ...(selected && (namePatch.firstName !== undefined || namePatch.lastName !== undefined)
      ? [
          prepareAuthorizationGuard(db, {
            sql: "SELECT 1 FROM users WHERE id=? AND active=1 AND first_name IS ? AND last_name IS ?",
            bindings: [profileUserId, knownPerson!.first_name, knownPerson!.last_name],
          }),
        ]
      : []),
    prepareProposalSpeakerWriteGuard(db, context),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "proposal", id: context.proposalId },
      "user",
      profileUserId,
      "speaker_profile_updated_by_speaker",
      "proposal_speaker",
      context.proposalSpeakerId,
      {
        fields,
        ...(claiming ? { previousUserId: context.userId, claimedUserId: profileUserId } : {}),
        ...(selected ? { actingIdentityId: selected.identityId, selectedAt: selected.selectedAt } : {}),
      },
    ),
    ...(namePatch.firstName !== undefined || namePatch.lastName !== undefined
      ? prepareUserProfileStatements(db, profileUserId, namePatch)
      : []),
    db
      .prepare(
        `UPDATE proposal_speakers SET user_id=?, acting_identity_id=?, acting_identity_selected_at=?
         WHERE id=? AND proposal_id=? AND user_id=?`,
      )
      .bind(
        profileUserId,
        selected ? selected.identityId : (context.expectedActingIdentityId ?? null),
        selected?.selectedAt ?? context.expectedActingIdentitySelectedAt ?? null,
        context.proposalSpeakerId,
        context.proposalId,
        context.userId,
      ),
    ...disclosureStatements,
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (isEventProposalProofReplay(error)) throw eventProposalProofReplayError();
    if (isAuditChangeGuardFailure(error) || isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "PROPOSAL_SPEAKER_CONFLICT",
        "Speaker representation or profile changed while it was being updated",
      );
    }
    throw error;
  }
}
