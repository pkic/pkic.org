import {
  prepareOrganizerSpeakerIdentity,
  prepareOrganizerSpeakerNotification,
} from "./proposal-speaker-organizer-confirmation";
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
  await confirmParticipation(db, context, { kind: "speaker", authority, signingSecret, payload });
}

/** Confirms the displayed identity and participation on behalf of the speaker, with attributed terms and notice. */
export async function acceptSpeakerParticipationByManager(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  userId: string,
  appBaseUrl: string,
): Promise<string | null> {
  requireUserBackedAuthAdmin(actor);
  const context = await getSpeakerByProposalUser(db, proposalId, userId);
  await requireProposalSpeakerPermission(db, actor, context.proposal.event_id, "manage");
  return confirmParticipation(db, context, { kind: "manager", actor, appBaseUrl });
}

type SpeakerConfirmation =
  | { kind: "manager"; actor: AuthAdmin; appBaseUrl: string }
  | {
      kind: "speaker";
      authority: ParticipantAuthority;
      signingSecret: string;
      payload: { consents: Array<{ termKey: string; version: string }>; ip: string | null; userAgent: string | null };
    };

async function confirmParticipation(
  db: DatabaseLike,
  context: SpeakerWithContext,
  confirmation: SpeakerConfirmation,
): Promise<string | null> {
  const { speaker, proposal, currentRepresentation } = context;
  const manager = confirmation.kind === "manager" ? confirmation.actor : undefined;
  if (speaker.status === "confirmed") return null;
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
      "Confirm your speaker identity before confirming participation.",
    );
  const now = nowIso();
  const organizerIdentity = manager ? await prepareOrganizerSpeakerIdentity(db, context, now) : null;
  // The current representation exists only once the speaker chose, and only while that identity is still theirs.
  if (!manager && !currentRepresentation) throw representationRequired();
  const mailbox = currentRepresentation
    ? ownedIdentityEmailEvidence({
        userId: speaker.user_id,
        emailId: currentRepresentation.emailId,
        normalizedEmail: currentRepresentation.email,
        requireVerifiedPrimary: true,
        ...(speaker.acting_identity_id ? { identityId: speaker.acting_identity_id } : {}),
      })
    : null;
  const representation =
    !manager && speaker.acting_identity_id
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
  if (confirmation.kind === "speaker") await validateRequiredConsents(requiredTerms, confirmation.payload.consents);
  const notification =
    confirmation.kind === "manager" && organizerIdentity
      ? await prepareOrganizerSpeakerNotification(
          db,
          context,
          organizerIdentity,
          requiredTerms,
          confirmation.appBaseUrl,
          now,
        )
      : null;
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
        sql: "SELECT 1 FROM proposal_speakers WHERE id=? AND user_id=? AND acting_identity_id IS ? AND acting_identity_selected_at IS ?",
        bindings: [speaker.id, speaker.user_id, speaker.acting_identity_id, speaker.acting_identity_selected_at],
      }),
      ...(representation ? [prepareAuthorizationGuard(db, representation)] : []),
      ...(!manager && mailbox ? [prepareAuthorizationGuard(db, mailbox)] : []),
      ...(organizerIdentity?.guards ?? []),
      prepareActiveTermsSnapshotGuard(db, proposal.event_id, requiredTerms, "speaker"),
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
           SET status = 'confirmed', confirmed_at = ?, terms_accepted_at = ?,
               acting_identity_id = ?, acting_identity_selected_at = ?
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
          organizerIdentity ? organizerIdentity.identityId : speaker.acting_identity_id,
          speaker.acting_identity_selected_at ?? organizerIdentity?.selectedAt ?? null,
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
        {
          proposalId: speaker.proposal_id,
          ...(manager
            ? {
                speakerUserId: speaker.user_id,
                acceptanceSource: "organizer",
                actingIdentityId: organizerIdentity?.identityId ?? null,
                terms: requiredTerms.filter((term) => term.required === 1),
                notificationOutboxId: notification?.id,
              }
            : {}),
        },
        now,
      ),
      ...(notification ? [notification.statement] : []),
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
  return notification?.id ?? null;
}
