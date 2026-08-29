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
import { parseLinksJson, serializeLinks } from "../../../assets/shared/schemas/links";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "./audit";
import { prepareProposalRoleCapacityForSpeakerChange, proposalParticipantStatus } from "./proposal-role-capacity";
import { isRegistrationTransitionConflict, registrationChangedError } from "./registrations/transition-guard";
import { isEventParticipantSourceConflict } from "./event-participant-source-revision";
import {
  assertProposalSpeakerRoleTransition,
  proposalSpeakerEffectiveHeadshotExpression,
  proposalSpeakerEffectiveProfileExpression,
  prepareProposalSpeakersWithStatus,
  prepareProposalSpeakerWithUserById,
  type ProposalSpeakerWithUser,
} from "./proposal-speakers";
import type { UserProfilePatch } from "./users";
import { proposalSpeakerHeadshotUrl } from "./proposal-speaker-headshot-read-model";
import { publicUserHeadshotUrl } from "./user-headshot";
import {
  updateProposalProfileOverrides,
  type ProposalProfilePatch,
  type ProposalProfileValues,
} from "./proposal-speaker-profile-overrides";
import { requireProposalSpeakerPermission } from "./proposal-speaker-access";
import { isAuthorizationGuardFailure } from "../db/authorization-guard";
import { preparePermissionsAuthorizationGuard } from "../auth/permissions";
import { withProposalWriteContextGuard, type ProposalWriteAuthorization } from "./proposal-write-authorization";

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
  user_updated_at: string;
  profile_overrides_json: string;
  base_first_name: string | null;
  base_last_name: string | null;
  base_organization_name: string | null;
  base_job_title: string | null;
  base_biography: string | null;
  base_links_json: string | null;
  headshot_override_set: number;
  headshot_override_r2_key: string | null;
}

export function toProposalSpeaker(
  speaker: ProposalSpeakerWithUser,
  appBaseUrl: string,
  proposalId?: string,
  proposalHeadshotUrl?: (userId: string, updatedAt: string | null) => string,
): ProposalSpeaker {
  const hasBio = Boolean(speaker.biography);
  const hasHeadshot = Boolean(speaker.headshot_r2_key);
  const headshotUrl =
    speaker.headshot_r2_key?.startsWith("proposal-headshots/") && proposalId
      ? (proposalHeadshotUrl?.(speaker.user_id, speaker.headshot_updated_at) ??
        proposalSpeakerHeadshotUrl(appBaseUrl, proposalId, speaker.user_id, speaker.headshot_updated_at))
      : publicUserHeadshotUrl(appBaseUrl, speaker.headshot_r2_key, speaker.headshot_updated_at);
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
    proposalHeadshotUrl?: (userId: string, updatedAt: string | null) => string;
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
    prepareProposalSpeakersWithStatus(db, proposalId),
  ]);
  const proposal = batchFirst<ProposalRosterRow>(proposalResult);
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  if (!options?.skipLegacyReviewCheck) {
    await requireProposalSpeakerPermission(db, actor, proposal.event_id, "review");
  }

  const speakerRows = batchRows<ProposalSpeakerWithUser>(speakersResult);
  const speakers = speakerRows.map((speaker) =>
    toProposalSpeaker(speaker, appBaseUrl, proposalId, options?.proposalHeadshotUrl),
  );
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
    `SELECT ps.id AS speaker_id, ps.user_id, ps.role, ps.status, ps.manage_link_secret,
            ps.confirmed_at, ps.declined_at, ps.terms_accepted_at, ps.decline_reason, ps.created_at,
            u.email,
            ${proposalSpeakerEffectiveProfileExpression("u", "ps", "firstName", "first_name")} AS first_name,
            ${proposalSpeakerEffectiveProfileExpression("u", "ps", "lastName", "last_name")} AS last_name,
            ${proposalSpeakerEffectiveProfileExpression("u", "ps", "organizationName", "organization_name")} AS organization_name,
            ${proposalSpeakerEffectiveProfileExpression("u", "ps", "jobTitle", "job_title")} AS job_title,
            ${proposalSpeakerEffectiveProfileExpression("u", "ps", "biography", "biography")} AS biography,
            ${proposalSpeakerEffectiveProfileExpression("u", "ps", "links", "links_json")} AS links_json,
            ${proposalSpeakerEffectiveHeadshotExpression("u", "ps")} AS headshot_r2_key,
            CASE WHEN ps.headshot_override_set = 1 THEN ps.headshot_updated_at ELSE u.headshot_updated_at END AS headshot_updated_at,
            ps.profile_overrides_json,
            ps.headshot_override_set,
            ps.headshot_r2_key AS headshot_override_r2_key,
            u.first_name AS base_first_name, u.last_name AS base_last_name,
            u.organization_name AS base_organization_name, u.job_title AS base_job_title,
            u.biography AS base_biography, u.links_json AS base_links_json,
            u.updated_at AS user_updated_at,
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
  current: SpeakerEditSnapshot,
  patch: ProposalSpeakerPatch,
): {
  profile: UserProfilePatch;
  role: SpeakerEditSnapshot["role"];
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
  const next = buildSpeakerPatch(current, patch);
  assertProposalSpeakerRoleTransition({
    currentProposerUserId: current.proposer_user_id,
    speakerUserId: userId,
    nextRole: next.role,
  });
  if (Object.keys(next.changes).length === 0) {
    return { success: true, speaker: toProposalSpeaker(current, appBaseUrl, proposalId) };
  }

  const now = nowIso();
  const baseValues: ProposalProfileValues = {
    firstName: current.base_first_name,
    lastName: current.base_last_name,
    organizationName: current.base_organization_name,
    jobTitle: current.base_job_title,
    biography: current.base_biography,
    links: parseLinksJson(current.base_links_json),
  };
  const profilePatch: ProposalProfilePatch = {
    firstName: next.profile.firstName,
    lastName: next.profile.lastName,
    organizationName: next.profile.organizationName,
    jobTitle: next.profile.jobTitle,
    biography: next.profile.biography,
    links: next.profile.linksJson === undefined ? undefined : parseLinksJson(next.profile.linksJson),
  };
  const profileOverridesJson = updateProposalProfileOverrides(current.profile_overrides_json, baseValues, profilePatch);
  const statements: StatementLike[] = [
    preparePermissionsAuthorizationGuard(db, actor, [
      { permission: "proposals:manage", context: { type: "event", id: current.proposal_event_id } },
    ]),
    db
      .prepare(
        `UPDATE proposal_speakers
         SET role = ?, profile_overrides_json = ?
         WHERE id = ? AND proposal_id = ? AND user_id = ? AND role = ? AND status = ?
           AND EXISTS (
             SELECT 1
             FROM session_proposals sp
             JOIN proposal_speakers ps ON ps.id = ? AND ps.proposal_id = sp.id AND ps.user_id = ?
             JOIN users u ON u.id = ps.user_id
             WHERE sp.id = ? AND sp.event_id = ? AND sp.status = ? AND sp.updated_at = ?
               AND sp.deleted_at IS NULL
               AND u.updated_at = ?
               AND ${proposalSpeakerEffectiveProfileExpression("u", "ps", "firstName", "first_name")} IS ?
               AND ${proposalSpeakerEffectiveProfileExpression("u", "ps", "lastName", "last_name")} IS ?
               AND ${proposalSpeakerEffectiveProfileExpression("u", "ps", "organizationName", "organization_name")} IS ?
               AND ${proposalSpeakerEffectiveProfileExpression("u", "ps", "jobTitle", "job_title")} IS ?
               AND ${proposalSpeakerEffectiveProfileExpression("u", "ps", "biography", "biography")} IS ?
               AND ${proposalSpeakerEffectiveProfileExpression("u", "ps", "links", "links_json")} IS ?
               AND ${proposalSpeakerEffectiveHeadshotExpression("u", "ps")} IS ?
               AND (CASE WHEN ps.headshot_override_set = 1 THEN ps.headshot_updated_at ELSE u.headshot_updated_at END) IS ?
               AND ps.profile_overrides_json IS ?
           )`,
      )
      .bind(
        next.role,
        profileOverridesJson,
        current.speaker_id,
        proposalId,
        userId,
        current.role,
        current.status,
        current.speaker_id,
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
        current.profile_overrides_json,
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

  if (next.role !== current.role) {
    statements.push(
      ...(await prepareProposalRoleCapacityForSpeakerChange(db, {
        eventId: current.proposal_event_id,
        userId,
        proposalRole: next.role,
        sourceRef: proposalId,
        status: proposalParticipantStatus(current.proposal_status, current.status),
      })),
    );
  }
  statements.push(prepareProposalSpeakerWithUserById(db, current.speaker_id));

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
  return { success: true, speaker: toProposalSpeaker(updated, appBaseUrl, proposalId) };
}
