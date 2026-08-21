import { AppError } from "../errors";
import { first } from "../db/queries";
import { nowIso } from "../utils/time";
import { sha256Hex } from "../utils/crypto";
import { newCapabilityLinkSecret, queuedCapabilityToken, signCapabilityToken } from "./capability-links";
import { prepareSyncProposalParticipantRole, proposalParticipantStatus } from "./proposal-participants";
import { formatInvitePerson as formatInvitePersonRecord } from "./proposal-invite-email-context";
import type { DatabaseLike, StatementLike } from "../types";
import type { ProposalManageSpeakerStatus } from "../../../assets/shared/schemas/proposal-management";
import type { SpeakerRole } from "../../../assets/shared/schemas/registration";

export interface ProposalSpeakerRecord {
  id: string;
  proposal_id: string;
  user_id: string;
  role: SpeakerRole;
  status: ProposalManageSpeakerStatus;
  manage_link_secret: string | null;
  terms_accepted_at: string | null;
  confirmed_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  created_at: string;
  invite_generation: number;
}

export async function buildAddProposalSpeaker(
  db: DatabaseLike,
  payload: {
    proposalId: string;
    userId: string;
    role: string;
    signingSecret?: string;
    proposalContext?: { event_id: string; status: string };
  },
): Promise<{
  manageToken: string;
  speakerId: string;
  inviteGeneration: number;
  alreadyPresent: boolean;
  statements: StatementLike[];
}> {
  const isProposer = payload.role === "proposer";
  const existingSpeaker = await first<{
    id: string;
    manage_link_secret: string | null;
    status: string;
    invite_generation: number;
  }>(
    db,
    `SELECT id, manage_link_secret, status, invite_generation
     FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?`,
    [payload.proposalId, payload.userId],
  );
  const speakerId =
    existingSpeaker?.id ?? (await sha256Hex(`proposal-speaker\0${payload.proposalId}\0${payload.userId}`)).slice(0, 32);
  const manageLinkSecret = existingSpeaker?.manage_link_secret ?? newCapabilityLinkSecret();
  const inviteGeneration = (existingSpeaker?.invite_generation ?? 0) + (existingSpeaker?.status === "declined" ? 1 : 0);
  const status = isProposer ? "confirmed" : "invited";
  const now = nowIso();
  const confirmedAt = isProposer ? now : null;
  const proposal =
    payload.proposalContext ??
    (await first<{ event_id: string; status: string }>(
      db,
      "SELECT event_id, status FROM session_proposals WHERE id = ?",
      [payload.proposalId],
    ));

  const statements: StatementLike[] = [
    db
      .prepare(
        `INSERT INTO proposal_speakers
           (id, proposal_id, user_id, role, status, manage_link_secret, confirmed_at, created_at, invite_generation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(proposal_id, user_id) DO UPDATE SET
           role = excluded.role,
           status = CASE WHEN proposal_speakers.status = 'declined' THEN 'invited' ELSE proposal_speakers.status END,
           manage_link_secret = COALESCE(proposal_speakers.manage_link_secret, excluded.manage_link_secret),
           confirmed_at = COALESCE(proposal_speakers.confirmed_at, excluded.confirmed_at),
           invite_generation = CASE
             WHEN proposal_speakers.status = 'declined' THEN proposal_speakers.invite_generation + 1
             ELSE proposal_speakers.invite_generation
           END,
           speaker_invite_reminder_count = CASE
             WHEN proposal_speakers.status = 'declined' THEN 0
             ELSE proposal_speakers.speaker_invite_reminder_count
           END,
           speaker_invite_last_communication_at = CASE
             WHEN proposal_speakers.status = 'declined' THEN excluded.created_at
             ELSE proposal_speakers.speaker_invite_last_communication_at
           END,
           speaker_invite_reminders_paused_until = CASE
             WHEN proposal_speakers.status = 'declined' THEN NULL
             ELSE proposal_speakers.speaker_invite_reminders_paused_until
           END`,
      )
      .bind(
        speakerId,
        payload.proposalId,
        payload.userId,
        payload.role,
        status,
        manageLinkSecret,
        confirmedAt,
        now,
        inviteGeneration,
      ),
  ];
  if (proposal) {
    statements.push(
      ...prepareSyncProposalParticipantRole(db, {
        eventId: proposal.event_id,
        userId: payload.userId,
        proposalRole: payload.role,
        sourceRef: payload.proposalId,
        status: proposalParticipantStatus(proposal.status, status),
      }),
    );
  }

  const manageToken = payload.signingSecret
    ? await signCapabilityToken({
        signingSecret: payload.signingSecret,
        linkSecret: manageLinkSecret,
        purpose: "speaker_manage",
        resourceId: speakerId,
      })
    : queuedCapabilityToken("speaker_manage", speakerId);
  return {
    manageToken,
    speakerId,
    inviteGeneration,
    alreadyPresent: Boolean(existingSpeaker),
    statements,
  };
}

export async function addProposalSpeaker(
  db: DatabaseLike,
  payload: Omit<Parameters<typeof buildAddProposalSpeaker>[1], "proposalContext">,
): Promise<{ manageToken: string }> {
  const { manageToken, speakerId, statements } = await buildAddProposalSpeaker(db, payload);
  await db.batch(statements);
  if (payload.signingSecret) {
    const persistedSpeaker = await first<{ manage_link_secret: string | null }>(
      db,
      "SELECT manage_link_secret FROM proposal_speakers WHERE id = ?",
      [speakerId],
    );
    if (!persistedSpeaker?.manage_link_secret) {
      throw new AppError(500, "SPEAKER_LINK_UNAVAILABLE", "Speaker manage link could not be issued");
    }
    return {
      manageToken: await signCapabilityToken({
        signingSecret: payload.signingSecret,
        linkSecret: persistedSpeaker.manage_link_secret,
        purpose: "speaker_manage",
        resourceId: speakerId,
      }),
    };
  }
  return { manageToken };
}

export async function updateProposalSpeakerRole(
  db: DatabaseLike,
  payload: { proposalId: string; userId: string; role: string },
): Promise<void> {
  await db.batch(await buildUpdateProposalSpeakerRoleStatements(db, payload));
}

export async function buildUpdateProposalSpeakerRoleStatements(
  db: DatabaseLike,
  payload: { proposalId: string; userId: string; role: string },
): Promise<StatementLike[]> {
  const proposal = await first<{ event_id: string; status: string }>(
    db,
    "SELECT event_id, status FROM session_proposals WHERE id = ?",
    [payload.proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  const speaker = await first<{ id: string; status: string }>(
    db,
    "SELECT id, status FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
    [payload.proposalId, payload.userId],
  );
  if (!speaker) throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker not found on this proposal");

  return [
    db
      .prepare("UPDATE proposal_speakers SET role = ? WHERE proposal_id = ? AND user_id = ?")
      .bind(payload.role, payload.proposalId, payload.userId),
    ...prepareSyncProposalParticipantRole(db, {
      eventId: proposal.event_id,
      userId: payload.userId,
      proposalRole: payload.role,
      sourceRef: payload.proposalId,
      status: proposalParticipantStatus(proposal.status, speaker.status),
    }),
  ];
}

export async function refreshSpeakerManageToken(db: DatabaseLike, proposalId: string, userId: string): Promise<string> {
  const speaker = await first<{ id: string }>(
    db,
    "SELECT id FROM proposal_speakers WHERE proposal_id = ? AND user_id = ?",
    [proposalId, userId],
  );
  if (!speaker) throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker not found on this proposal");
  return queuedCapabilityToken("speaker_manage", speaker.id);
}

export interface ProposalSpeakerUserProfile {
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  headshot_r2_key: string | null;
  headshot_updated_at: string | null;
}

export interface ProposalSpeakerWithUser extends ProposalSpeakerUserProfile {
  speaker_id: string;
  user_id: string;
  role: SpeakerRole;
  status: ProposalManageSpeakerStatus;
  manage_link_secret: string | null;
  confirmed_at: string | null;
  declined_at: string | null;
  terms_accepted_at: string | null;
  decline_reason: string | null;
  created_at: string;
}

export const PROPOSAL_SPEAKER_WITH_USER_COLUMNS = `ps.id AS speaker_id, ps.user_id, ps.role, ps.status,
  ps.manage_link_secret, ps.confirmed_at, ps.declined_at, ps.terms_accepted_at, ps.decline_reason, ps.created_at,
  u.email, u.first_name, u.last_name, u.organization_name, u.job_title,
  u.biography, u.links_json, u.headshot_r2_key, u.headshot_updated_at`;

export function prepareProposalSpeakerWithUserById(db: DatabaseLike, speakerId: string): StatementLike {
  return db
    .prepare(
      `SELECT ${PROPOSAL_SPEAKER_WITH_USER_COLUMNS}
       FROM proposal_speakers ps
       JOIN users u ON u.id = ps.user_id
       WHERE ps.id = ?`,
    )
    .bind(speakerId);
}

export function prepareProposalSpeakersWithStatus(db: DatabaseLike, proposalId: string): StatementLike {
  return db
    .prepare(
      `SELECT ${PROPOSAL_SPEAKER_WITH_USER_COLUMNS}
       FROM proposal_speakers ps
       JOIN users u ON u.id = ps.user_id
       WHERE ps.proposal_id = ?
       ORDER BY ps.created_at ASC`,
    )
    .bind(proposalId);
}

export { buildProposalInviteEmailContext, type ProposalInviteEmailContext } from "./proposal-invite-email-context";

export function formatInvitePerson(
  firstName: string | null,
  lastName: string | null,
  organizationName: string | null,
  fallback: string,
): string {
  return formatInvitePersonRecord({
    email: fallback,
    first_name: firstName,
    last_name: lastName,
    organization_name: organizationName,
  });
}

export async function listProposalSpeakersWithStatus(
  db: DatabaseLike,
  proposalId: string,
): Promise<ProposalSpeakerWithUser[]> {
  const result = await prepareProposalSpeakersWithStatus(db, proposalId).all<ProposalSpeakerWithUser>();
  return result.results ?? [];
}
