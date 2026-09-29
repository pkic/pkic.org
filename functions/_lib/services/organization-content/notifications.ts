import { all } from "../../db/queries";
import { chunkJsonRows } from "../../db/json-bulk";
import {
  prepareBulkQueueEmailChunkStatements,
  processSelectedOutboxBackground,
  type BulkEmailQueueRow,
} from "../../email/outbox";
import { sha256Hex } from "../../utils/crypto";
import { logError } from "../../logging";
import type { DatabaseLike, Env, StatementLike } from "../../types";
import { staffPermissionPredicate } from "../../auth/permissions";

const CONTENT_REVIEW_PERMISSION = "organizations:content-review";
const CONTENT_REVIEW_TEMPLATE = "org-content-submitted";

export interface PendingOrganizationContentReviewNotificationIntent {
  reviewId: string;
  recipientEmail: string;
  recipientUserId: string | null;
  organizationName: string;
  submitterName: string;
  reviewUrl: string;
}

/**
 * Snapshots the intended staff recipients in the same D1 batch as review
 * creation. The recipient email is the logical key to preserve the existing
 * distinct-email fan-out behavior, while the user ID remains useful for
 * outbox/audit inspection.
 */
export function prepareOrganizationContentReviewNotificationIntents(
  db: DatabaseLike,
  reviewId: string,
  organizationId: string,
  submitterName: string,
  reviewUrl: string,
  createdAt: string,
): StatementLike {
  return db
    .prepare(
      `WITH eligible_users AS (
         SELECT u.id, u.email
         FROM users u
         WHERE u.active = 1 AND ${staffPermissionPredicate("u")}
       )
       INSERT INTO organization_content_review_notification_intents (
         review_id, recipient_email, recipient_user_id, organization_name,
         submitter_name, review_url, created_at, queued_outbox_id, queued_at
       )
       SELECT ?, e.email, MIN(e.id), o.name, ?, ?, ?, NULL, NULL
       FROM eligible_users e
       JOIN organizations o ON o.id = ?
       JOIN organization_content_reviews r ON r.id = ? AND r.organization_id = o.id
       GROUP BY e.email, o.name
       ON CONFLICT(review_id, recipient_email) DO NOTHING`,
    )
    .bind(
      CONTENT_REVIEW_PERMISSION,
      CONTENT_REVIEW_PERMISSION,
      reviewId,
      submitterName,
      reviewUrl,
      createdAt,
      organizationId,
      reviewId,
    );
}

export async function listPendingOrganizationContentReviewNotificationIntents(
  db: DatabaseLike,
  limit: number,
): Promise<PendingOrganizationContentReviewNotificationIntent[]> {
  const rows = await all<{
    review_id: string;
    recipient_email: string;
    recipient_user_id: string | null;
    organization_name: string;
    submitter_name: string;
    review_url: string;
  }>(
    db,
    `SELECT review_id, recipient_email, recipient_user_id,
            organization_name, submitter_name, review_url
     FROM organization_content_review_notification_intents
     WHERE queued_outbox_id IS NULL
     ORDER BY created_at ASC, review_id ASC, recipient_email ASC
     LIMIT ?`,
    [Math.max(0, Math.floor(limit))],
  );
  return rows.map((row) => ({
    reviewId: row.review_id,
    recipientEmail: row.recipient_email,
    recipientUserId: row.recipient_user_id,
    organizationName: row.organization_name,
    submitterName: row.submitter_name,
    reviewUrl: row.review_url,
  }));
}

interface PreparedOrganizationContentReviewDelivery {
  reviewId: string;
  recipientEmail: string;
  outboxId: string;
  idempotencyKey: string;
}

function prepareMarkOrganizationContentReviewNotificationIntents(
  db: DatabaseLike,
  deliveries: PreparedOrganizationContentReviewDelivery[],
  queuedAt: string,
): StatementLike[] {
  return chunkJsonRows(deliveries).map((chunk) =>
    db
      .prepare(
        `WITH input AS (
           SELECT
             json_extract(value, '$.reviewId') AS review_id,
             json_extract(value, '$.recipientEmail') AS recipient_email,
             json_extract(value, '$.outboxId') AS outbox_id,
             json_extract(value, '$.idempotencyKey') AS idempotency_key
           FROM json_each(?)
         )
         UPDATE organization_content_review_notification_intents
         SET queued_outbox_id = (
               SELECT input.outbox_id
               FROM input
               WHERE input.review_id = organization_content_review_notification_intents.review_id
                 AND input.recipient_email = organization_content_review_notification_intents.recipient_email
             ),
             queued_at = ?
         WHERE queued_outbox_id IS NULL
           AND EXISTS (
             SELECT 1
             FROM input
             JOIN email_outbox e
               ON e.id = input.outbox_id
              AND e.idempotency_key = input.idempotency_key
             WHERE input.review_id = organization_content_review_notification_intents.review_id
               AND input.recipient_email = organization_content_review_notification_intents.recipient_email
           )`,
      )
      .bind(chunk.json, queuedAt),
  );
}

export interface OrganizationContentReviewNotificationDrainResult {
  queued: number;
  outboxIds: string[];
}

/**
 * Converts a bounded set of immutable intents into idempotent email-outbox
 * rows. Both inserts and intent marks are one D1 batch, so queue failures
 * leave the intent pending for a later retry.
 */
export async function drainOrganizationContentReviewNotificationIntents(
  db: DatabaseLike,
  limit = 100,
): Promise<OrganizationContentReviewNotificationDrainResult> {
  const pending = await listPendingOrganizationContentReviewNotificationIntents(db, limit);
  if (pending.length === 0) return { queued: 0, outboxIds: [] };

  const prepared = await Promise.all(
    pending.map(async (intent) => {
      const idempotencyKey = `organization-content-review-submitted:${intent.reviewId}:${intent.recipientEmail}`;
      return {
        intent,
        idempotencyKey,
        outboxId: (await sha256Hex(idempotencyKey)).slice(0, 32),
      };
    }),
  );

  const emailRows: BulkEmailQueueRow[] = prepared.map(({ intent, idempotencyKey, outboxId }) => ({
    outboxId,
    idempotencyKey,
    templateKey: CONTENT_REVIEW_TEMPLATE,
    recipientUserId: intent.recipientUserId,
    recipientEmail: intent.recipientEmail,
    subject: `Organization content change submitted for review — ${intent.organizationName}`,
    messageType: "transactional",
    data: {
      organizationName: intent.organizationName,
      submitterName: intent.submitterName,
      reviewUrl: intent.reviewUrl,
    },
  }));
  const deliveries: PreparedOrganizationContentReviewDelivery[] = prepared.map(
    ({ intent, idempotencyKey, outboxId }) => ({
      reviewId: intent.reviewId,
      recipientEmail: intent.recipientEmail,
      outboxId,
      idempotencyKey,
    }),
  );

  const queuedAt = new Date().toISOString();
  const emailStatements = prepareBulkQueueEmailChunkStatements(db, emailRows, queuedAt).map((chunk) => chunk.statement);
  const markStatements = prepareMarkOrganizationContentReviewNotificationIntents(db, deliveries, queuedAt);
  const results = await db.batch([...emailStatements, ...markStatements]);
  const queued = results
    .slice(emailStatements.length)
    .reduce((total, result) => total + Number(result.meta?.changes ?? 0), 0);
  return { queued, outboxIds: prepared.map(({ outboxId }) => outboxId) };
}

/** Request-path convenience; the scheduled due-work lane remains the retry owner. */
export async function processOrganizationContentReviewNotificationsBackground(
  db: DatabaseLike,
  env: Env,
): Promise<void> {
  try {
    const { outboxIds } = await drainOrganizationContentReviewNotificationIntents(db);
    await processSelectedOutboxBackground(db, env, outboxIds);
  } catch (error) {
    logError("ORGANIZATION_CONTENT_REVIEW_NOTIFICATION_DRAIN_FAILED", {
      error: error instanceof Error ? error.message : "Unknown notification drain error",
    });
  }
}
