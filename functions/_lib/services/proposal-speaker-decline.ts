import type { ParticipantAuthority } from "./participant-authority";
import { first } from "../db/queries";
import { AppError } from "../errors";
import { nowIso } from "../utils/time";
import type { DatabaseLike } from "../types";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { getEventById } from "./events";
import { getSpeakerByManageToken } from "./proposals";
import { prepareProposalRoleCapacityForSpeakerRemoval } from "./proposal-role-capacity";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import { isEventParticipantSourceConflict } from "./event-participant-source-revision";
import { isProposalSpeakerRosterEditableStatus } from "../../../assets/shared/schemas/proposal-status";
import { prepareDeclinedSpeakerAgendaRemoval } from "./event-agenda/declined-speaker-removal";

/**
 * A speaker declines their own participation. The decline, the roster's
 * capacity, and their removal from every session the proposal was placed in
 * commit together; the agenda's organizers are told through the outbox.
 */
export async function declineSpeakerParticipation(
  db: DatabaseLike,
  manageToken: ParticipantAuthority,
  signingSecret: string,
  payload: { reason?: string | null; appBaseUrl: string },
): Promise<void> {
  const { speaker, proposal, user } = await getSpeakerByManageToken(db, manageToken, signingSecret);

  if (speaker.status === "declined") {
    return;
  }
  if (!isProposalSpeakerRosterEditableStatus(proposal.status)) {
    throw new AppError(409, "PROPOSAL_CLOSED", "Speaker participation cannot be changed on a closed proposal");
  }

  const nonDeclined = await first<{ total: number }>(
    db,
    "SELECT COUNT(*) AS total FROM proposal_speakers WHERE proposal_id = ? AND status <> 'declined'",
    [proposal.id],
  );
  if (Number(nonDeclined?.total ?? 0) <= 1) {
    throw new AppError(
      409,
      "LAST_SPEAKER_REQUIRED",
      "A proposal must retain at least one speaker. Add another speaker or withdraw the proposal instead.",
    );
  }

  const now = nowIso();
  const event = await getEventById(db, proposal.event_id);
  // A speaker who declines leaves every session their proposal was placed in, in this same batch.
  const agendaRemoval = await prepareDeclinedSpeakerAgendaRemoval(db, {
    event,
    proposal,
    speaker: {
      userId: speaker.user_id,
      name: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email,
    },
    appBaseUrl: payload.appBaseUrl,
    at: now,
  });
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE proposal_speakers
           SET status = 'declined', declined_at = ?, decline_reason = ?
           WHERE id = ? AND proposal_id = ? AND user_id = ? AND role = ? AND status = ? AND invite_generation = ?
             AND (SELECT COUNT(*) FROM proposal_speakers
                  WHERE proposal_id = ? AND status <> 'declined') > 1
             AND EXISTS (
               SELECT 1 FROM session_proposals
               WHERE id = ? AND status = ? AND updated_at = ? AND deleted_at IS NULL
             )`,
        )
        .bind(
          now,
          payload.reason ?? null,
          speaker.id,
          proposal.id,
          speaker.user_id,
          speaker.role,
          speaker.status,
          speaker.invite_generation,
          proposal.id,
          proposal.id,
          proposal.status,
          proposal.updated_at,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "proposal", id: speaker.proposal_id },
        "user",
        speaker.user_id,
        "speaker_declined",
        "proposal_speaker",
        speaker.id,
        { proposalId: speaker.proposal_id, reason: payload.reason ?? null },
        now,
      ),
      ...(await prepareProposalRoleCapacityForSpeakerRemoval(db, {
        eventId: proposal.event_id,
        userId: speaker.user_id,
        sourceRef: proposal.id,
      })),
      ...agendaRemoval,
    ]);
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) {
      throw registrationChangedError();
    }
    if (error instanceof Error && error.message.includes("AGENDA_REVISION_CHANGED"))
      throw new AppError(
        409,
        "PROPOSAL_SPEAKER_CONFLICT",
        "The agenda changed while the decline was processed. Try again.",
      );
    if (!isAuditChangeGuardFailure(error) && !isEventParticipantSourceConflict(error)) throw error;

    const currentCount = await first<{ total: number }>(
      db,
      "SELECT COUNT(*) AS total FROM proposal_speakers WHERE proposal_id = ? AND status <> 'declined'",
      [proposal.id],
    );
    if (Number(currentCount?.total ?? 0) <= 1) {
      throw new AppError(
        409,
        "LAST_SPEAKER_REQUIRED",
        "A proposal must retain at least one speaker. Add another speaker or withdraw the proposal instead.",
      );
    }
    throw new AppError(409, "PROPOSAL_SPEAKER_CONFLICT", "Proposal speaker changed while the decline was processed");
  }
}
