import { all, first } from "../db/queries";
import { prepareQueueEmailStatement } from "../email/outbox";
import { emailPlainText } from "../email/plain-text";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import type { AuthAdmin } from "../types";
import { nowIso } from "../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLog, prepareScopedAuditLogAfterOneChange } from "./audit";
import { buildEventEmailVariables, getEventById, type EventRecord } from "./events";
import { speakerManagePageUrl, speakerPresentationPageUrl } from "./frontend-links";
import { buildProposalInviteEmailContext, proposalInviteEmailTextVariables } from "./proposal-invite-email-context";
import {
  proposalSpeakerEffectiveHeadshotExpression,
  proposalSpeakerEffectiveProfileColumns,
  queuedSpeakerManageToken,
} from "./proposal-speakers";
import type { ProposalRecord } from "./proposals";
import { isProposalInactiveStatus } from "./proposal-status-policy";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { preparePermissionsAuthorizationGuard } from "../auth/permissions";
import { withProposalWriteContextGuard, type ProposalWriteAuthorization } from "./proposal-write-authorization";
import {
  activeEffectiveInviteExpirySql,
  effectiveProposalSpeakerInviteExpirySql,
  effectiveStoredInviteExpiry,
} from "../invite-validity";

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
  manage_link_secret: string | null;
  invite_expires_at: string | null;
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
    `SELECT ps.id AS proposal_speaker_id, ps.user_id, ps.status, ps.manage_link_secret, ps.invite_expires_at,
            u.email, ${proposalSpeakerEffectiveProfileColumns("u", "ps")},
            ${proposalSpeakerEffectiveHeadshotExpression("u", "ps")} AS headshot_r2_key,
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

function prepareReminderSnapshotGuard(
  db: DatabaseLike,
  proposal: ReminderProposal,
  speakers: readonly ReminderSpeaker[],
  event: Pick<EventRecord, "starts_at" | "ends_at">,
  now: string,
  userId?: string,
): StatementLike {
  const speakerPredicates = speakers.map(
    () => `EXISTS (
      SELECT 1 FROM proposal_speakers ps
      JOIN users u ON u.id = ps.user_id
      JOIN events e ON e.id = sp.event_id
      WHERE ps.id = ? AND ps.proposal_id = sp.id AND ps.user_id = ? AND ps.status = ? AND u.email = ?
        AND ps.invite_expires_at IS ?
        AND (
          ps.status <> 'invited'
          OR (
            ${activeEffectiveInviteExpirySql(effectiveProposalSpeakerInviteExpirySql("ps", "e"))}
          )
        )
    )`,
  );
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 FROM session_proposals sp
          WHERE sp.id = ? AND sp.event_id = ? AND sp.status = ? AND sp.deleted_at IS NULL
            AND COALESCE((SELECT final_status FROM proposal_decisions WHERE proposal_id = sp.id), '') = ?
            AND EXISTS (
              SELECT 1 FROM events e
              WHERE e.id = sp.event_id AND e.starts_at IS ? AND e.ends_at IS ?
            )
            AND (SELECT COUNT(*) FROM proposal_speakers ps
                 WHERE ps.proposal_id = sp.id ${userId ? "AND ps.user_id = ?" : "AND ps.status <> 'declined'"}) = ?
            ${speakerPredicates.length > 0 ? `AND ${speakerPredicates.join(" AND ")}` : ""}`,
    bindings: [
      proposal.id,
      proposal.event_id,
      proposal.status,
      proposal.decision_status ?? "",
      event.starts_at,
      event.ends_at,
      ...(userId ? [userId] : []),
      speakers.length,
      ...speakers.flatMap((speaker) => [
        speaker.proposal_speaker_id,
        speaker.user_id,
        speaker.status,
        speaker.email,
        speaker.invite_expires_at,
        now,
      ]),
    ],
  });
}

function assertInvitationActive(
  speaker: ReminderSpeaker,
  event: Pick<EventRecord, "starts_at" | "ends_at">,
  now: string,
): void {
  if (speaker.status !== "invited") return;
  const expiresAt = effectiveStoredInviteExpiry(event, speaker.invite_expires_at);
  if (!expiresAt || Date.parse(expiresAt) <= Date.parse(now)) {
    throw new AppError(410, "SPEAKER_INVITATION_EXPIRED", "Speaker invitation has expired");
  }
}

export async function sendProposalSpeakerReminders(
  db: DatabaseLike,
  payload: {
    proposalId: string;
    userId?: string;
    kind: "profile" | "presentation";
    actor: AuthAdmin;
    appBaseUrl: string;
    authorization?: ProposalWriteAuthorization;
  },
): Promise<{ outboxIds: string[] }> {
  const proposal = await loadReminderProposal(db, payload.proposalId);
  if (isProposalInactiveStatus(proposal.status)) {
    throw new AppError(409, "PROPOSAL_CLOSED", "Cannot send reminders for a closed proposal");
  }
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
  for (const speaker of speakers) assertInvitationActive(speaker, event, now);
  const manageTokens = await Promise.all(
    speakers.map((speaker) => queuedSpeakerManageToken(db, speaker.proposal_speaker_id, speaker.manage_link_secret)),
  );
  statements.push(
    preparePermissionsAuthorizationGuard(db, payload.actor, [
      { permission: "proposals:manage", context: { type: "event", id: proposal.event_id } },
    ]),
    prepareReminderSnapshotGuard(db, proposal, speakers, event, now, payload.userId),
  );
  for (const [index, speaker] of speakers.entries()) {
    const token = manageTokens[index];
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
          proposalId: proposal.id,
          speakerUserId: speaker.user_id,
          firstName: emailPlainText(speaker.first_name ?? ""),
          proposalTitle: emailPlainText(proposal.title),
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
      prepareScopedAuditLog(
        db,
        { type: "proposal", id: proposal.id },
        "admin",
        payload.actor.id,
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
  if (statements.length > 0) {
    try {
      await db.batch(withProposalWriteContextGuard(payload.authorization, statements));
    } catch (error) {
      if (isAuthorizationGuardFailure(error) || isAuditChangeGuardFailure(error)) {
        throw new AppError(
          409,
          "PROPOSAL_SPEAKER_CONFLICT",
          "The proposal context changed while reminders were queued",
        );
      }
      throw error;
    }
  }
  return { outboxIds };
}

export async function remindProposalSpeakerByProposer(
  db: DatabaseLike,
  payload: { proposal: ProposalRecord; userId: string; appBaseUrl: string },
): Promise<{ outboxId: string }> {
  if (isProposalInactiveStatus(payload.proposal.status)) {
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
  const now = nowIso();
  assertInvitationActive(speaker, event, now);
  const manageUrl = speakerManagePageUrl(
    payload.appBaseUrl,
    event,
    await queuedSpeakerManageToken(db, speaker.proposal_speaker_id, speaker.manage_link_secret),
  );
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
            proposalId: payload.proposal.id,
            speakerUserId: speaker.user_id,
            firstName: emailPlainText(speaker.first_name ?? ""),
            proposalTitle: emailPlainText(inviteContext.proposalTitle),
            profileUrl: manageUrl,
            hasHeadshot: speaker.headshot_r2_key ? "true" : "",
            hasBio: speaker.biography ? "true" : "",
          }
        : {
            ...buildEventEmailVariables(event, payload.appBaseUrl),
            proposalId: payload.proposal.id,
            speakerUserId: speaker.user_id,
            firstName: emailPlainText(speaker.first_name ?? ""),
            lastName: emailPlainText(speaker.last_name ?? ""),
            ...proposalInviteEmailTextVariables({
              ...inviteContext,
              inviterFirstName: proposer?.first_name ?? inviteContext.inviterFirstName,
            }),
            manageUrl,
            isReminder: true,
          },
    },
    now,
  );
  try {
    await db.batch([
      queued.statement,
      db
        .prepare(
          `UPDATE proposal_speakers
           SET speaker_invite_reminder_count = speaker_invite_reminder_count + 1,
               speaker_invite_last_communication_at = ?, speaker_invite_reminders_paused_until = NULL
           WHERE id = ? AND proposal_id = ? AND user_id = ? AND status = ?
             AND invite_expires_at IS ?
             AND EXISTS (
               SELECT 1
               FROM session_proposals sp
               JOIN events e ON e.id = sp.event_id
               JOIN users u ON u.id = proposal_speakers.user_id
               WHERE sp.id = proposal_speakers.proposal_id
                 AND sp.id = ? AND sp.event_id = ? AND sp.proposer_user_id = ?
                 AND sp.status = ? AND sp.updated_at = ? AND sp.deleted_at IS NULL
                 AND e.starts_at IS ? AND e.ends_at IS ?
                 AND (
                   proposal_speakers.status <> 'invited'
                   OR (
                     ${activeEffectiveInviteExpirySql(
                       effectiveProposalSpeakerInviteExpirySql("proposal_speakers", "e"),
                     )}
                   )
                 )
                 AND u.id = ? AND u.email = ?
             )`,
        )
        .bind(
          now,
          speaker.proposal_speaker_id,
          payload.proposal.id,
          speaker.user_id,
          speaker.status,
          speaker.invite_expires_at,
          payload.proposal.id,
          payload.proposal.event_id,
          payload.proposal.proposer_user_id,
          payload.proposal.status,
          payload.proposal.updated_at,
          event.starts_at,
          event.ends_at,
          now,
          speaker.user_id,
          speaker.email,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "proposal", id: payload.proposal.id },
        "user",
        payload.proposal.proposer_user_id,
        "co_speaker_reminded_by_proposer",
        "proposal_speaker",
        speaker.proposal_speaker_id,
        { proposalId: payload.proposal.id, speakerUserId: speaker.user_id, recipientEmail: speaker.email },
        now,
      ),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(
        409,
        "PROPOSAL_SPEAKER_CONFLICT",
        "The proposal or speaker changed while the reminder was prepared",
      );
    }
    throw error;
  }
  return { outboxId: queued.id };
}
