import { invitationCampaignSelection } from "./invitation-audience";
import {
  eventEmailCampaignPreviewInputSchema,
  isInvitationCampaignAudience,
  type EventEmailCampaignPreviewInput,
} from "../../../../assets/shared/schemas/event-email-campaigns";
import { all, first } from "../../db/queries";
import { resolveTemplate } from "../../email/templates";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { sha256Hex } from "../../utils/crypto";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { attendeeCampaignSelection, listCampaignRecipients, speakerCampaignSelection } from "./audience";
import { computeCampaignDigest } from "./digest";
import { signCampaignPreviewToken } from "./preview-token";
import type { CampaignEvent } from "./types";

export interface CampaignSnapshot {
  id: string;
  input_json: string;
  status: string;
  recipient_count: number;
}

export function campaignAudienceSelection(event: CampaignEvent, input: EventEmailCampaignPreviewInput) {
  // Unlimited selection is used only inside set-based SQL, never fetched into a Worker.
  if (isInvitationCampaignAudience(input.filter.audience))
    return invitationCampaignSelection(event, input.filter, null);
  return input.filter.audience === "attendees"
    ? attendeeCampaignSelection(event, input.filter, null)
    : speakerCampaignSelection(event, input.filter, null);
}

export async function campaignSnapshotDigest(input: EventEmailCampaignPreviewInput, snapshotId: string) {
  return computeCampaignDigest({ ...eventEmailCampaignPreviewInputSchema.parse(input), snapshotId });
}

export async function createCampaignSnapshot(
  db: DatabaseLike,
  event: CampaignEvent,
  input: EventEmailCampaignPreviewInput,
  options: { actorId: string; appBaseUrl: string; signingSecret: string },
) {
  const id = uuid();
  const digest = await campaignSnapshotDigest(input, id);
  const token = await signCampaignPreviewToken({
    secret: options.signingSecret,
    eventId: event.id,
    actorId: options.actorId,
    digest,
    ttlSeconds: 600,
  });
  const selection = campaignAudienceSelection(event, input);
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO event_email_campaigns
      (id, event_id, actor_id, input_json, app_base_url, token_hash, expires_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      )
      .bind(
        id,
        event.id,
        options.actorId,
        JSON.stringify(eventEmailCampaignPreviewInputSchema.parse(input)),
        options.appBaseUrl,
        await sha256Hex(token.token),
        token.expiresAt,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO event_email_campaign_recipients (campaign_id, email)
      SELECT ?, lower(trim(email)) FROM (${selection.sql})`,
      )
      .bind(id, ...selection.bindings),
    db
      .prepare(
        `UPDATE event_email_campaigns SET recipient_count =
      (SELECT COUNT(*) FROM event_email_campaign_recipients WHERE campaign_id = ?) WHERE id = ?`,
      )
      .bind(id, id),
  ]);
  const snapshot = await first<CampaignSnapshot>(
    db,
    "SELECT id, input_json, status, recipient_count FROM event_email_campaigns WHERE id = ?",
    [id],
  );
  if (!snapshot) throw new Error("Campaign snapshot was not persisted");
  const emails = await all<{ email: string }>(
    db,
    "SELECT email FROM event_email_campaign_recipients WHERE campaign_id = ? ORDER BY email LIMIT 10",
    [id],
  );
  const recipients = await listCampaignRecipients(db, event, options.appBaseUrl, input.filter, {
    maxRecipients: 10,
    recipientEmails: emails.map((row) => row.email),
  });
  const template = !input.bodyContent && input.templateKey ? await resolveTemplate(db, input.templateKey) : null;
  return { ...snapshot, recipients, template, token, digest };
}

export async function findCampaignSnapshot(db: DatabaseLike, eventId: string, actorId: string, token: string) {
  const snapshot = await first<CampaignSnapshot>(
    db,
    `SELECT id, input_json, status, recipient_count FROM event_email_campaigns
     WHERE token_hash = ? AND event_id = ? AND actor_id = ?`,
    [await sha256Hex(token), eventId, actorId],
  );
  if (!snapshot)
    throw new AppError(400, "CAMPAIGN_PREVIEW_INVALID", "Invalid campaign preview token. Render a fresh preview.");
  return snapshot;
}

export async function acceptCampaignSnapshot(
  db: DatabaseLike,
  event: CampaignEvent,
  input: EventEmailCampaignPreviewInput,
  snapshot: CampaignSnapshot,
) {
  const selection = campaignAudienceSelection(event, input);
  // Compare both sets and accept in the same write. A registration change cannot
  // slip between preview validation and the durable send request.
  const currentEmails = `SELECT lower(trim(email)) AS email FROM (${selection.sql})`;
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `UPDATE event_email_campaigns SET status = 'queued', updated_at = ?
      WHERE id = ? AND status = 'draft' AND expires_at >= ?
      AND NOT EXISTS (${currentEmails} EXCEPT SELECT email FROM event_email_campaign_recipients WHERE campaign_id = ?)
      AND NOT EXISTS (SELECT email FROM event_email_campaign_recipients WHERE campaign_id = ? EXCEPT ${currentEmails})`,
      )
      .bind(now, snapshot.id, now, ...selection.bindings, snapshot.id, snapshot.id, ...selection.bindings),
    db
      .prepare(
        `UPDATE scheduled_jobs SET wake_requested = 1 WHERE job_key = 'event_email_campaigns'
      AND EXISTS (SELECT 1 FROM event_email_campaigns WHERE id = ? AND status = 'queued')`,
      )
      .bind(snapshot.id),
  ]);
  const accepted = await first<{ status: string }>(db, "SELECT status FROM event_email_campaigns WHERE id = ?", [
    snapshot.id,
  ]);
  if (accepted?.status !== "queued" && accepted?.status !== "complete") {
    throw new AppError(
      409,
      "CAMPAIGN_PREVIEW_STALE",
      "Campaign recipients changed after preview. Render a fresh preview.",
    );
  }
}
