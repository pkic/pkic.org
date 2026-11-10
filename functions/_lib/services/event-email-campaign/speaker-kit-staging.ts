import {
  promotionFormatsSchema,
  type promotionFormatSchema,
} from "../../../../assets/shared/schemas/event-promotion-kit";
import { eventEmailCampaignPreviewInputSchema } from "../../../../assets/shared/schemas/event-email-campaigns";
import type { z } from "zod";
import { batchRows } from "../../db/pagination";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import { slugifyAttachmentPart, type QueuedEmailAttachment } from "../../email/attachments";
import { outboxIdForOperation } from "../../email/outbox-queue";
import { loadEmailRenderBundle } from "../../email/partials";
import { emailPlainText } from "../../email/plain-text";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareEventEmailCampaignPage } from "../event-email-campaign-queue";
import { getEventById } from "../events";
import { promotionKitPageUrl } from "../frontend-links";
import {
  selectedOrAffiliationJobTitleSql,
  selectedOrAffiliationOrganizationNameSql,
} from "../identities/affiliation-projection";
import { prepareJobWake } from "../scheduled-jobs/dispatcher";
import { buildSpeakerTemplateData } from "./template-data";
import type { CampaignRecipient } from "./types";

type PromotionFormat = z.infer<typeof promotionFormatSchema>;

const KIT_FILE_NAMES: Record<PromotionFormat, string> = {
  portrait: "tall-post",
  carousel: "carousel",
  square: "square-post",
  landscape: "wide-post",
};

interface PendingKitEmail {
  batch_id: string;
  occurrence_id: string;
  user_id: string;
  status: string;
  fingerprint: string | null;
  event_id: string;
  published_revision: number;
  live_revision: number;
  formats_json: string;
  origin: string;
  requested_by: string;
  email_json: string;
  renders_json: string;
}

interface KitPerson {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  job_title: string | null;
}

type EmailOutcome = { occurrenceId: string; userId: string; status: string; outboxId: string | null };

/** A kit waits only while a render can still finish; a dead end settles at once as failed. */
const PENDING_KIT_EMAILS_SQL = `WITH pending AS (
  SELECT recipient.batch_id,recipient.occurrence_id,recipient.user_id,recipient.status,recipient.fingerprint,
    batch.event_id,batch.published_revision,COALESCE(state.published_revision,0) AS live_revision,
    batch.formats_json,batch.origin,batch.requested_by,batch.email_json,batch.created_at,
    (SELECT json_group_array(json_object('format',render.format,'cacheKey',render.cache_key,'status',render.status))
      FROM event_promotion_renders render
      WHERE render.event_id=batch.event_id AND render.occurrence_id=recipient.occurrence_id AND render.user_id=recipient.user_id
        AND render.fingerprint=recipient.fingerprint AND render.format IN(SELECT value FROM json_each(batch.formats_json))) AS renders_json,
    EXISTS(SELECT 1 FROM event_promotion_renders render
      WHERE render.event_id=batch.event_id AND render.occurrence_id=recipient.occurrence_id AND render.user_id=recipient.user_id
        AND render.fingerprint=recipient.fingerprint AND render.format IN(SELECT value FROM json_each(batch.formats_json))
        AND render.status IN('queued','retrying','rendering')) AS unsettled
  FROM event_promotion_batch_recipients recipient
  JOIN event_promotion_batches batch ON batch.id=recipient.batch_id
  LEFT JOIN event_agenda_state state ON state.event_id=batch.event_id
  WHERE recipient.email_status='pending' AND recipient.status IN('prepared','failed')
)
SELECT batch_id,occurrence_id,user_id,status,fingerprint,event_id,published_revision,live_revision,formats_json,origin,requested_by,email_json,renders_json
FROM pending WHERE status='failed' OR live_revision<>published_revision OR unsettled=0
ORDER BY created_at,batch_id,occurrence_id,user_id LIMIT ?`;

function finishedKitFiles(
  row: PendingKitEmail,
  formats: readonly PromotionFormat[],
  sessionTitle: string,
): QueuedEmailAttachment[] | null {
  if (row.status === "failed" || row.live_revision !== row.published_revision || !row.fingerprint) return null;
  const renders = JSON.parse(row.renders_json ?? "[]") as Array<{ format: string; cacheKey: string; status: string }>;
  const session = slugifyAttachmentPart(sessionTitle).slice(0, 60) || "session";
  const files: QueuedEmailAttachment[] = [];
  for (const format of formats) {
    const render = renders.find((item) => item.format === format && item.status === "rendered");
    if (!render) return null;
    files.push({
      kind: "r2-stored-file",
      r2Key: render.cacheKey,
      filenameBase: `${session}-${KIT_FILE_NAMES[format]}`,
    });
  }
  return files;
}

function prepareKitPeopleRead(db: DatabaseLike, userIds: string[]) {
  return db
    .prepare(
      `SELECT person.id,person.email,person.first_name,person.last_name,
        ${selectedOrAffiliationOrganizationNameSql("NULL", "person.id")} AS organization_name,
        ${selectedOrAffiliationJobTitleSql("NULL", "person.id")} AS job_title
      FROM users person
      WHERE person.id IN(SELECT value FROM json_each(?)) AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL`,
    )
    .bind(JSON.stringify(userIds));
}

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
 * Moves finished kits into the email outbox, one batch per pass. The outbox owns
 * delivery retries from there; a recipient row settles exactly once here.
 */
export async function stagePendingSpeakerKitEmails(
  db: DatabaseLike,
  limit = 25,
): Promise<{ processed: number; queued: number; failed: number }> {
  const rows = await all<PendingKitEmail>(db, PENDING_KIT_EMAILS_SQL, [limit + 1]);
  const head = rows[0];
  if (!head) return { processed: 0, queued: 0, failed: 0 };
  const page = rows.slice(0, limit).filter((row) => row.batch_id === head.batch_id);

  const request = JSON.parse(head.email_json) as { test: boolean; campaign: unknown };
  const campaign = eventEmailCampaignPreviewInputSchema.parse(request.campaign);
  const formats = promotionFormatsSchema.parse(JSON.parse(head.formats_json));
  const formatKey = [...formats].sort().join(",");
  const baseKey = (row: PendingKitEmail) =>
    request.test
      ? `speaker-kit-test:${row.batch_id}:${row.occurrence_id}:${row.user_id}`
      : `speaker-kit:${row.occurrence_id}:${row.user_id}:${row.fingerprint}:${formatKey}`;

  const [people, titles, outbox] = await db.batch([
    prepareKitPeopleRead(db, [...new Set([head.requested_by, ...page.map((row) => row.user_id)])]),
    db
      .prepare(
        `SELECT json_extract(entry.value,'$.id') AS id,json_extract(entry.value,'$.title') AS title
         FROM event_agenda_publications publication,json_each(publication.snapshot_json,'$.occurrences') entry
         WHERE publication.event_id=? AND publication.revision=? AND json_extract(entry.value,'$.id') IN(SELECT value FROM json_each(?))`,
      )
      .bind(head.event_id, head.published_revision, JSON.stringify(page.map((row) => row.occurrence_id))),
    db
      // A retry or resend carries the base key plus ":<batch>"; every attempt speaks for the kit.
      .prepare(
        `SELECT requested.value AS base_key,mail.id,mail.status
         FROM json_each(?) requested
         JOIN email_outbox mail ON mail.idempotency_key=requested.value
           OR (mail.idempotency_key>requested.value||':' AND mail.idempotency_key<requested.value||';')`,
      )
      .bind(JSON.stringify(page.map(baseKey))),
  ]);
  const peopleById = new Map(batchRows<KitPerson>(people).map((person) => [person.id, person]));
  const titleById = new Map(batchRows<{ id: string; title: string }>(titles).map((row) => [row.id, row.title]));
  const earlierByKey = new Map<string, { id: string; status: string }>();
  for (const attempt of batchRows<{ base_key: string; id: string; status: string }>(outbox)) {
    const known = earlierByKey.get(attempt.base_key);
    if (!known || known.status === "failed") earlierByKey.set(attempt.base_key, attempt);
  }

  const event = await getEventById(db, head.event_id);
  const promotionKitUrl = promotionKitPageUrl(head.origin, event);
  const recipients: CampaignRecipient[] = [];
  const outcomes: EmailOutcome[] = [];
  for (const row of page) {
    const identity = { occurrenceId: row.occurrence_id, userId: row.user_id };
    const speaker = peopleById.get(row.user_id);
    const to = request.test ? peopleById.get(row.requested_by) : speaker;
    const title = titleById.get(row.occurrence_id);
    const attachments = title ? finishedKitFiles(row, formats, title) : null;
    if (!speaker || !to?.email || !title || !attachments) {
      outcomes.push({ ...identity, status: "failed", outboxId: null });
      continue;
    }
    const key = baseKey(row);
    const earlier = earlierByKey.get(key);
    if (earlier && earlier.status !== "failed" && !campaign.kit?.resend) {
      outcomes.push({ ...identity, status: "already_sent", outboxId: earlier.id });
      continue;
    }
    const idempotencyKey = earlier ? `${key}:${row.batch_id}` : key;
    recipients.push(kitRecipient(speaker, to, title, promotionKitUrl, { idempotencyKey, attachments }));
    outcomes.push({ ...identity, status: "queued", outboxId: await outboxIdForOperation(idempotencyKey) });
  }

  const templateKey = !campaign.bodyContent ? campaign.templateKey : undefined;
  const bundle = await loadKitEmailBundle(db, templateKey);
  const settled = bundle
    ? outcomes
    : outcomes.map((outcome) =>
        outcome.status === "queued" ? { ...outcome, status: "failed", outboxId: null } : outcome,
      );
  const stillPending = {
    sql: "SELECT 1 FROM event_promotion_batch_recipients WHERE batch_id=? AND email_status='pending' LIMIT 1",
    bindings: [head.batch_id],
  };
  const template = templateKey ? (bundle?.templates.get(templateKey) ?? null) : null;
  const prepared = bundle
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
         SET email_status=json_extract(outcome.value,'$.status'),email_outbox_id=json_extract(outcome.value,'$.outboxId'),updated_at=?
         FROM json_each(?) outcome
         WHERE recipient.batch_id=? AND recipient.occurrence_id=json_extract(outcome.value,'$.occurrenceId')
           AND recipient.user_id=json_extract(outcome.value,'$.userId') AND recipient.email_status='pending'`,
      )
      .bind(nowIso(), JSON.stringify(settled), head.batch_id),
    ...(rows.length > page.length ? [prepareJobWake(db, "promotion_rendering")] : []),
  ]);
  return {
    processed: page.length,
    queued: bundle ? recipients.length : 0,
    failed: settled.filter((outcome) => outcome.status === "failed").length,
  };
}
