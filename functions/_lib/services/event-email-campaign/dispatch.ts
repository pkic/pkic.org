import { eventEmailCampaignPreviewInputSchema } from "../../../../assets/shared/schemas/event-email-campaigns";
import { all, first } from "../../db/queries";
import { resolveTemplate } from "../../email/templates";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { getEventById } from "../events";
import { prepareEventEmailCampaignPage } from "../event-email-campaign-queue";
import { listCampaignRecipients } from "./audience";
import { assertCampaignBroadcastSafety } from "./broadcast-safety";

/** One scheduler pass; the outbox remains the sole owner of delivery retries. */
export async function dispatchEventEmailCampaignPage(db: DatabaseLike): Promise<{ processed: number; queued: number }> {
  const campaign = await first<{
    id: string;
    event_id: string;
    input_json: string;
    app_base_url: string;
    cursor_email: string;
    processed_count: number;
    recipient_count: number;
  }>(
    db,
    `SELECT id, event_id, input_json, app_base_url, cursor_email, processed_count, recipient_count
    FROM event_email_campaigns WHERE status = 'queued' ORDER BY updated_at, id LIMIT 1`,
  );
  if (!campaign) return { processed: 0, queued: 0 };
  const input = eventEmailCampaignPreviewInputSchema.parse(JSON.parse(campaign.input_json));
  // BCC pages align to the reviewed batch size. Personal pages remain small
  // even for audiences with many form answers and attendance dates.
  const limit = input.sendMode === "bcc_batch" ? input.batchSize : 100;
  const emails = await all<{ email: string }>(
    db,
    `SELECT email FROM event_email_campaign_recipients
    WHERE campaign_id = ? AND email > ? ORDER BY email LIMIT ?`,
    [campaign.id, campaign.cursor_email, limit],
  );
  const event = await getEventById(db, campaign.event_id);
  const recipients = await listCampaignRecipients(db, event, campaign.app_base_url, input.filter, {
    maxRecipients: limit,
    recipientEmails: emails.map((row) => row.email),
  });
  const template = !input.bodyContent && input.templateKey ? await resolveTemplate(db, input.templateKey) : null;
  assertCampaignBroadcastSafety(input, recipients, template);
  const condition = {
    sql: "SELECT 1 FROM event_email_campaigns WHERE id = ? AND status = 'queued' AND cursor_email = ?",
    bindings: [campaign.id, campaign.cursor_email],
  };
  const page = await prepareEventEmailCampaignPage(
    db,
    event,
    campaign.app_base_url,
    input,
    {
      template,
      messageType: input.messageType ?? template?.messageType ?? "promotional",
      recipients,
    },
    campaign.id,
    condition,
  );
  const completed = emails.length < limit || campaign.processed_count + emails.length >= campaign.recipient_count;
  const results = await db.batch([
    ...page.statements,
    db
      .prepare(
        `UPDATE event_email_campaigns SET cursor_email = ?, processed_count = processed_count + ?,
      queued_recipients = queued_recipients + ?, queued_batches = queued_batches + ?, status = ?, updated_at = ?
      WHERE id = ? AND status = 'queued' AND cursor_email = ?`,
      )
      .bind(
        emails.at(-1)?.email ?? campaign.cursor_email,
        emails.length,
        page.queuedRecipients,
        page.queuedBatches,
        completed ? "complete" : "queued",
        nowIso(),
        campaign.id,
        campaign.cursor_email,
      ),
  ]);
  return results.at(-1)?.meta?.changes
    ? { processed: emails.length, queued: page.queuedRecipients }
    : { processed: 0, queued: 0 };
}

/** Bound cleanup as well as dispatch; expired previews must not retain addresses. */
export async function cleanExpiredCampaignSnapshots(db: DatabaseLike): Promise<void> {
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `DELETE FROM event_email_campaign_recipients WHERE (campaign_id, email) IN (
      SELECT r.campaign_id, r.email FROM event_email_campaign_recipients r
      JOIN event_email_campaigns c ON c.id = r.campaign_id
      WHERE c.status = 'complete' OR (c.status = 'draft' AND c.expires_at < ?)
      ORDER BY c.expires_at, r.campaign_id, r.email LIMIT 1000)`,
      )
      .bind(now),
    db
      .prepare(
        `DELETE FROM event_email_campaigns WHERE id IN (
      SELECT c.id FROM event_email_campaigns c
      WHERE c.expires_at < ? AND c.status IN ('draft', 'complete')
      AND NOT EXISTS (SELECT 1 FROM event_email_campaign_recipients r WHERE r.campaign_id = c.id)
      ORDER BY c.expires_at, c.id LIMIT 100)`,
      )
      .bind(now),
  ]);
}
