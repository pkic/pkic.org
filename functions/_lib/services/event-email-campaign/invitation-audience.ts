import { EVENT_INVITE_CAMPAIGN_STATUSES } from "../../../../assets/shared/schemas/event-invites";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import { effectiveInviteExpirySql, inactiveEffectiveInviteExpirySql } from "../../invite-validity";
import type { DatabaseLike } from "../../types";
import type { CampaignAudienceFilter, CampaignEvent, CampaignRecipient } from "./types";

/** The same invited audience is used at preview, snapshot, and delivery. */
export function invitationCampaignSelection(
  event: CampaignEvent,
  filter: CampaignAudienceFilter,
  maxRecipients: number | null,
  recipientEmails?: string[],
) {
  const expiry = effectiveInviteExpirySql("i", "e");
  const effectiveStatus = `CASE WHEN i.status = 'sent' AND (${inactiveEffectiveInviteExpirySql(expiry, "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")})
    THEN 'expired' ELSE i.status END`;
  const invitationStatus = filter.invitationStatus ?? "all";
  return {
    sql: `WITH ranked AS (
      SELECT lower(trim(i.invitee_email)) AS email,
             i.invitee_first_name AS first_name, i.invitee_last_name AS last_name,
             ${effectiveStatus} AS effective_status,
             COALESCE(i.unsubscribe_future, 0) AS unsubscribe_future,
             ROW_NUMBER() OVER (PARTITION BY lower(trim(i.invitee_email)) ORDER BY i.created_at DESC, i.id DESC) AS rank
      FROM invites i JOIN events e ON e.id = i.event_id
      WHERE i.event_id = ? AND i.invite_type = ?
        AND (? IS NULL OR lower(trim(i.invitee_email)) IN (SELECT value FROM json_each(?)))
    ) SELECT email, first_name, last_name FROM ranked
      WHERE rank = 1
        AND effective_status IN (${EVENT_INVITE_CAMPAIGN_STATUSES.map(() => "?").join(", ")})
        AND (? = 'all' OR effective_status = ?)
        AND unsubscribe_future = 0
      ORDER BY email LIMIT ?`,
    bindings: [
      event.id,
      filter.audience === "attendee_invitations" ? "attendee" : "speaker",
      recipientEmails ? JSON.stringify(recipientEmails) : null,
      recipientEmails ? JSON.stringify(recipientEmails) : null,
      ...EVENT_INVITE_CAMPAIGN_STATUSES,
      invitationStatus,
      invitationStatus,
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
