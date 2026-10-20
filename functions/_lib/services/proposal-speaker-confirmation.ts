import type { ParticipantAuthority } from "./participant-authority";
import type { AuthAdmin, DatabaseLike } from "../types";
import { first } from "../db/queries";
import { AppError } from "../errors";
import { nowIso } from "../utils/time";
import { requireUserBackedAuthAdmin } from "../auth/admin-identity";
import { preparePermissionsAuthorizationGuard } from "../auth/permissions";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../db/authorization-guard";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import {
  isConsentAcceptanceContextConflict,
  prepareActiveTermsSnapshotGuard,
  prepareConsentStatements,
  validateRequiredConsents,
} from "./consent";
import { getRequiredTerms } from "./events";
import {
  getSpeakerByManageToken,
  getSpeakerByProposalUser,
  type SpeakerWithContext,
} from "./proposals-speaker-capability";
import { prepareSpeakerSelfAuthorityGuard } from "./proposals-speaker-profile";
import { requireProposalSpeakerPermission } from "./proposal-speaker-access";
import { proposalParticipantStatus, prepareProposalRoleCapacityForSpeakerChange } from "./proposal-role-capacity";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import { isEventParticipantSourceConflict } from "./event-participant-source-revision";
import {
  getProposalSpeakerRosterRevision,
  isProposalSpeakerRosterConflict,
  prepareProposalSpeakerRosterRevisionGuard,
} from "./proposal-speaker-roster-revision";
import { isProposalSpeakerRosterEditableStatus } from "../../../assets/shared/schemas/proposal-status";
import { ownedIdentityAtEvidence } from "./identities/selection";
import { ownedIdentityEmailEvidence } from "./identities/owned-email";

export async function confirmSpeakerParticipation(
  db: DatabaseLike,
  authority: ParticipantAuthority,
  signingSecret: string,
  payload: { consents: Array<{ termKey: string; version: string }>; ip: string | null; userAgent: string | null },
): Promise<void> {
  const context = await getSpeakerByManageToken(db, authority, signingSecret);
  return confirmParticipation(db, context, { kind: "speaker", authority, signingSecret, payload });
}

/** Records an organizer's acceptance using only the speaker's existing identity and consent evidence. */
export async function acceptSpeakerParticipationByManager(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  userId: string,
): Promise<void> {
  requireUserBackedAuthAdmin(actor);
  const context = await getSpeakerByProposalUser(db, proposalId, userId);
  await requireProposalSpeakerPermission(db, actor, context.proposal.event_id, "manage");
  return confirmParticipation(db, context, { kind: "manager", actor });
}

type SpeakerConfirmation =
  | { kind: "manager"; actor: AuthAdmin }
  | {
      kind: "speaker";
      authority: ParticipantAuthority;
      signingSecret: string;
      payload: { consents: Array<{ termKey: string; version: string }>; ip: string | null; userAgent: string | null };
    };

async function confirmParticipation(
  db: DatabaseLike,
  { speaker, proposal, currentRepresentation }: SpeakerWithContext,
  confirmation: SpeakerConfirmation,
): Promise<void> {
  const manager = confirmation.kind === "manager" ? confirmation.actor : undefined;
  if (speaker.status === "confirmed") return;
  if (!isProposalSpeakerRosterEditableStatus(proposal.status)) {
    throw new AppError(409, "PROPOSAL_CLOSED", "Speaker participation cannot be changed on a closed proposal");
  }
  if (speaker.status === "declined") {
    throw new AppError(
      409,
      "SPEAKER_ALREADY_DECLINED",
      manager
        ? "This speaker declined. Send a new invitation before accepting on their behalf."
        : "You have already declined participation. Please contact the organizer if you changed your mind.",
    );
  }
  const representationRequired = () =>
    new AppError(
      409,
      "SPEAKER_REPRESENTATION_REQUIRED",
      manager
        ? "The speaker must confirm their speaker identity before you can accept this invitation for them."
        : "Confirm your speaker identity before confirming participation.",
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
  const consentEvidence = {
    sql: `SELECT 1 WHERE NOT EXISTS (
      SELECT 1 FROM event_terms et
      WHERE et.event_id=? AND et.audience_type='speaker' AND et.active=1 AND et.required=1
        AND NOT EXISTS (SELECT 1 FROM consent_acceptances ca
          WHERE ca.event_id=et.event_id AND ca.user_id=?
            AND ca.audience_type='speaker' AND ca.term_key=et.term_key AND ca.term_version=et.version))`,
    bindings: [proposal.event_id, speaker.user_id],
  };
  if (manager) {
    if (!(await first(db, consentEvidence.sql, consentEvidence.bindings)))
      throw new AppError(
        409,
        "SPEAKER_CONSENT_REQUIRED",
        "The speaker must accept the required speaker terms before you can accept this invitation for them.",
      );
  } else if (confirmation.kind === "speaker")
    await validateRequiredConsents(requiredTerms, confirmation.payload.consents);
  const rosterRevision = await getProposalSpeakerRosterRevision(db, proposal.id);
  try {
    await db.batch([
      confirmation.kind === "manager"
        ? preparePermissionsAuthorizationGuard(db, confirmation.actor, [
            { permission: "proposals:manage", context: { type: "event", id: proposal.event_id } },
          ])
        : prepareSpeakerSelfAuthorityGuard(db, confirmation.authority, {
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
      ...(manager ? [prepareAuthorizationGuard(db, consentEvidence)] : []),
      ...(confirmation.kind === "speaker"
        ? await prepareConsentStatements(db, {
            proposalId: proposal.id,
            eventId: proposal.event_id,
            userId: speaker.user_id,
            audienceType: "speaker",
            accepted: confirmation.payload.consents,
            ip: confirmation.payload.ip,
            userAgent: confirmation.payload.userAgent,
            secret: confirmation.signingSecret,
          })
        : []),
      db
        .prepare(
          `UPDATE proposal_speakers
           SET status = 'confirmed', confirmed_at = ?, terms_accepted_at = COALESCE(?, terms_accepted_at)
           WHERE id = ? AND proposal_id = ? AND user_id = ? AND role = ? AND status = ? AND invite_generation = ?
             AND acting_identity_id IS ? AND acting_identity_selected_at IS ?
             AND EXISTS (
               SELECT 1 FROM session_proposals
               WHERE id = ? AND status = ? AND updated_at = ? AND deleted_at IS NULL
             )`,
        )
        .bind(
          now,
          manager ? null : now,
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
        manager ? "admin" : "user",
        manager?.id ?? speaker.user_id,
        manager ? "speaker_confirmed_by_organizer" : "speaker_confirmed",
        "proposal_speaker",
        speaker.id,
        { proposalId: speaker.proposal_id, ...(manager ? { speakerUserId: speaker.user_id } : {}) },
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
