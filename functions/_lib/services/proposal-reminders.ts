import { all, first } from "../db/queries";
import { prepareQueueEmailStatement } from "../email/outbox";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import { nowIso } from "../utils/time";
import { prepareAuditLog } from "./audit";
import { buildEventEmailVariables, getEventById } from "./events";
import { speakerManagePageUrl, speakerPresentationPageUrl } from "./frontend-links";
import { queuedCapabilityToken } from "./capability-links";
import { buildProposalInviteEmailContext } from "./proposal-speakers";
import type { ProposalRecord } from "./proposals";

interface ReminderProposal {
  id: string;
  event_id: string;
  title: string;
  abstract: string;
  proposer_user_id: string;
  status: string;
  decision_status: string | null;
}

interface ReminderSpeaker {
  proposal_speaker_id: string;
  user_id: string;
  status: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  headshot_r2_key: string | null;
  biography: string | null;
  presentation_id: string | null;
}

async function loadReminderProposal(db: DatabaseLike, proposalId: string): Promise<ReminderProposal> {
  const proposal = await first<ReminderProposal>(
    db,
    `SELECT sp.id, sp.event_id, sp.title, sp.abstract, sp.proposer_user_id, sp.status,
            pd.final_status AS decision_status
     FROM session_proposals sp
     LEFT JOIN proposal_decisions pd ON pd.proposal_id = sp.id
     WHERE sp.id = ? AND sp.deleted_at IS NULL`,
    [proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
  return proposal;
}

async function loadReminderSpeakers(db: DatabaseLike, proposalId: string, userId?: string): Promise<ReminderSpeaker[]> {
  const rows = await all<ReminderSpeaker>(
    db,
    `SELECT ps.id AS proposal_speaker_id, ps.user_id, ps.status,
            u.email, u.first_name, u.last_name, u.headshot_r2_key, u.biography,
            pv.id AS presentation_id
     FROM proposal_speakers ps
     JOIN users u ON u.id = ps.user_id
     LEFT JOIN presentation_versions pv
       ON pv.proposal_id = ps.proposal_id AND pv.is_current = 1 AND pv.deleted_at IS NULL
     WHERE ps.proposal_id = ? ${userId ? "AND ps.user_id = ?" : "AND ps.status != 'declined'"}
     ORDER BY ps.created_at ASC`,
    userId ? [proposalId, userId] : [proposalId],
  );
  if (userId && rows.length === 0) throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker not found on this proposal");
  if (userId && rows[0].status === "declined") {
    throw new AppError(409, "SPEAKER_DECLINED", "A speaker who declined cannot be reminded");
  }
  return rows;
}

export async function sendAdminProposalSpeakerReminders(
  db: DatabaseLike,
  payload: {
    proposalId: string;
    userId?: string;
    kind: "profile" | "presentation";
    actorUserId: string;
    appBaseUrl: string;
  },
): Promise<{ outboxIds: string[] }> {
  const proposal = await loadReminderProposal(db, payload.proposalId);
  if (payload.kind === "presentation" && proposal.decision_status !== "accepted") {
    throw new AppError(409, "PROPOSAL_NOT_ACCEPTED", "Presentation reminders can only be sent for accepted proposals");
  }
  const [event, speakers] = await Promise.all([
    getEventById(db, proposal.event_id),
    loadReminderSpeakers(db, proposal.id, payload.userId),
  ]);
  const statements: StatementLike[] = [];
  const outboxIds: string[] = [];
  const now = nowIso();
  for (const speaker of speakers) {
    const token = queuedCapabilityToken("speaker_manage", speaker.proposal_speaker_id);
    const actionUrl =
      payload.kind === "profile"
        ? speakerManagePageUrl(payload.appBaseUrl, event, token)
        : speakerPresentationPageUrl(payload.appBaseUrl, event, token);
    const templateKey = payload.kind === "profile" ? "speaker_profile_request" : "presentation_upload_request";
    const queued = prepareQueueEmailStatement(
      db,
      {
        eventId: event.id,
        baseUrl: payload.appBaseUrl,
        templateKey,
        recipientEmail: speaker.email,
        recipientUserId: speaker.user_id,
        subject:
          payload.kind === "profile"
            ? `Action required: complete your speaker profile — ${event.name}`
            : `Action required: upload your presentation — ${event.name}`,
        messageType: "transactional",
        capabilityLinkValues: [actionUrl],
        data: {
          ...buildEventEmailVariables(event, payload.appBaseUrl),
          firstName: speaker.first_name ?? "",
          proposalTitle: proposal.title,
          ...(payload.kind === "profile"
            ? {
                profileUrl: actionUrl,
                hasHeadshot: speaker.headshot_r2_key ? "true" : "",
                hasBio: speaker.biography ? "true" : "",
              }
            : { uploadUrl: actionUrl, hasPresentation: speaker.presentation_id ? "true" : "" }),
        },
      },
      now,
    );
    outboxIds.push(queued.id);
    statements.push(
      queued.statement,
      prepareAuditLog(
        db,
        "admin",
        payload.actorUserId,
        payload.kind === "profile" ? "speaker_profile_request_resent" : "presentation_upload_request_sent",
        "proposal_speaker",
        speaker.proposal_speaker_id,
        {
          proposalId: proposal.id,
          speakerUserId: speaker.user_id,
          recipientEmail: speaker.email,
          bulk: !payload.userId,
        },
        now,
      ),
    );
  }
  if (statements.length > 0) await db.batch(statements);
  return { outboxIds };
}

export async function remindProposalSpeakerByProposer(
  db: DatabaseLike,
  payload: { proposal: ProposalRecord; userId: string; appBaseUrl: string },
): Promise<{ outboxId: string }> {
  if (["withdrawn", "rejected"].includes(payload.proposal.status)) {
    throw new AppError(409, "PROPOSAL_CLOSED", "Cannot send reminders for a closed proposal");
  }
  const [event, speakers, inviteContext, proposer] = await Promise.all([
    getEventById(db, payload.proposal.event_id),
    loadReminderSpeakers(db, payload.proposal.id, payload.userId),
    buildProposalInviteEmailContext(db, {
      proposalId: payload.proposal.id,
      inviterUserId: payload.proposal.proposer_user_id,
    }),
    first<{ first_name: string | null }>(db, "SELECT first_name FROM users WHERE id = ?", [
      payload.proposal.proposer_user_id,
    ]),
  ]);
  const speaker = speakers[0];
  if (!speaker) throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker not found on this proposal");
  const isProfileReviewRequest = speaker.status === "confirmed";
  const manageUrl = speakerManagePageUrl(
    payload.appBaseUrl,
    event,
    queuedCapabilityToken("speaker_manage", speaker.proposal_speaker_id),
  );
  const now = nowIso();
  const queued = prepareQueueEmailStatement(
    db,
    {
      eventId: event.id,
      baseUrl: payload.appBaseUrl,
      templateKey: isProfileReviewRequest ? "speaker_profile_request" : "co_speaker_invite",
      recipientEmail: speaker.email,
      recipientUserId: speaker.user_id,
      messageType: "transactional",
      subject: isProfileReviewRequest
        ? `Action requested: review or update your speaker profile — ${event.name}`
        : `Reminder: confirm your participation — ${event.name}`,
      capabilityLinkValues: [manageUrl],
      data: isProfileReviewRequest
        ? {
            ...buildEventEmailVariables(event, payload.appBaseUrl),
            firstName: speaker.first_name ?? "",
            proposalTitle: inviteContext.proposalTitle,
            profileUrl: manageUrl,
            hasHeadshot: speaker.headshot_r2_key ? "true" : "",
            hasBio: speaker.biography ? "true" : "",
          }
        : {
            ...buildEventEmailVariables(event, payload.appBaseUrl),
            firstName: speaker.first_name ?? "",
            lastName: speaker.last_name ?? "",
            proposerFirstName: proposer?.first_name ?? "",
            invitedByDisplay: inviteContext.invitedByDisplay,
            proposalTitle: inviteContext.proposalTitle,
            proposalAbstract: inviteContext.proposalAbstract,
            speakerLineupText: inviteContext.speakerLineupText,
            manageUrl,
            isReminder: true,
          },
    },
    now,
  );
  await db.batch([
    queued.statement,
    db
      .prepare(
        `UPDATE proposal_speakers
         SET speaker_invite_reminder_count = speaker_invite_reminder_count + 1,
             speaker_invite_last_communication_at = ?, speaker_invite_reminders_paused_until = NULL
         WHERE id = ?`,
      )
      .bind(now, speaker.proposal_speaker_id),
    prepareAuditLog(
      db,
      "user",
      payload.proposal.proposer_user_id,
      "co_speaker_reminded_by_proposer",
      "proposal_speaker",
      speaker.proposal_speaker_id,
      { proposalId: payload.proposal.id, speakerUserId: speaker.user_id, recipientEmail: speaker.email },
      now,
    ),
  ]);
  return { outboxId: queued.id };
}
