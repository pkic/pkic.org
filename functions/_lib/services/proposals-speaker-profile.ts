import { all, first } from "../db/queries";
import { AppError } from "../errors";
import { nowIso } from "../utils/time";
import { isAuditOneChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { isConsentAcceptanceContextConflict, prepareConsentStatements, validateRequiredConsents } from "./consent";
import { getRequiredTerms } from "./events";
import { getSpeakerByManageToken } from "./proposals";
import {
  proposalParticipantStatus,
  prepareProposalRoleCapacityForSpeakerChange,
  prepareProposalRoleCapacityForSpeakerRemoval,
} from "./proposal-role-capacity";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import { isEventParticipantSourceConflict } from "./event-participant-source-revision";
import {
  getProposalSpeakerRosterRevision,
  isProposalSpeakerRosterConflict,
  prepareProposalSpeakerRosterRevisionGuard,
} from "./proposal-speaker-roster-revision";
import { prepareUserProfileStatement, type UserProfilePatch } from "./users";
import {
  prepareClearProposalSpeakerProfileOverridesStatement,
  prepareProposalSpeakerProfileAuthorityGuard,
  type ProposalProfileField,
  type ProposalProfileOverrideSnapshot,
} from "./proposal-speaker-profile-overrides";
import { proposalSpeakerEffectiveProfileColumns } from "./proposal-speakers";
import type { DatabaseLike } from "../types";
import { isProposalSpeakerRosterEditableStatus } from "../../../assets/shared/schemas/proposal-status";

export async function getProposalCoSpeakers(
  db: DatabaseLike,
  proposalId: string,
  excludeUserId: string,
): Promise<{ firstName: string | null; lastName: string | null; status: string }[]> {
  return all<{ first_name: string | null; last_name: string | null; status: string }>(
    db,
    `SELECT ${proposalSpeakerEffectiveProfileColumns("u", "ps", "", ["firstName", "lastName"])}, ps.status
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
  manageToken: string,
  signingSecret: string,
  payload: {
    consents: Array<{ termKey: string; version: string }>;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  const { speaker, proposal } = await getSpeakerByManageToken(db, manageToken, signingSecret);

  if (speaker.status === "confirmed") {
    return;
  }
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
  const requiredTerms = await getRequiredTerms(db, proposal.event_id, "speaker");
  await validateRequiredConsents(requiredTerms, payload.consents);
  const rosterRevision = await getProposalSpeakerRosterRevision(db, proposal.id);
  const now = nowIso();
  try {
    await db.batch([
      prepareProposalSpeakerRosterRevisionGuard(db, {
        proposalId: proposal.id,
        expectedRevision: rosterRevision,
      }),
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
      isAuditOneChangeGuardFailure(error) ||
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

export async function declineSpeakerParticipation(
  db: DatabaseLike,
  manageToken: string,
  signingSecret: string,
  payload: { reason?: string | null },
): Promise<void> {
  const { speaker, proposal } = await getSpeakerByManageToken(db, manageToken, signingSecret);

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
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE proposal_speakers
           SET status = 'declined', declined_at = ?, decline_reason = ?
           WHERE id = ? AND proposal_id = ? AND user_id = ? AND role = ? AND status = ?
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
    ]);
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) {
      throw registrationChangedError();
    }
    if (!isAuditOneChangeGuardFailure(error) && !isEventParticipantSourceConflict(error)) throw error;

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

export async function updateSpeakerProfile(
  db: DatabaseLike,
  payload: UserProfilePatch,
  context: ProposalProfileOverrideSnapshot,
): Promise<void> {
  const fields: ProposalProfileField[] = [];
  if (payload.firstName !== undefined) fields.push("firstName");
  if (payload.lastName !== undefined) fields.push("lastName");
  if (payload.organizationName !== undefined) fields.push("organizationName");
  if (payload.jobTitle !== undefined) fields.push("jobTitle");
  if (payload.biography !== undefined) fields.push("biography");
  if (payload.linksJson !== undefined) fields.push("links");
  if (fields.length === 0) return;
  if (!isProposalSpeakerRosterEditableStatus(context.proposalStatus)) {
    throw new AppError(409, "PROPOSAL_CLOSED", "Speaker profiles cannot be changed on a closed proposal");
  }
  const statements = [
    prepareProposalSpeakerProfileAuthorityGuard(db, context),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "proposal", id: context.proposalId },
      "user",
      context.userId,
      "speaker_profile_updated_by_speaker",
      "proposal_speaker",
      context.proposalSpeakerId,
      { fields },
    ),
    prepareUserProfileStatement(db, context.userId, payload),
    prepareClearProposalSpeakerProfileOverridesStatement(db, context, fields),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(
        409,
        "PROPOSAL_SPEAKER_CONFLICT",
        "Proposal speaker profile changed while it was being updated",
      );
    }
    throw error;
  }
}

export const prepareSpeakerProfileStatement = prepareUserProfileStatement;
