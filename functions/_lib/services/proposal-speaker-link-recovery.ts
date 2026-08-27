import { first } from "../db/queries";
import { prepareQueueEmailStatementWhen } from "../email/outbox";
import type { DatabaseLike } from "../types";
import { queuedCapabilityToken } from "./capability-links";
import { buildEventEmailVariables, type EventRecord } from "./events";
import { speakerManagePageUrl } from "./frontend-links";
import { buildProposalInviteEmailContext } from "./proposal-invite-email-context";
import { PROPOSAL_INACTIVE_STATUS_SQL_LIST } from "./proposal-status-policy";

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
}

/** Queues a speaker recovery email only while the selected speaker and proposal remain active. */
export async function queueProposalSpeakerManageLinkRecovery(
  db: DatabaseLike,
  event: EventRecord,
  email: string,
  appBaseUrl: string,
): Promise<string | null> {
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
     FROM users u
     JOIN proposal_speakers ps ON ps.user_id = u.id
     JOIN session_proposals sp ON sp.id = ps.proposal_id
     WHERE u.normalized_email = ?
       AND sp.event_id = ?
       AND ps.role <> 'proposer'
       AND ps.status IN ('invited', 'confirmed')
       AND sp.status NOT IN (${PROPOSAL_INACTIVE_STATUS_SQL_LIST})
       AND sp.deleted_at IS NULL
     ORDER BY ps.created_at DESC
     LIMIT 1`,
    [email, event.id],
  );
  if (!speaker) return null;

  const context = await buildProposalInviteEmailContext(db, {
    proposalId: speaker.proposal_id,
    inviterUserId: speaker.proposer_user_id,
  });
  const manageUrl = speakerManagePageUrl(
    appBaseUrl,
    event,
    queuedCapabilityToken("speaker_manage", speaker.speaker_id),
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
        firstName: speaker.first_name ?? "",
        lastName: speaker.last_name ?? "",
        invitedByDisplay: context.invitedByDisplay,
        proposalTitle: context.proposalTitle,
        proposalAbstract: context.proposalAbstract,
        speakerLineupText: context.speakerLineupText,
        manageUrl,
        isReminder: true,
      },
    },
    {
      sql: `SELECT 1
              FROM proposal_speakers ps
              JOIN session_proposals sp ON sp.id = ps.proposal_id
              JOIN users u ON u.id = ps.user_id
             WHERE ps.id = ? AND ps.proposal_id = ? AND ps.user_id = ?
               AND ps.role <> 'proposer' AND ps.status IN ('invited', 'confirmed')
               AND sp.event_id = ? AND sp.status NOT IN (${PROPOSAL_INACTIVE_STATUS_SQL_LIST})
               AND sp.deleted_at IS NULL AND sp.updated_at = ?
               AND u.normalized_email = ? AND u.updated_at = ?`,
      bindings: [
        speaker.speaker_id,
        speaker.proposal_id,
        speaker.user_id,
        event.id,
        speaker.proposal_updated_at,
        speaker.normalized_email,
        speaker.user_updated_at,
      ],
    },
  );
  const result = await queued.statement.run();
  return result.meta?.changes === 1 ? queued.id : null;
}
