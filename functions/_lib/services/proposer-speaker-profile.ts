/**
 * What the proposer changes on a roster row through proposal management: the
 * speaker's role. A speaker's name and photo belong to the person and their
 * profile to the identity they speak as; only the speaker edits those, on
 * their own speaker page.
 */
import type { ParticipantAuthority } from "./participant-authority";
import { isProposalSpeakerRosterEditableStatus } from "../../../assets/shared/schemas/proposal-status";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { assertProposalSpeakerRoleTransition, prepareProposalSpeakerRoleChange } from "./proposal-speakers";
import { getProposalByManageToken, type ProposalRecord } from "./proposals";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import { isEventParticipantSourceConflict } from "./event-participant-source-revision";
import type { ProposalSpeakerRole } from "../../../assets/shared/schemas/participant-roles";
import type { ProposalAccessSpeakerStatus } from "../../../assets/shared/schemas/proposal-management";

export interface ProposerManagedSpeaker {
  id: string;
  user_id: string;
  role: ProposalSpeakerRole;
  status: ProposalAccessSpeakerStatus;
}

export async function getProposerManagedSpeakerContext(
  db: DatabaseLike,
  manageToken: ParticipantAuthority,
  userId: string,
  signingSecret: string,
): Promise<{ proposal: ProposalRecord; speaker: ProposerManagedSpeaker }> {
  const proposal = await getProposalByManageToken(db, manageToken, signingSecret);
  const speaker = await first<ProposerManagedSpeaker>(
    db,
    "SELECT ps.id, ps.user_id, ps.status, ps.role FROM proposal_speakers ps WHERE ps.proposal_id = ? AND ps.user_id = ?",
    [proposal.id, userId],
  );
  if (!speaker) throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker not found on this proposal");
  if (!isProposalSpeakerRosterEditableStatus(proposal.status)) {
    throw new AppError(400, "PROPOSAL_CLOSED", "Cannot update speakers on a closed proposal");
  }
  return { proposal, speaker };
}

/** Changes a roster row's role; returns false when the role is already the requested one. */
export async function updateProposalSpeakerRoleByProposer(
  db: DatabaseLike,
  payload: { proposal: ProposalRecord; speaker: ProposerManagedSpeaker; role: ProposalSpeakerRole },
): Promise<boolean> {
  if (payload.role === payload.speaker.role) return false;
  assertProposalSpeakerRoleTransition({
    currentProposerUserId: payload.proposal.proposer_user_id,
    speakerUserId: payload.speaker.user_id,
    nextRole: payload.role,
  });
  const roleChange = await prepareProposalSpeakerRoleChange(db, {
    proposalId: payload.proposal.id,
    eventId: payload.proposal.event_id,
    proposalStatus: payload.proposal.status,
    proposalUpdatedAt: payload.proposal.updated_at,
    userId: payload.speaker.user_id,
    speakerId: payload.speaker.id,
    currentRole: payload.speaker.role,
    currentStatus: payload.speaker.status,
    nextRole: payload.role,
  });
  try {
    await db.batch([
      roleChange.updateStatement,
      // Kept directly after the write it checks; later capacity statements also change one row.
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "proposal", id: payload.proposal.id },
        "user",
        payload.proposal.proposer_user_id,
        "speaker_profile_updated_by_proposer",
        "proposal_speaker",
        payload.speaker.id,
        {
          proposalId: payload.proposal.id,
          speakerUserId: payload.speaker.user_id,
          role: { from: payload.speaker.role, to: payload.role },
        },
      ),
      ...roleChange.capacityStatements,
    ]);
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) throw registrationChangedError();
    if (isAuditChangeGuardFailure(error) || isEventParticipantSourceConflict(error)) {
      throw new AppError(409, "PROPOSAL_SPEAKER_CONFLICT", "Proposal speaker changed while the role was updated");
    }
    throw error;
  }
  return true;
}
