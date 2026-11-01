import { all } from "../db/queries";
import { DIRECT_EMAIL_TEMPLATE_KEY, directEmailBodyPayload } from "../email/direct-body";
import { emailPlainText } from "../email/plain-text";
import { prepareQueueEmailStatementWhen } from "../email/outbox";
import type { DatabaseLike } from "../types";
import { buildEventEmailVariables, type EventRecord } from "./events";
import { speakerManagePageUrl } from "./frontend-links";
import { buildProposalInviteEmailContext, proposalInviteEmailTextVariables } from "./proposal-invite-email-context";
import { PROPOSAL_INACTIVE_STATUS_SQL_LIST } from "./proposal-status-policy";
import { activeEffectiveInviteExpirySql, effectiveProposalSpeakerInviteExpirySql } from "../invite-validity";
import { nowIso } from "../utils/time";
import { queuedSpeakerManageToken } from "./proposal-speakers";
import { unclaimedAccountSql } from "./proposal-speaker-account-authority";

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
): Promise<string[]> {
  const now = nowIso();
  const speakers: SpeakerManageLinkMatch[] = [];
  let cursor = "";
  while (true) {
    const page = await all<SpeakerManageLinkMatch>(
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
     WHERE u.active = 1 AND (u.email_verified_at IS NOT NULL OR ${unclaimedAccountSql("u")})
       AND (u.normalized_email = ? OR EXISTS (
         SELECT 1 FROM user_emails address WHERE address.user_id = u.id
           AND address.normalized_email = ? AND address.verified_at IS NOT NULL
       ))
       AND sp.event_id = ?
       AND ps.role <> 'proposer'
       AND ps.status IN ('invited', 'confirmed')
       AND (
         ps.status = 'confirmed'
         OR (
           ${activeEffectiveInviteExpirySql(effectiveProposalSpeakerInviteExpirySql("ps", "e"))}
         )
       )
       AND sp.status NOT IN (${PROPOSAL_INACTIVE_STATUS_SQL_LIST})
       AND sp.deleted_at IS NULL
       AND ps.id > ?
     ORDER BY ps.id
     LIMIT 20`,
      [email, email, event.id, now, cursor],
    );
    speakers.push(...page);
    if (page.length < 20) break;
    cursor = page[page.length - 1]!.speaker_id;
  }
  if (!speakers.length) return [];

  const queuedEmails = [];
  for (const speaker of speakers) {
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
        templateKey: DIRECT_EMAIL_TEMPLATE_KEY,
        recipientEmail: speaker.email,
        recipientUserId: speaker.user_id,
        messageType: "transactional",
        subject: `Your speaker management link for ${event.name}`,
        capabilityLinkValues: [manageUrl],
        data: {
          ...buildEventEmailVariables(event, appBaseUrl),
          __currentRecipient: { userId: speaker.user_id, email: speaker.email },
          proposalId: speaker.proposal_id,
          speakerUserId: speaker.user_id,
          firstName: emailPlainText(speaker.first_name ?? ""),
          lastName: emailPlainText(speaker.last_name ?? ""),
          ...proposalInviteEmailTextVariables(context),
          manageUrl,
          ...directEmailBodyPayload(`{{#if firstName}}Dear {{firstName}},{{else}}Dear Speaker,{{/if}}

Your speaker participation for **{{eventName}}**: **{{proposalTitle}}**.

${speaker.speaker_status === "confirmed" ? "Your participation is confirmed. You can review your details using the link below." : "Please review the proposal and confirm or decline your participation."}

[Manage your speaker participation]({{manageUrl}})

This link is personal. Please do not share it.`),
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
                   ${activeEffectiveInviteExpirySql(effectiveProposalSpeakerInviteExpirySql("ps", "e"))}
                 )
               )
               AND u.active = 1 AND (u.email_verified_at IS NOT NULL OR ${unclaimedAccountSql("u")})
               AND u.normalized_email = ? AND u.updated_at = ?
               AND (u.normalized_email = ? OR EXISTS (
                 SELECT 1 FROM user_emails address WHERE address.user_id = u.id
                   AND address.normalized_email = ? AND address.verified_at IS NOT NULL
               ))`,
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
          email,
          email,
        ],
      },
    );
    queuedEmails.push(queued);
  }
  const results = await db.batch(queuedEmails.map((entry) => entry.statement));
  return queuedEmails.flatMap((entry, index) => (results[index]?.meta?.changes === 1 ? [entry.id] : []));
}
