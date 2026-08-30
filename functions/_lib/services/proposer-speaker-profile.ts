import { parseLinksJson } from "../../../assets/shared/schemas/links";
import { isProposalSpeakerRosterEditableStatus } from "../../../assets/shared/schemas/proposal-status";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import {
  assertProposalSpeakerRoleTransition,
  prepareProposalSpeakerRoleChange,
  proposalSpeakerEffectiveHeadshotExpression,
  proposalSpeakerEffectiveProfileColumns,
} from "./proposal-speakers";
import { getProposalByManageToken, type ProposalRecord } from "./proposals";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import { isEventParticipantSourceConflict } from "./event-participant-source-revision";
import type { ProposalSpeakerRole } from "../../../assets/shared/schemas/participant-roles";
import type { ProposalAccessSpeakerStatus } from "../../../assets/shared/schemas/proposal-management";
import {
  updateProposalProfileOverrides,
  type ProposalProfilePatch,
  type ProposalProfileValues,
} from "./proposal-speaker-profile-overrides";

export interface ProposerManagedSpeaker {
  id: string;
  user_id: string;
  role: ProposalSpeakerRole;
  status: ProposalAccessSpeakerStatus;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  headshot_r2_key: string | null;
  headshot_override_set: number;
  headshot_override_r2_key: string | null;
  headshot_override_updated_at: string | null;
  profile_overrides_json: string;
  base_first_name: string | null;
  base_last_name: string | null;
  base_organization_name: string | null;
  base_job_title: string | null;
  base_biography: string | null;
  base_links_json: string | null;
}

export interface ProposerSpeakerProfilePatch {
  role?: string;
  firstName?: string | null;
  lastName?: string | null;
  organizationName?: string | null;
  jobTitle?: string | null;
  biography?: string | null;
  links?: string[];
}

export async function getProposerManagedSpeakerContext(
  db: DatabaseLike,
  manageToken: string,
  userId: string,
  signingSecret: string,
): Promise<{ proposal: ProposalRecord; speaker: ProposerManagedSpeaker }> {
  const proposal = await getProposalByManageToken(db, manageToken, signingSecret);
  const speaker = await first<ProposerManagedSpeaker>(
    db,
    `SELECT ps.id, ps.user_id, ps.status, ps.role,
            ${proposalSpeakerEffectiveProfileColumns()},
            ${proposalSpeakerEffectiveHeadshotExpression("u", "ps")} AS headshot_r2_key,
            ps.profile_overrides_json,
            ps.headshot_override_set,
            ps.headshot_r2_key AS headshot_override_r2_key,
            ps.headshot_updated_at AS headshot_override_updated_at,
            u.first_name AS base_first_name, u.last_name AS base_last_name,
            u.organization_name AS base_organization_name, u.job_title AS base_job_title,
            u.biography AS base_biography, u.links_json AS base_links_json
       FROM proposal_speakers ps
       JOIN users u ON u.id = ps.user_id
      WHERE ps.proposal_id = ? AND ps.user_id = ?`,
    [proposal.id, userId],
  );
  if (!speaker) throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker not found on this proposal");
  if (!isProposalSpeakerRosterEditableStatus(proposal.status)) {
    throw new AppError(400, "PROPOSAL_CLOSED", "Cannot update speakers on a closed proposal");
  }
  return { proposal, speaker };
}

export async function updateProposalSpeakerByProposer(
  db: DatabaseLike,
  payload: {
    proposal: ProposalRecord;
    speaker: ProposerManagedSpeaker;
    patch: ProposerSpeakerProfilePatch;
  },
): Promise<boolean> {
  const statements: StatementLike[] = [];
  const details: Record<string, { from: unknown; to: unknown }> = {};
  const baseValues: ProposalProfileValues = {
    firstName: payload.speaker.base_first_name,
    lastName: payload.speaker.base_last_name,
    organizationName: payload.speaker.base_organization_name,
    jobTitle: payload.speaker.base_job_title,
    biography: payload.speaker.base_biography,
    links: parseLinksJson(payload.speaker.base_links_json),
  };
  const profilePatch: ProposalProfilePatch = {};
  const databaseKeys = {
    firstName: "first_name",
    lastName: "last_name",
    organizationName: "organization_name",
    jobTitle: "job_title",
    biography: "biography",
  } as const;

  for (const key of ["firstName", "lastName", "organizationName", "jobTitle", "biography"] as const) {
    if (payload.patch[key] !== undefined) {
      const value = payload.patch[key] ?? null;
      details[key] = { from: payload.speaker[databaseKeys[key]], to: value };
      profilePatch[key] = value;
    }
  }
  if (payload.patch.links !== undefined) {
    details.links = { from: parseLinksJson(payload.speaker.links_json), to: payload.patch.links };
    profilePatch.links = payload.patch.links;
  }
  const profileOverridesJson = updateProposalProfileOverrides(
    payload.speaker.profile_overrides_json,
    baseValues,
    profilePatch,
  );
  const profileChanges = profileOverridesJson !== payload.speaker.profile_overrides_json;
  const roleChanges = payload.patch.role !== undefined && payload.patch.role !== payload.speaker.role;
  if (roleChanges) {
    assertProposalSpeakerRoleTransition({
      currentProposerUserId: payload.proposal.proposer_user_id,
      speakerUserId: payload.speaker.user_id,
      nextRole: payload.patch.role!,
    });
    details.role = { from: payload.speaker.role, to: payload.patch.role };
  }
  if (profileChanges && roleChanges) {
    statements.push(
      db
        .prepare(
          `UPDATE proposal_speakers
           SET role = ?, profile_overrides_json = ?
           WHERE id = ? AND proposal_id = ? AND user_id = ? AND role = ? AND status = ?
             AND profile_overrides_json IS ?
             AND EXISTS (
               SELECT 1 FROM session_proposals
               WHERE id = ? AND status = ? AND updated_at = ? AND deleted_at IS NULL
             )`,
        )
        .bind(
          payload.patch.role,
          profileOverridesJson,
          payload.speaker.id,
          payload.proposal.id,
          payload.speaker.user_id,
          payload.speaker.role,
          payload.speaker.status,
          payload.speaker.profile_overrides_json,
          payload.proposal.id,
          payload.proposal.status,
          payload.proposal.updated_at,
        ),
    );
  } else if (profileChanges) {
    statements.push(
      db
        .prepare(
          `UPDATE proposal_speakers
           SET profile_overrides_json = ?
           WHERE id = ? AND proposal_id = ? AND user_id = ? AND status = ?
             AND profile_overrides_json IS ?
             AND EXISTS (
               SELECT 1 FROM session_proposals
               WHERE id = ? AND status = ? AND updated_at = ? AND deleted_at IS NULL
             )`,
        )
        .bind(
          profileOverridesJson,
          payload.speaker.id,
          payload.proposal.id,
          payload.speaker.user_id,
          payload.speaker.status,
          payload.speaker.profile_overrides_json,
          payload.proposal.id,
          payload.proposal.status,
          payload.proposal.updated_at,
        ),
    );
  }
  if (profileChanges) {
    // Keep the changes()-based guard immediately after the write it validates.
    // Later capacity statements can also affect one row and must not mask a
    // stale profile/role update.
    statements.push(
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "proposal", id: payload.proposal.id },
        "user",
        payload.proposal.proposer_user_id,
        "speaker_profile_updated_by_proposer",
        "proposal_speaker",
        payload.speaker.id,
        { proposalId: payload.proposal.id, speakerUserId: payload.speaker.user_id, ...details },
      ),
    );
  }
  if (roleChanges) {
    const roleChange = await prepareProposalSpeakerRoleChange(db, {
      proposalId: payload.proposal.id,
      eventId: payload.proposal.event_id,
      proposalStatus: payload.proposal.status,
      proposalUpdatedAt: payload.proposal.updated_at,
      userId: payload.speaker.user_id,
      speakerId: payload.speaker.id,
      currentRole: payload.speaker.role,
      currentStatus: payload.speaker.status,
      nextRole: payload.patch.role as ProposalSpeakerRole,
    });
    if (!profileChanges) statements.push(roleChange.updateStatement);
    if (!profileChanges) {
      statements.push(
        prepareScopedAuditLogAfterOneChange(
          db,
          { type: "proposal", id: payload.proposal.id },
          "user",
          payload.proposal.proposer_user_id,
          "speaker_profile_updated_by_proposer",
          "proposal_speaker",
          payload.speaker.id,
          { proposalId: payload.proposal.id, speakerUserId: payload.speaker.user_id, ...details },
        ),
      );
    }
    statements.push(...roleChange.capacityStatements);
  }
  if (statements.length === 0) return false;
  try {
    await db.batch(statements);
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) {
      throw registrationChangedError();
    }
    if (isAuditChangeGuardFailure(error) || isEventParticipantSourceConflict(error)) {
      throw new AppError(409, "PROPOSAL_SPEAKER_CONFLICT", "Proposal speaker changed while the role was updated");
    }
    throw error;
  }
  return true;
}
