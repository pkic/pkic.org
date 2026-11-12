import { promotionFormatsSchema } from "../../../../assets/shared/schemas/event-promotion-kit";
import { eventEmailCampaignPreviewInputSchema } from "../../../../assets/shared/schemas/event-email-campaigns";
import { batchRows } from "../../db/pagination";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import { loadEmailRenderBundle } from "../../email/partials";
import { emailPlainText } from "../../email/plain-text";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareEventEmailCampaignPage } from "../event-email-campaign-queue";
import { getEventById } from "../events";
import { promotionKitPageUrl } from "../frontend-links";
import { prepareJobWake } from "../scheduled-jobs/dispatcher";
import { buildSpeakerTemplateData } from "./template-data";
import type { CampaignRecipient } from "./types";
import {
  finishedKitFiles,
  prepareKitPeopleRead,
  prepareKitSessionTitlesRead,
  type EmailOutcome,
  type KitEmailPlan,
  type KitPerson,
  type PendingKitEmail,
} from "./kit-email-files";
import { planPromotionMaterialsEmail } from "./promotion-materials-staging";

/**
 * A kit waits only while a render can still finish; a dead end settles at once as
 * failed. Picked files go out in one email, so their batch waits for every row.
 */
const PENDING_KIT_EMAILS_SQL = `WITH pending AS (
  SELECT recipient.batch_id,recipient.occurrence_id,recipient.user_id,recipient.status,recipient.fingerprint,
    batch.event_id,batch.published_revision,COALESCE(state.published_revision,0) AS live_revision,
    COALESCE(recipient.formats_json,batch.formats_json) AS formats_json,batch.origin,batch.requested_by,batch.email_test,campaign.input_json,batch.created_at,
    json_type(campaign.input_json,'$.materials') IS NOT NULL AS picked,
    (SELECT json_group_array(json_object('format',render.format,'status',render.status))
      FROM event_promotion_renders render
      WHERE render.event_id=batch.event_id AND render.occurrence_id IS recipient.occurrence_id AND render.user_id=recipient.user_id
        AND render.fingerprint=recipient.fingerprint
        AND render.format IN(SELECT value FROM json_each(COALESCE(recipient.formats_json,batch.formats_json)))) AS renders_json,
    recipient.status IN('prepared','failed') AND (recipient.status='failed' OR COALESCE(state.published_revision,0)<>batch.published_revision
      OR NOT EXISTS(SELECT 1 FROM event_promotion_renders render
        WHERE render.event_id=batch.event_id AND render.occurrence_id IS recipient.occurrence_id AND render.user_id=recipient.user_id
          AND render.fingerprint=recipient.fingerprint
          AND render.format IN(SELECT value FROM json_each(COALESCE(recipient.formats_json,batch.formats_json)))
          AND render.status IN('queued','retrying','rendering'))) AS settled
  FROM event_promotion_batch_recipients recipient
  JOIN event_promotion_batches batch ON batch.id=recipient.batch_id
  LEFT JOIN event_email_campaigns campaign ON campaign.id=batch.email_campaign_id
  LEFT JOIN event_agenda_state state ON state.event_id=batch.event_id
  WHERE recipient.email_status='pending'
)
SELECT batch_id,occurrence_id,user_id,status,fingerprint,event_id,published_revision,live_revision,formats_json,origin,requested_by,email_test,input_json,renders_json
FROM pending WHERE settled=1
  AND (picked=0 OR NOT EXISTS(SELECT 1 FROM pending sibling WHERE sibling.batch_id=pending.batch_id AND sibling.settled=0))
ORDER BY created_at,batch_id,occurrence_id,user_id LIMIT ?`;

function kitRecipient(
  speaker: KitPerson,
  to: KitPerson,
  sessionTitle: string,
  promotionKitUrl: string,
  delivery: Pick<CampaignRecipient, "idempotencyKey" | "attachments">,
): CampaignRecipient {
  return {
    userId: to.id,
    email: (to.email ?? "").trim().toLowerCase(),
    firstName: (speaker.first_name ?? "").trim(),
    lastName: (speaker.last_name ?? "").trim(),
    templateData: {
      ...buildSpeakerTemplateData({
        email: speaker.email ?? "",
        first_name: speaker.first_name,
        last_name: speaker.last_name,
        organization_name: speaker.organization_name,
        job_title: speaker.job_title,
        speaker_status: "scheduled",
        proposal_title: sessionTitle,
        proposal_abstract: null,
        proposal_type: null,
        details_json: null,
        proposal_updated_at: null,
        speaker_confirmed_at: null,
        formResponse: { answers: null, fields: null },
      }),
      sessionTitle: emailPlainText(sessionTitle),
      promotionKitUrl,
    },
    ...delivery,
  };
}

/** A template retired after acceptance can never render; a database error can still be retried. */
async function loadKitEmailBundle(db: DatabaseLike, templateKey: string | undefined) {
  try {
    return await loadEmailRenderBundle(db, templateKey ? [templateKey] : []);
  } catch (error) {
    if (error instanceof AppError) return null;
    throw error;
  }
}

/**
 * Moves finished kits into the email outbox, one batch per pass. The recipient row
 * only records that its email was queued; the outbox owns delivery from there.
 */
export async function stagePendingSpeakerKitEmails(
  db: DatabaseLike,
  limit = 25,
): Promise<{ processed: number; queued: number; failed: number }> {
  const rows = await all<PendingKitEmail>(db, PENDING_KIT_EMAILS_SQL, [limit + 1]);
  const head = rows[0];
  if (!head) return { processed: 0, queued: 0, failed: 0 };
  const page = rows.slice(0, limit).filter((row) => row.batch_id === head.batch_id);
  const campaign = head.input_json ? eventEmailCampaignPreviewInputSchema.parse(JSON.parse(head.input_json)) : null;
  const templateKey = campaign && !campaign.bodyContent ? campaign.templateKey : undefined;
  const bundle = campaign ? await loadKitEmailBundle(db, templateKey) : null;
  const event = await getEventById(db, head.event_id);
  const plan = campaign?.materials
    ? await planPromotionMaterialsEmail(db, event, head, page, campaign, Boolean(bundle))
    : await planSpeakerKitEmails(db, event, head, page, Boolean(bundle));
  const { recipients, outcomes } = plan;

  const stillPending = {
    sql: "SELECT 1 FROM event_promotion_batch_recipients WHERE batch_id=? AND email_status='pending' LIMIT 1",
    bindings: [head.batch_id],
  };
  const template = templateKey ? (bundle?.templates.get(templateKey) ?? null) : null;
  const prepared =
    campaign && bundle && recipients.length > 0
      ? await prepareEventEmailCampaignPage(
          db,
          event,
          head.origin,
          campaign,
          {
            template,
            partials: bundle.partials,
            messageType: campaign.messageType ?? template?.messageType ?? "promotional",
            recipients,
          },
          head.batch_id,
          stillPending,
        )
      : { statements: [] };
  await db.batch([
    ...prepared.statements,
    db
      .prepare(
        `UPDATE event_promotion_batch_recipients AS recipient
         SET email_status=json_extract(outcome.value,'$.status'),updated_at=?
         FROM json_each(?) outcome
         WHERE recipient.batch_id=? AND recipient.occurrence_id IS json_extract(outcome.value,'$.occurrenceId')
           AND recipient.user_id=json_extract(outcome.value,'$.userId') AND recipient.email_status='pending'`,
      )
      .bind(nowIso(), JSON.stringify(outcomes), head.batch_id),
    ...(rows.length > page.length ? [prepareJobWake(db, "promotion_rendering")] : []),
  ]);
  return {
    processed: page.length,
    queued: recipients.length,
    failed: outcomes.filter((outcome) => outcome.status === "failed").length,
  };
}

/** Bulk speaker kits: one email per session and speaker, each with that session's files. */
async function planSpeakerKitEmails(
  db: DatabaseLike,
  event: Awaited<ReturnType<typeof getEventById>>,
  head: PendingKitEmail,
  page: PendingKitEmail[],
  renderable: boolean,
): Promise<KitEmailPlan> {
  const test = head.email_test === 1;
  const formats = promotionFormatsSchema.parse(JSON.parse(head.formats_json));
  const occurrenceIds = page.flatMap((row) => (row.occurrence_id ? [row.occurrence_id] : []));
  const [people, titles] = await db.batch([
    prepareKitPeopleRead(db, [...new Set([head.requested_by, ...page.map((row) => row.user_id)])]),
    prepareKitSessionTitlesRead(db, head.event_id, head.published_revision, occurrenceIds),
  ]);
  const peopleById = new Map(batchRows<KitPerson>(people).map((person) => [person.id, person]));
  const titleById = new Map(batchRows<{ id: string; title: string }>(titles).map((row) => [row.id, row.title]));
  const promotionKitUrl = promotionKitPageUrl(head.origin, event);
  const recipients: CampaignRecipient[] = [];
  const outcomes: EmailOutcome[] = [];
  for (const row of page) {
    const identity = { occurrenceId: row.occurrence_id, userId: row.user_id };
    const speaker = peopleById.get(row.user_id);
    const to = test ? peopleById.get(row.requested_by) : speaker;
    const title = row.occurrence_id ? titleById.get(row.occurrence_id) : undefined;
    const attachments = title ? finishedKitFiles(row, formats, title) : null;
    if (!renderable || !speaker || !to?.email || !title || !attachments) {
      outcomes.push({ ...identity, status: "failed" });
      continue;
    }
    const idempotencyKey = `speaker-kit:${row.batch_id}:${row.occurrence_id}:${row.user_id}`;
    recipients.push(kitRecipient(speaker, to, title, promotionKitUrl, { idempotencyKey, attachments }));
    outcomes.push({ ...identity, status: "queued" });
  }
  return { recipients, outcomes };
}
