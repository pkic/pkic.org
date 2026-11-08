import { personDisplayName } from "../../../assets/shared/person-display";
import { anotherProposalSpeakerRemainsSql, requireAnotherProposalSpeaker } from "./proposal-speaker-retention";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import {
  isLateSpeakerResponseAwaitingReview,
  lateSpeakerResponseAwaitingReviewSql,
} from "../../../assets/shared/proposal-speaker-acceptance";
import { requireUserBackedAuthAdmin } from "../auth/admin-identity";
import { preparePermissionsAuthorizationGuard } from "../auth/permissions";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike } from "../types";
import { nowIso } from "../utils/time";
import { isProposalSpeakerRosterEditableStatus } from "../../../assets/shared/schemas/proposal-status";
import { getSpeakerByProposalUser } from "./proposals-speaker-capability";
import { requireProposalSpeakerPermission } from "./proposal-speaker-access";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { getEventById } from "./events";
import { isEventParticipantSourceConflict } from "./event-participant-source-revision";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import { prepareProposalRoleCapacityForSpeakerRemoval } from "./proposal-role-capacity";
import { prepareDeclinedSpeakerAgendaRemoval } from "./event-agenda/declined-speaker-removal";
import { prepareSpeakerResponseNotices } from "./proposal-speaker-response-notice";

/** Declines late participation and reconciles its existing reservations in the same command. */
export async function rejectLateSpeakerParticipation(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  userId: string,
  appBaseUrl: string,
): Promise<string[]> {
  requireUserBackedAuthAdmin(actor);
  const context = await getSpeakerByProposalUser(db, proposalId, userId);
  await requireProposalSpeakerPermission(db, actor, context.proposal.event_id, "manage");
  const { speaker, proposal } = context;
  if (speaker.status === "declined") return [];
  if (
    !isLateSpeakerResponseAwaitingReview(
      speaker.status,
      speaker.response_invite_generation,
      speaker.invite_generation,
    ) ||
    !isProposalSpeakerRosterEditableStatus(proposal.status)
  )
    throw new AppError(409, "SPEAKER_REVIEW_NOT_PENDING", "This speaker has no late response awaiting review.");
  await requireAnotherProposalSpeaker(db, proposal.id);
  const at = nowIso();
  const event = await getEventById(db, proposal.event_id);
  const notices = await prepareSpeakerResponseNotices(db, context, {
    outcome: "rejected",
    appBaseUrl,
    at,
    event,
  });
  const agendaRemoval = await prepareDeclinedSpeakerAgendaRemoval(db, {
    event,
    proposal,
    speaker: {
      userId: speaker.user_id,
      name: personDisplayName({ firstName: context.user.first_name, lastName: context.user.last_name }, "A speaker"),
    },
    at,
    appBaseUrl,
  });
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [
        { permission: "proposals:manage", context: { type: "event", id: proposal.event_id } },
      ]),
      db
        .prepare(`UPDATE proposal_speakers SET status='declined',declined_at=?,decline_reason='Late participation was not approved'
        WHERE id=? AND invite_generation=? AND ${lateSpeakerResponseAwaitingReviewSql("proposal_speakers")} AND terms_accepted_at IS ?
          AND ${anotherProposalSpeakerRemainsSql}
          AND EXISTS(SELECT 1 FROM session_proposals WHERE id=? AND status=? AND updated_at=? AND deleted_at IS NULL)`)
        .bind(
          at,
          speaker.id,
          speaker.invite_generation,
          speaker.terms_accepted_at,
          proposal.id,
          proposal.id,
          proposal.status,
          proposal.updated_at,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "proposal", id: proposal.id },
        "admin",
        actor.id,
        "speaker_late_response_rejected",
        "proposal_speaker",
        speaker.id,
        { proposalId },
        at,
      ),
      ...notices.map((notice) => notice.statement),
      ...(await prepareProposalRoleCapacityForSpeakerRemoval(db, {
        eventId: proposal.event_id,
        userId: speaker.user_id,
        sourceRef: proposal.id,
      })),
      ...agendaRemoval,
    ]);
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) throw registrationChangedError();
    if (isAuditChangeGuardFailure(error)) await requireAnotherProposalSpeaker(db, proposal.id);
    if (
      isAuditChangeGuardFailure(error) ||
      isAuthorizationGuardFailure(error) ||
      isEventParticipantSourceConflict(error) ||
      (error instanceof Error && error.message.includes("AGENDA_REVISION_CHANGED"))
    )
      throw new AppError(
        409,
        "PROPOSAL_SPEAKER_CONFLICT",
        "The speaker response changed. Refresh before reviewing it.",
      );
    throw error;
  }
  return notices.flatMap((notice) => notice.ids);
}
