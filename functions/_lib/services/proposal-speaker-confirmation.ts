import { prepareLateSpeakerConsentGuard } from "./proposal-speaker-consent";
import { isLateSpeakerResponseAwaitingReview } from "../../../assets/shared/proposal-speaker-acceptance";
import { prepareSpeakerResponseNotices } from "./proposal-speaker-response-notice";
import { isAgendaScheduleGuardFailure } from "./event-agenda/schedule-guards";
import { throwAgendaRevisionError } from "./event-agenda/revision";
import {
  prepareOrganizerSpeakerIdentity,
  prepareOrganizerSpeakerNotification,
} from "./proposal-speaker-organizer-confirmation";
import type { ParticipantAuthority } from "./participant-authority";
import type { AuthAdmin, DatabaseLike } from "../types";
import { first } from "../db/queries";
import { AppError } from "../errors";
import {
  activeEffectiveInviteExpirySql,
  inactiveEffectiveInviteExpirySql,
  effectiveProposalSpeakerInviteExpirySql,
} from "../invite-validity";
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
import { prepareConfirmedSpeakerAgendaAddition } from "./event-agenda/confirmed-speaker-addition";

export async function confirmSpeakerParticipation(
  db: DatabaseLike,
  authority: ParticipantAuthority,
  signingSecret: string,
  payload: {
    consents: Array<{ termKey: string; version: string }>;
    ip: string | null;
    userAgent: string | null;
    appBaseUrl: string;
  },
): Promise<{ status: "confirmed" | "pending"; outboxIds: string[] }> {
  const context = await getSpeakerByManageToken(db, authority, signingSecret, { allowExpiredSession: true });
  const outboxIds = await confirmParticipation(db, context, { kind: "speaker", authority, signingSecret, payload });
  const awaitingReview = isLateSpeakerResponseAwaitingReview(
    context.speaker.status,
    context.speaker.response_invite_generation,
    context.speaker.invite_generation,
  );
  return {
    status:
      context.speaker.status !== "confirmed" && (context.inviteExpired || awaitingReview) ? "pending" : "confirmed",
    outboxIds,
  };
}

/** Confirms the displayed identity and participation on behalf of the speaker, with attributed terms and notice. */
export async function acceptSpeakerParticipationByManager(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  userId: string,
  appBaseUrl: string,
): Promise<string[]> {
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
      payload: {
        consents: Array<{ termKey: string; version: string }>;
        ip: string | null;
        userAgent: string | null;
        appBaseUrl: string;
      };
    };

async function confirmParticipation(
  db: DatabaseLike,
  context: SpeakerWithContext,
  confirmation: SpeakerConfirmation,
): Promise<string[]> {
  const { speaker, proposal, currentRepresentation } = context;
  const manager = confirmation.kind === "manager" ? confirmation.actor : undefined;
  if (speaker.status === "confirmed") return [];
  const reviewingLateResponse =
    Boolean(manager) &&
    isLateSpeakerResponseAwaitingReview(speaker.status, speaker.response_invite_generation, speaker.invite_generation);
  const onBehalf = Boolean(manager) && !reviewingLateResponse;
  const late = !manager && context.inviteExpired;
  if (
    !manager &&
    isLateSpeakerResponseAwaitingReview(speaker.status, speaker.response_invite_generation, speaker.invite_generation)
  )
    return [];
  const nextStatus = late ? "pending" : "confirmed";
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
      reviewingLateResponse
        ? "The speaker’s representation is no longer available. Send a new invitation and ask the speaker to choose a current identity before approval."
        : "Confirm your speaker identity before confirming participation.",
    );
  const now = nowIso();
  const organizerIdentity = onBehalf ? await prepareOrganizerSpeakerIdentity(db, context, now) : null;
  // The current representation exists only once the speaker chose, and only while that identity is still theirs.
  if (!onBehalf && !currentRepresentation) throw representationRequired();
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
    !onBehalf && speaker.acting_identity_id
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
  const lateConsentGuard = reviewingLateResponse
    ? await prepareLateSpeakerConsentGuard(db, proposal.event_id, speaker.user_id)
    : null;
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
  const notices = await prepareSpeakerResponseNotices(db, context, {
    late,
    appBaseUrl: confirmation.kind === "manager" ? confirmation.appBaseUrl : confirmation.payload.appBaseUrl,
    at: now,
    approved: reviewingLateResponse,
  });
  const invitationScope = {
    sql: `SELECT 1 FROM proposal_speakers ps
      JOIN session_proposals sp ON sp.id=ps.proposal_id AND sp.deleted_at IS NULL
      JOIN events e ON e.id=sp.event_id
      WHERE ps.id=? AND ps.status IN ('invited','pending')`,
    bindings: [speaker.id],
  };
  const effectiveExpiry = effectiveProposalSpeakerInviteExpirySql("ps", "e");
  const databaseNow = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  const rosterRevision = await getProposalSpeakerRosterRevision(db, proposal.id);
  // A speaker who confirms after placement joins every session their proposal was placed in, in this same batch.
  const agendaAddition = late
    ? []
    : await prepareConfirmedSpeakerAgendaAddition(db, {
        eventId: proposal.event_id,
        proposalId: proposal.id,
        proposalStatus: proposal.status,
        speaker: { userId: speaker.user_id, proposalRole: speaker.role },
        actor: manager ? { type: "admin", id: manager.id } : { type: "user", id: speaker.user_id },
        at: now,
      });
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
            allowExpiredSession: true,
          }),
      ...(manager
        ? [
            prepareAuthorizationGuard(db, {
              sql: `${invitationScope.sql} AND (((${activeEffectiveInviteExpirySql(effectiveExpiry, databaseNow)}) AND (ps.status<>'pending' OR ps.response_invite_generation IS NULL)) OR (ps.status='pending' AND ps.terms_accepted_at IS NOT NULL AND ps.response_invite_generation=ps.invite_generation))`,
              bindings: invitationScope.bindings,
            }),
          ]
        : []),
      ...(!manager
        ? [
            prepareAuthorizationGuard(db, {
              sql: `${invitationScope.sql} AND (${effectiveExpiry}) IS NOT NULL AND (${late ? inactiveEffectiveInviteExpirySql(effectiveExpiry, databaseNow) : activeEffectiveInviteExpirySql(effectiveExpiry, databaseNow)})`,
              bindings: invitationScope.bindings,
            }),
          ]
        : []),
      prepareProposalSpeakerRosterRevisionGuard(db, {
        proposalId: proposal.id,
        expectedRevision: rosterRevision,
      }),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM proposal_speakers WHERE id=? AND user_id=? AND acting_identity_id IS ? AND acting_identity_selected_at IS ?",
        bindings: [speaker.id, speaker.user_id, speaker.acting_identity_id, speaker.acting_identity_selected_at],
      }),
      ...(representation ? [prepareAuthorizationGuard(db, representation)] : []),
      ...(!onBehalf && mailbox ? [prepareAuthorizationGuard(db, mailbox)] : []),
      ...(organizerIdentity?.guards ?? []),
      prepareActiveTermsSnapshotGuard(db, proposal.event_id, requiredTerms, "speaker"),
      ...(lateConsentGuard ? [lateConsentGuard] : []),
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
           SET response_invite_generation = invite_generation, status = ?, confirmed_at = ?, terms_accepted_at = ?,
               acting_identity_id = ?, acting_identity_selected_at = ?
           WHERE id = ? AND proposal_id = ? AND user_id = ? AND role = ? AND status = ? AND invite_generation = ?
             AND acting_identity_id IS ? AND acting_identity_selected_at IS ?
             AND response_invite_generation IS ? AND terms_accepted_at IS ?
             AND EXISTS (
               SELECT 1 FROM session_proposals
               WHERE id = ? AND status = ? AND updated_at = ? AND deleted_at IS NULL
             )`,
        )
        .bind(
          nextStatus,
          late ? null : now,
          reviewingLateResponse ? speaker.terms_accepted_at : now,
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
          speaker.response_invite_generation ?? null,
          speaker.terms_accepted_at,
          proposal.id,
          proposal.status,
          proposal.updated_at,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "proposal", id: speaker.proposal_id },
        manager ? "admin" : "user",
        manager?.id ?? speaker.user_id,
        reviewingLateResponse
          ? "speaker_late_response_approved"
          : manager
            ? "speaker_confirmed_by_organizer"
            : late
              ? "speaker_late_response"
              : "speaker_confirmed",
        "proposal_speaker",
        speaker.id,
        {
          proposalId: speaker.proposal_id,
          ...(manager
            ? {
                speakerUserId: speaker.user_id,
                acceptanceSource: reviewingLateResponse ? "speaker" : "organizer",
                termsAcceptedAt: reviewingLateResponse ? speaker.terms_accepted_at : now,
                actingIdentityId: reviewingLateResponse
                  ? speaker.acting_identity_id
                  : (organizerIdentity?.identityId ?? null),
                ...(onBehalf ? { terms: requiredTerms.filter((term) => term.required === 1) } : {}),
                notificationOutboxId: notification?.id,
              }
            : {}),
        },
        now,
      ),
      ...(notification ? [notification.statement] : []),
      ...notices.map((notice) => notice.statement),
      ...(await prepareProposalRoleCapacityForSpeakerChange(db, {
        eventId: proposal.event_id,
        userId: speaker.user_id,
        proposalRole: speaker.role,
        sourceRef: proposal.id,
        status: proposalParticipantStatus(proposal.status, nextStatus),
        sourceRevisionAdvance: 1,
      })),
      ...agendaAddition,
    ]);
  } catch (error) {
    if (isAgendaScheduleGuardFailure(error)) throwAgendaRevisionError(error);
    if (error instanceof Error && error.message.includes("AGENDA_REVISION_CHANGED"))
      throw new AppError(
        409,
        "PROPOSAL_SPEAKER_CONFLICT",
        "The agenda changed while the confirmation was processed. Try again.",
      );
    if (
      manager &&
      !reviewingLateResponse &&
      isAuthorizationGuardFailure(error) &&
      (await first(
        db,
        `${invitationScope.sql} AND (${inactiveEffectiveInviteExpirySql(effectiveExpiry, databaseNow)})`,
        invitationScope.bindings,
      ))
    )
      throw new AppError(410, "SPEAKER_INVITATION_EXPIRED", "Speaker invitation has expired");
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
  return [...(notification ? [notification.id] : []), ...notices.flatMap((notice) => notice.ids)];
}
