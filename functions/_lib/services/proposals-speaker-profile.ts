import type { ParticipantAuthority } from "./participant-authority";
import type { z } from "zod";
import type { speakerSelfProfilePatchSchema } from "../../../assets/shared/schemas/proposal-management";
import { all, first } from "../db/queries";
import { AppError } from "../errors";
import { nowIso } from "../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import {
  isConsentAcceptanceContextConflict,
  prepareActiveTermsSnapshotGuard,
  prepareConsentStatements,
  validateRequiredConsents,
} from "./consent";
import { getRequiredTerms } from "./events";
import { getSpeakerByManageToken } from "./proposals";
import { proposalParticipantStatus, prepareProposalRoleCapacityForSpeakerChange } from "./proposal-role-capacity";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import { isEventParticipantSourceConflict } from "./event-participant-source-revision";
import {
  getProposalSpeakerRosterRevision,
  isProposalSpeakerRosterConflict,
  prepareProposalSpeakerRosterRevisionGuard,
} from "./proposal-speaker-roster-revision";
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
import { ownedIdentityAtEvidence } from "./identities/selection";
import { ownedIdentityEmailEvidence } from "./identities/owned-email";
import { assertProvedCapacity, prepareSelectedCapacityDisclosure } from "./proposal-speaker-capacity-selection";

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

export async function getProposalCoSpeakers(
  db: DatabaseLike,
  proposalId: string,
  excludeUserId: string,
): Promise<{ firstName: string | null; lastName: string | null; status: string }[]> {
  return all<{ first_name: string | null; last_name: string | null; status: string }>(
    db,
    `SELECT ${proposalSpeakerProfileColumns("u", "ps", "", ["firstName", "lastName"])}, ps.status
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     WHERE ps.proposal_id = ? AND ps.user_id != ?
     ORDER BY ps.created_at ASC`,
    [proposalId, excludeUserId],
  ).then((rows) => rows.map((r) => ({ firstName: r.first_name, lastName: r.last_name, status: r.status })));
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

export async function confirmSpeakerParticipation(
  db: DatabaseLike,
  manageToken: ParticipantAuthority,
  signingSecret: string,
  payload: {
    consents: Array<{ termKey: string; version: string }>;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  const { speaker, proposal, currentRepresentation } = await getSpeakerByManageToken(db, manageToken, signingSecret);

  if (speaker.status === "confirmed") return;
  if (!isProposalSpeakerRosterEditableStatus(proposal.status)) {
    throw new AppError(409, "PROPOSAL_CLOSED", "Speaker participation cannot be changed on a closed proposal");
  }
  if (speaker.status === "declined") {
    throw new AppError(
      409,
      "SPEAKER_ALREADY_DECLINED",
      "You have already declined participation. Please contact the organizer if you changed your mind.",
    );
  }
  const representationRequired = () =>
    new AppError(
      409,
      "SPEAKER_REPRESENTATION_REQUIRED",
      "Confirm your speaker identity before confirming participation.",
    );
  // The current representation exists only once the speaker chose, and only while that identity is still theirs.
  if (!currentRepresentation) throw representationRequired();
  const mailbox = ownedIdentityEmailEvidence({
    userId: speaker.user_id,
    emailId: currentRepresentation.emailId,
    normalizedEmail: currentRepresentation.email,
    requireVerifiedPrimary: true,
    ...(speaker.acting_identity_id ? { identityId: speaker.acting_identity_id } : {}),
  });
  const now = nowIso();
  const representation = speaker.acting_identity_id
    ? ownedIdentityAtEvidence({ userId: speaker.user_id, identityId: speaker.acting_identity_id, at: now })
    : null;
  if (representation)
    representation.sql +=
      " AND identity.organization_id IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL";
  if (
    representation &&
    !(await first(db, `SELECT 1 WHERE EXISTS (${representation.sql})`, [...representation.bindings]))
  )
    throw representationRequired();
  const requiredTerms = await getRequiredTerms(db, proposal.event_id, "speaker");
  await validateRequiredConsents(requiredTerms, payload.consents);
  const rosterRevision = await getProposalSpeakerRosterRevision(db, proposal.id);
  try {
    await db.batch([
      prepareSpeakerSelfAuthorityGuard(db, manageToken, {
        proposalSpeakerId: speaker.id,
        proposalId: proposal.id,
        userId: speaker.user_id,
        inviteGeneration: speaker.invite_generation,
        expectedManageLinkSecret: speaker.manage_link_secret,
      }),
      prepareProposalSpeakerRosterRevisionGuard(db, {
        proposalId: proposal.id,
        expectedRevision: rosterRevision,
      }),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM proposal_speakers WHERE id=? AND user_id=? AND acting_identity_selected_at IS NOT NULL AND acting_identity_id IS ? AND acting_identity_selected_at IS ?",
        bindings: [speaker.id, speaker.user_id, speaker.acting_identity_id, speaker.acting_identity_selected_at],
      }),
      ...(representation ? [prepareAuthorizationGuard(db, representation)] : []),
      prepareAuthorizationGuard(db, mailbox),
      prepareActiveTermsSnapshotGuard(db, proposal.event_id, requiredTerms, "speaker"),
      ...(await prepareConsentStatements(db, {
        proposalId: proposal.id,
        eventId: proposal.event_id,
        userId: speaker.user_id,
        audienceType: "speaker",
        accepted: payload.consents,
        ip: payload.ip,
        userAgent: payload.userAgent,
        secret: signingSecret,
      })),
      db
        .prepare(
          `UPDATE proposal_speakers
           SET status = 'confirmed', confirmed_at = ?, terms_accepted_at = ?
           WHERE id = ? AND proposal_id = ? AND user_id = ? AND role = ? AND status = ? AND invite_generation = ?
             AND acting_identity_id IS ? AND acting_identity_selected_at IS ?
             AND EXISTS (
               SELECT 1 FROM session_proposals
               WHERE id = ? AND status = ? AND updated_at = ? AND deleted_at IS NULL
             )`,
        )
        .bind(
          now,
          now,
          speaker.id,
          proposal.id,
          speaker.user_id,
          speaker.role,
          speaker.status,
          speaker.invite_generation,
          speaker.acting_identity_id,
          speaker.acting_identity_selected_at,
          proposal.id,
          proposal.status,
          proposal.updated_at,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "proposal", id: speaker.proposal_id },
        "user",
        speaker.user_id,
        "speaker_confirmed",
        "proposal_speaker",
        speaker.id,
        { proposalId: speaker.proposal_id },
        now,
      ),
      ...(await prepareProposalRoleCapacityForSpeakerChange(db, {
        eventId: proposal.event_id,
        userId: speaker.user_id,
        proposalRole: speaker.role,
        sourceRef: proposal.id,
        status: proposalParticipantStatus(proposal.status, "confirmed"),
        sourceRevisionAdvance: 1,
      })),
    ]);
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) throw registrationChangedError();
    if (
      isAuditChangeGuardFailure(error) ||
      isAuthorizationGuardFailure(error) ||
      isEventParticipantSourceConflict(error) ||
      isProposalSpeakerRosterConflict(error) ||
      isConsentAcceptanceContextConflict(error)
    ) {
      throw new AppError(
        409,
        "PROPOSAL_SPEAKER_CONFLICT",
        "Speaker participation changed while it was being confirmed",
      );
    }
    throw error;
  }
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
    >,
  context: ProposalSpeakerWriteContext & {
    selectionAuthority?: { userId: string; sessionId: string };
    signingSecret?: string;
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
      const affiliation = await prepareVerifiedOrganizationAffiliation(db, {
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
