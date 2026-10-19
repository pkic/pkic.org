import type {
  ProposalSpeaker,
  ProposalSpeakerPatch,
  ProposalSpeakerPatchResponse,
  ProposalSpeakersResponse,
} from "../../../assets/shared/schemas/proposal-speakers";
import type { ProposalStatus } from "../../../assets/shared/schemas/proposal-status";
import { batchFirst, batchRows } from "../db/pagination";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";
import { nowIso } from "../utils/time";
import { parseLinksJson } from "../../../assets/shared/schemas/links";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { prepareProposalRoleCapacityForSpeakerChange, proposalParticipantStatus } from "./proposal-role-capacity";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import { isEventParticipantSourceConflict } from "./event-participant-source-revision";
import {
  assertProposalSpeakerRoleTransition,
  PROPOSAL_SPEAKER_WITH_USER_COLUMNS,
  prepareProposalSpeakerWithUserById,
  type ProposalSpeakerWithUser,
} from "./proposal-speakers";
import {
  prepareProposalSpeakerRosterWithIdentity,
  type ProposalSpeakerWithIdentity,
} from "./proposal-speaker-roster-read-model";
import { publicUserHeadshotUrl } from "./user-headshot";
import { requireProposalSpeakerPermission } from "./proposal-speaker-access";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { preparePermissionsAuthorizationGuard } from "../auth/permissions";
import { withProposalWriteContextGuard, type ProposalWriteAuthorization } from "./proposal-write-authorization";
import { proposalActingIdentityReadModel } from "./proposal-speaker-identity";
import { listCurrentIndependentDisclosures } from "./proposal-speaker-independent-disclosure";

interface ProposalRosterRow {
  id: string;
  event_id: string;
  title: string;
  status: ProposalStatus;
  presentation_deadline: string | null;
  presentation_uploaded_at: string | null;
}

interface SpeakerEditSnapshot extends ProposalSpeakerWithUser {
  proposal_event_id: string;
  proposal_status: ProposalStatus;
  proposal_updated_at: string;
  proposer_user_id: string;
}

export function toProposalSpeaker(speaker: ProposalSpeakerWithUser, appBaseUrl: string): ProposalSpeaker {
  const hasBio = Boolean(speaker.biography);
  const hasHeadshot = Boolean(speaker.headshot_r2_key);
  const headshotUrl = publicUserHeadshotUrl(
    appBaseUrl,
    speaker.user_id,
    speaker.headshot_r2_key,
    speaker.headshot_updated_at,
  );
  return {
    ...proposalActingIdentityReadModel(speaker),
    userId: speaker.user_id,
    role: speaker.role,
    status: speaker.status,
    email: speaker.email,
    firstName: speaker.first_name,
    lastName: speaker.last_name,
    organizationName: speaker.organization_name,
    jobTitle: speaker.job_title,
    confirmedAt: speaker.confirmed_at,
    declinedAt: speaker.declined_at,
    declineReason: speaker.decline_reason,
    termsAcceptedAt: speaker.terms_accepted_at,
    inviteExpiresAt: speaker.invite_expires_at,
    addedAt: speaker.created_at,
    biography: speaker.biography,
    links: parseLinksJson(speaker.links_json),
    profileComplete: hasBio && hasHeadshot,
    hasHeadshot,
    hasBio,
    headshotUrl,
    headshotUpdatedAt: speaker.headshot_updated_at,
  };
}

export async function getProposalSpeakerRoster(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  appBaseUrl: string,
  options?: {
    skipLegacyReviewCheck?: boolean;
  },
): Promise<ProposalSpeakersResponse> {
  const [proposalResult, speakersResult] = await db.batch([
    db
      .prepare(
        `SELECT sp.id, sp.event_id, sp.title, sp.status, sp.presentation_deadline,
                pv.uploaded_at AS presentation_uploaded_at
         FROM session_proposals sp
         LEFT JOIN presentation_versions pv
           ON pv.proposal_id = sp.id AND pv.is_current = 1 AND pv.deleted_at IS NULL
         WHERE sp.id = ? AND sp.deleted_at IS NULL`,
      )
      .bind(proposalId),
    prepareProposalSpeakerRosterWithIdentity(db, proposalId),
  ]);
  const proposal = batchFirst<ProposalRosterRow>(proposalResult);
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  if (!options?.skipLegacyReviewCheck) {
    await requireProposalSpeakerPermission(db, actor, proposal.event_id, "review");
  }

  const speakerRows = batchRows<ProposalSpeakerWithIdentity>(speakersResult);
  const registrationRows = await db
    .prepare(
      `SELECT ps.user_id AS userId, r.id AS registrationId, r.status AS registrationStatus,
              r.attendance_type AS attendanceType
       FROM proposal_speakers ps
       JOIN session_proposals sp ON sp.id = ps.proposal_id
       LEFT JOIN registrations r ON r.event_id = sp.event_id AND r.user_id = ps.user_id
       WHERE ps.proposal_id = ?`,
    )
    .bind(proposalId)
    .all<{
      userId: string;
      registrationId: string | null;
      registrationStatus: NonNullable<ProposalSpeakersResponse["speakers"][number]["registration"]>["status"] | null;
      attendanceType:
        | NonNullable<ProposalSpeakersResponse["speakers"][number]["registration"]>["attendanceType"]
        | null;
    }>();
  const registrationByUser = new Map(
    (registrationRows.results ?? []).flatMap((row) =>
      row.registrationId && row.registrationStatus && row.attendanceType
        ? [[row.userId, { id: row.registrationId, status: row.registrationStatus, attendanceType: row.attendanceType }]]
        : [],
    ),
  );
  const disclosures = await listCurrentIndependentDisclosures(db, proposalId);
  const speakers = speakerRows.map((speaker) => ({
    ...toProposalSpeaker(speaker, appBaseUrl),
    identityId: speaker.identity_id,
    registration: registrationByUser.get(speaker.user_id) ?? null,
    independentCapacity: disclosures.get(speaker.user_id) ?? null,
  }));
  const summary = {
    total: speakers.length,
    confirmed: 0,
    pending: 0,
    declined: 0,
    profileComplete: 0,
    presentationUploaded: proposal.presentation_uploaded_at ? 1 : 0,
  };
  for (const speaker of speakers) {
    if (speaker.status === "confirmed") summary.confirmed += 1;
    if (speaker.status === "pending" || speaker.status === "invited") summary.pending += 1;
    if (speaker.status === "declined") summary.declined += 1;
    if (speaker.profileComplete) summary.profileComplete += 1;
  }

  return {
    proposal: {
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      presentationDeadline: proposal.presentation_deadline,
      presentationUploaded: Boolean(proposal.presentation_uploaded_at),
      presentationUploadedAt: proposal.presentation_uploaded_at,
    },
    summary,
    speakers,
  };
}

async function getSpeakerEditSnapshot(
  db: DatabaseLike,
  proposalId: string,
  userId: string,
): Promise<SpeakerEditSnapshot> {
  const speaker = await first<SpeakerEditSnapshot>(
    db,
    `SELECT ${PROPOSAL_SPEAKER_WITH_USER_COLUMNS},
            sp.event_id AS proposal_event_id, sp.status AS proposal_status, sp.proposer_user_id,
            sp.updated_at AS proposal_updated_at
     FROM session_proposals sp
     JOIN proposal_speakers ps ON ps.proposal_id = sp.id AND ps.user_id = ?
     JOIN users u ON u.id = ps.user_id
     WHERE sp.id = ? AND sp.deleted_at IS NULL`,
    [userId, proposalId],
  );
  if (speaker) return speaker;

  const proposal = await first<{ id: string }>(
    db,
    "SELECT id FROM session_proposals WHERE id = ? AND deleted_at IS NULL",
    [proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker not found on this proposal");
}

/**
 * An organizer changes a speaker's role on this proposal. The speaker's name
 * and headshot belong to the person and their profile to the identity they
 * speak as; those are edited on their own resources, never copied onto the
 * roster row.
 */
export async function editProposalSpeaker(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  userId: string,
  patch: ProposalSpeakerPatch,
  appBaseUrl: string,
  authorization?: ProposalWriteAuthorization,
): Promise<ProposalSpeakerPatchResponse> {
  const current = await getSpeakerEditSnapshot(db, proposalId, userId);
  await requireProposalSpeakerPermission(db, actor, current.proposal_event_id, "manage");
  assertProposalSpeakerRoleTransition({
    currentProposerUserId: current.proposer_user_id,
    speakerUserId: userId,
    nextRole: patch.role,
  });
  if (patch.role === current.role) {
    return { success: true, speaker: toProposalSpeaker(current, appBaseUrl) };
  }

  const now = nowIso();
  const statements: StatementLike[] = [
    preparePermissionsAuthorizationGuard(db, actor, [
      { permission: "proposals:manage", context: { type: "event", id: current.proposal_event_id } },
    ]),
    db
      .prepare(
        `UPDATE proposal_speakers
         SET role = ?
         WHERE id = ? AND proposal_id = ? AND user_id = ? AND role = ? AND status = ?
           AND EXISTS (
             SELECT 1 FROM session_proposals sp
             WHERE sp.id = ? AND sp.event_id = ? AND sp.status = ? AND sp.updated_at = ? AND sp.deleted_at IS NULL
           )`,
      )
      .bind(
        patch.role,
        current.speaker_id,
        proposalId,
        userId,
        current.role,
        current.status,
        proposalId,
        current.proposal_event_id,
        current.proposal_status,
        current.proposal_updated_at,
      ),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "proposal", id: proposalId },
      "admin",
      actor.id,
      "speaker_profile_updated",
      "proposal_speaker",
      current.speaker_id,
      {
        proposalId: { from: null, to: proposalId },
        speakerUserId: { from: null, to: userId },
        adminEmail: { from: null, to: actor.email },
        role: { from: current.role, to: patch.role },
      },
      now,
    ),
    ...(await prepareProposalRoleCapacityForSpeakerChange(db, {
      eventId: current.proposal_event_id,
      userId,
      proposalRole: patch.role,
      sourceRef: proposalId,
      status: proposalParticipantStatus(current.proposal_status, current.status),
    })),
    prepareProposalSpeakerWithUserById(db, current.speaker_id),
  ];

  let results;
  try {
    results = await db.batch(withProposalWriteContextGuard(authorization, statements));
  } catch (error) {
    if (isRegistrationTransitionConflict(error)) {
      throw registrationChangedError();
    }
    if (
      isAuditChangeGuardFailure(error) ||
      isEventParticipantSourceConflict(error) ||
      isAuthorizationGuardFailure(error)
    ) {
      throw new AppError(409, "PROPOSAL_SPEAKER_CONFLICT", "Proposal speaker changed while the update was processed");
    }
    throw error;
  }
  const updated = batchFirst<ProposalSpeakerWithUser>(results.at(-1)!);
  if (!updated) throw new AppError(500, "PROPOSAL_SPEAKER_UPDATE_FAILED", "Unable to load the updated speaker");
  return { success: true, speaker: toProposalSpeaker(updated, appBaseUrl) };
}
