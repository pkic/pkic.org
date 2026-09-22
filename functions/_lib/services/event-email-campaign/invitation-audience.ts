import { all } from "../../db/queries";
import { AppError } from "../../errors";
import { effectiveInviteExpirySql, inactiveEffectiveInviteExpirySql } from "../../invite-validity";
import type { DatabaseLike } from "../../types";
import type { CampaignAudienceFilter, CampaignEvent, CampaignRecipient } from "./types";

/** The same current invitation audience is used at preview, snapshot, and delivery. */
export function invitationCampaignSelection(
  event: CampaignEvent,
  filter: CampaignAudienceFilter,
  maxRecipients: number | null,
  recipientEmails?: string[],
) {
  const expiry = effectiveInviteExpirySql("i", "e");
  return {
    sql: `WITH ranked AS (
      SELECT lower(trim(i.invitee_email)) AS email,
             i.invitee_first_name AS first_name, i.invitee_last_name AS last_name,
             ROW_NUMBER() OVER (PARTITION BY lower(trim(i.invitee_email)) ORDER BY i.created_at DESC, i.id) AS rank
      FROM invites i JOIN events e ON e.id = i.event_id
      WHERE i.event_id = ? AND i.invite_type = ? AND i.status = 'sent'
        AND COALESCE(i.unsubscribe_future, 0) = 0
        AND NOT (${inactiveEffectiveInviteExpirySql(expiry, "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")})
        AND (? IS NULL OR lower(trim(i.invitee_email)) IN (SELECT value FROM json_each(?)))
    ) SELECT email, first_name, last_name FROM ranked WHERE rank = 1 ORDER BY email LIMIT ?`,
    bindings: [
      event.id,
      filter.audience === "attendee_invitations" ? "attendee" : "speaker",
      recipientEmails ? JSON.stringify(recipientEmails) : null,
      recipientEmails ? JSON.stringify(recipientEmails) : null,
      maxRecipients === null ? -1 : maxRecipients + 1,
    ],
  };
}

export async function listInvitationCampaignRecipients(
  db: DatabaseLike,
  event: CampaignEvent,
  filter: CampaignAudienceFilter,
  maxRecipients: number,
  recipientEmails?: string[],
): Promise<CampaignRecipient[]> {
  const query = invitationCampaignSelection(event, filter, maxRecipients, recipientEmails);
  const rows = await all<{ email: string; first_name: string | null; last_name: string | null }>(
    db,
    query.sql,
    query.bindings,
  );
  if (rows.length > maxRecipients)
    throw new AppError(
      422,
      "CAMPAIGN_RECIPIENT_LIMIT_EXCEEDED",
      "The invitation audience exceeds the campaign recipient limit.",
    );
  return rows.map((row) => ({
    email: row.email,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    templateData: { firstName: row.first_name ?? "", lastName: row.last_name ?? "", email: row.email },
  }));
}
