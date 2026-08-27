import { first } from "../db/queries";
import { emailPlainText } from "../email/plain-text";
import { prepareQueueEmailStatementWhen } from "../email/outbox";
import type { DatabaseLike } from "../types";
import { buildEventEmailVariables, type EventRecord } from "./events";
import { speakerManagePageUrl } from "./frontend-links";
import { buildProposalInviteEmailContext, proposalInviteEmailTextVariables } from "./proposal-invite-email-context";
import { PROPOSAL_INACTIVE_STATUS_SQL_LIST } from "./proposal-status-policy";
import { effectiveProposalSpeakerInviteExpirySql } from "../invite-validity";
import { nowIso } from "../utils/time";
import { queuedSpeakerManageToken } from "./proposal-speakers";

interface SpeakerManageLinkMatch {
  speaker_id: string;
  proposal_id: string;
  proposer_user_id: string;
  proposal_updated_at: string;
  user_id: string;
  email: string;
  normalized_email: string;
  first_name: string | null;
  last_name: string | null;
  user_updated_at: string;
  speaker_status: string;
  invite_expires_at: string | null;
  manage_link_secret: string | null;
  event_starts_at: string | null;
  event_ends_at: string | null;
}

/** Queues a speaker recovery email only while the selected speaker and proposal remain active. */
export async function queueProposalSpeakerManageLinkRecovery(
  db: DatabaseLike,
  event: EventRecord,
  email: string,
  appBaseUrl: string,
): Promise<string | null> {
  const now = nowIso();
  const speaker = await first<SpeakerManageLinkMatch>(
    db,
    `SELECT
       ps.id AS speaker_id,
       ps.proposal_id,
       sp.proposer_user_id,
       sp.updated_at AS proposal_updated_at,
       u.id AS user_id,
       u.email,
       u.normalized_email,
       u.first_name,
       u.last_name,
       u.updated_at AS user_updated_at
       ,ps.status AS speaker_status
       ,ps.invite_expires_at
       ,ps.manage_link_secret
       ,e.starts_at AS event_starts_at
       ,e.ends_at AS event_ends_at
     FROM users u
     JOIN proposal_speakers ps ON ps.user_id = u.id
     JOIN session_proposals sp ON sp.id = ps.proposal_id
     JOIN events e ON e.id = sp.event_id
     WHERE u.normalized_email = ?
       AND sp.event_id = ?
       AND ps.role <> 'proposer'
       AND ps.status IN ('invited', 'confirmed')
       AND (
         ps.status = 'confirmed'
         OR (
           ${effectiveProposalSpeakerInviteExpirySql("ps", "e")} IS NOT NULL
           AND unixepoch(${effectiveProposalSpeakerInviteExpirySql("ps", "e")}) > unixepoch(?)
         )
       )
       AND sp.status NOT IN (${PROPOSAL_INACTIVE_STATUS_SQL_LIST})
       AND sp.deleted_at IS NULL
     ORDER BY ps.created_at DESC
     LIMIT 1`,
    [email, event.id, now],
  );
  if (!speaker) return null;

  const context = await buildProposalInviteEmailContext(db, {
    proposalId: speaker.proposal_id,
    inviterUserId: speaker.proposer_user_id,
  });
  const manageUrl = speakerManagePageUrl(
    appBaseUrl,
    event,
    await queuedSpeakerManageToken(db, speaker.speaker_id, speaker.manage_link_secret),
  );
  const queued = prepareQueueEmailStatementWhen(
    db,
    {
      eventId: event.id,
      baseUrl: appBaseUrl,
      templateKey: "co_speaker_invite",
      recipientEmail: speaker.email,
      recipientUserId: speaker.user_id,
      messageType: "transactional",
      subject: `Your speaker management link for ${event.name}`,
      capabilityLinkValues: [manageUrl],
      data: {
        ...buildEventEmailVariables(event, appBaseUrl),
        firstName: emailPlainText(speaker.first_name ?? ""),
        lastName: emailPlainText(speaker.last_name ?? ""),
        ...proposalInviteEmailTextVariables(context),
        manageUrl,
        isReminder: true,
      },
    },
    {
      sql: `SELECT 1
              FROM proposal_speakers ps
              JOIN session_proposals sp ON sp.id = ps.proposal_id
              JOIN events e ON e.id = sp.event_id
              JOIN users u ON u.id = ps.user_id
             WHERE ps.id = ? AND ps.proposal_id = ? AND ps.user_id = ?
               AND ps.role <> 'proposer' AND ps.status IN ('invited', 'confirmed')
               AND ps.status = ? AND ps.invite_expires_at IS ?
               AND sp.event_id = ? AND sp.status NOT IN (${PROPOSAL_INACTIVE_STATUS_SQL_LIST})
               AND sp.deleted_at IS NULL AND sp.updated_at = ?
               AND e.starts_at IS ? AND e.ends_at IS ?
               AND (
                 ps.status = 'confirmed'
                 OR (
                   ${effectiveProposalSpeakerInviteExpirySql("ps", "e")} IS NOT NULL
                   AND unixepoch(${effectiveProposalSpeakerInviteExpirySql("ps", "e")}) > unixepoch(?)
                 )
               )
               AND u.normalized_email = ? AND u.updated_at = ?`,
      bindings: [
        speaker.speaker_id,
        speaker.proposal_id,
        speaker.user_id,
        speaker.speaker_status,
        speaker.invite_expires_at,
        event.id,
        speaker.proposal_updated_at,
        speaker.event_starts_at,
        speaker.event_ends_at,
        now,
        speaker.normalized_email,
        speaker.user_updated_at,
      ],
    },
  );
  const result = await queued.statement.run();
  return result.meta?.changes === 1 ? queued.id : null;
}
