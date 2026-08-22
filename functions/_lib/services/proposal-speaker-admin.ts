import type {
  AdminProposalSpeaker,
  AdminProposalSpeakerPatch,
  AdminProposalSpeakerPatchResponse,
  AdminProposalSpeakersResponse,
} from "../../../assets/shared/schemas/admin-event-proposals";
import type { ProposalStatus } from "../../../assets/shared/schemas/proposal-status";
import { getProposalAccessForEvent } from "../auth/proposal-access";
import { batchFirst, batchRows } from "../db/pagination";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../types";
import { nowIso } from "../utils/time";
import { parseLinksJson, serializeLinks } from "../../../assets/shared/schemas/links";
import { isAuditOneChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { prepareSyncProposalParticipantRole, proposalParticipantStatus } from "./proposal-participants";
import {
  assertProposalSpeakerRoleTransition,
  prepareProposalSpeakersWithStatus,
  prepareProposalSpeakerWithUserById,
  type ProposalSpeakerWithUser,
} from "./proposal-speakers";
import { prepareSpeakerProfileStatement } from "./proposals-speaker-profile";
import type { UserProfilePatch } from "./users";
import { publicUserHeadshotUrl } from "./user-headshot";

interface AdminProposalRosterRow {
  id: string;
  event_id: string;
  title: string;
  status: ProposalStatus;
  presentation_deadline: string | null;
  presentation_uploaded_at: string | null;
}

interface AdminSpeakerEditSnapshot extends ProposalSpeakerWithUser {
  proposal_event_id: string;
  proposal_status: ProposalStatus;
  proposal_updated_at: string;
  proposer_user_id: string;
  user_updated_at: string;
}

export function toAdminProposalSpeaker(speaker: ProposalSpeakerWithUser, appBaseUrl: string): AdminProposalSpeaker {
  const hasBio = Boolean(speaker.biography);
  const hasHeadshot = Boolean(speaker.headshot_r2_key);
  return {
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
    addedAt: speaker.created_at,
    biography: speaker.biography,
    links: parseLinksJson(speaker.links_json),
    profileComplete: hasBio && hasHeadshot,
    hasHeadshot,
    hasBio,
    headshotUrl: publicUserHeadshotUrl(appBaseUrl, speaker.headshot_r2_key, speaker.headshot_updated_at),
    headshotUpdatedAt: speaker.headshot_updated_at,
  };
}

async function requireProposalSpeakerPermission(
  db: DatabaseLike,
  actor: AuthAdmin,
  eventId: string,
  permission: "review" | "manage",
): Promise<void> {
  const access = await getProposalAccessForEvent(db, eventId, actor);
  const allowed = permission === "review" ? access.canReview : access.canFinalize;
  if (!allowed) {
    throw new AppError(
      403,
      "FORBIDDEN",
      permission === "review"
        ? "Missing permission to review proposal speakers"
        : "Missing permission to edit proposal speakers",
    );
  }
}

export async function getAdminProposalSpeakerRoster(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  appBaseUrl: string,
): Promise<AdminProposalSpeakersResponse> {
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
    prepareProposalSpeakersWithStatus(db, proposalId),
  ]);
  const proposal = batchFirst<AdminProposalRosterRow>(proposalResult);
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  await requireProposalSpeakerPermission(db, actor, proposal.event_id, "review");

  const speakerRows = batchRows<ProposalSpeakerWithUser>(speakersResult);
  const speakers = speakerRows.map((speaker) => toAdminProposalSpeaker(speaker, appBaseUrl));
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

async function getAdminSpeakerEditSnapshot(
  db: DatabaseLike,
  proposalId: string,
  userId: string,
): Promise<AdminSpeakerEditSnapshot> {
  const speaker = await first<AdminSpeakerEditSnapshot>(
    db,
    `SELECT ps.id AS speaker_id, ps.user_id, ps.role, ps.status, ps.manage_link_secret,
            ps.confirmed_at, ps.declined_at, ps.terms_accepted_at, ps.decline_reason, ps.created_at,
            u.email, u.first_name, u.last_name, u.organization_name, u.job_title,
            u.biography, u.links_json, u.headshot_r2_key, u.headshot_updated_at, u.updated_at AS user_updated_at,
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

function nullablePatchValue(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : value || null;
}

function buildSpeakerPatch(
  current: AdminSpeakerEditSnapshot,
  patch: AdminProposalSpeakerPatch,
): {
  profile: UserProfilePatch;
  role: AdminSpeakerEditSnapshot["role"];
  changes: Record<string, { from: unknown; to: unknown }>;
} {
  const profile: UserProfilePatch = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const fields = [
    ["firstName", "first_name"],
    ["lastName", "last_name"],
    ["organizationName", "organization_name"],
    ["jobTitle", "job_title"],
    ["biography", "biography"],
  ] as const;
  for (const [patchKey, rowKey] of fields) {
    const next = nullablePatchValue(patch[patchKey]);
    if (next === undefined) continue;
    profile[patchKey] = next;
    if (next !== current[rowKey]) changes[patchKey] = { from: current[rowKey], to: next };
  }

  if (patch.links !== undefined) {
    const previousLinks = parseLinksJson(current.links_json);
    if (JSON.stringify(previousLinks) !== JSON.stringify(patch.links)) {
      profile.linksJson = patch.links.length > 0 ? serializeLinks(patch.links) : null;
      changes.links = { from: previousLinks, to: patch.links };
    }
  }

  const role = patch.role ?? current.role;
  if (role !== current.role) changes.role = { from: current.role, to: role };
  return { profile, role, changes };
}

export async function editAdminProposalSpeaker(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  userId: string,
  patch: AdminProposalSpeakerPatch,
  appBaseUrl: string,
): Promise<AdminProposalSpeakerPatchResponse> {
  const current = await getAdminSpeakerEditSnapshot(db, proposalId, userId);
  await requireProposalSpeakerPermission(db, actor, current.proposal_event_id, "manage");
  const next = buildSpeakerPatch(current, patch);
  assertProposalSpeakerRoleTransition({
    currentProposerUserId: current.proposer_user_id,
    speakerUserId: userId,
    nextRole: next.role,
  });
  if (Object.keys(next.changes).length === 0) {
    return { success: true, speaker: toAdminProposalSpeaker(current, appBaseUrl) };
  }

  const now = nowIso();
  const statements: StatementLike[] = [
    db
      .prepare(
        `UPDATE proposal_speakers
         SET role = ?
         WHERE id = ? AND proposal_id = ? AND user_id = ? AND role = ? AND status = ?
           AND EXISTS (
             SELECT 1
             FROM session_proposals sp
             JOIN users u ON u.id = ?
             WHERE sp.id = ? AND sp.event_id = ? AND sp.status = ? AND sp.updated_at = ?
               AND sp.deleted_at IS NULL
               AND u.updated_at = ?
               AND u.first_name IS ? AND u.last_name IS ? AND u.organization_name IS ?
               AND u.job_title IS ? AND u.biography IS ? AND u.links_json IS ?
               AND u.headshot_r2_key IS ? AND u.headshot_updated_at IS ?
           )`,
      )
      .bind(
        next.role,
        current.speaker_id,
        proposalId,
        userId,
        current.role,
        current.status,
        userId,
        proposalId,
        current.proposal_event_id,
        current.proposal_status,
        current.proposal_updated_at,
        current.user_updated_at,
        current.first_name,
        current.last_name,
        current.organization_name,
        current.job_title,
        current.biography,
        current.links_json,
        current.headshot_r2_key,
        current.headshot_updated_at,
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
        ...next.changes,
      },
      now,
    ),
  ];

  if (Object.keys(next.profile).length > 0) {
    statements.push(prepareSpeakerProfileStatement(db, userId, next.profile));
  }
  if (next.role !== current.role) {
    statements.push(
      ...prepareSyncProposalParticipantRole(db, {
        eventId: current.proposal_event_id,
        userId,
        proposalRole: next.role,
        sourceRef: proposalId,
        status: proposalParticipantStatus(current.proposal_status, current.status),
      }),
    );
  }
  statements.push(prepareProposalSpeakerWithUserById(db, current.speaker_id));

  let results;
  try {
    results = await db.batch(statements);
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "PROPOSAL_SPEAKER_CONFLICT", "Proposal speaker changed while the update was processed");
    }
    throw error;
  }
  const updated = batchFirst<ProposalSpeakerWithUser>(results.at(-1)!);
  if (!updated) throw new AppError(500, "PROPOSAL_SPEAKER_UPDATE_FAILED", "Unable to load the updated speaker");
  return { success: true, speaker: toAdminProposalSpeaker(updated, appBaseUrl) };
}
