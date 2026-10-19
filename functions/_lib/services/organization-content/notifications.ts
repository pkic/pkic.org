import { all } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { prepareQueueEmailStatementWhen } from "../../email/outbox";
import { staffPermissionPredicate } from "../../auth/permissions";
import { sha256Hex } from "../../utils/crypto";
import { nowIso } from "../../utils/time";
import { emailPlainText } from "../../email/plain-text";
import { reviewDigestSendAt } from "../../../../assets/shared/review-notifications";
import { buildManagementLink } from "../management-links";
import type { DatabaseLike, StatementLike } from "../../types";

const CONTENT_REVIEW_PERMISSION = "organizations:content-review";
export const ORGANIZATION_CONTENT_REVIEW_DIGEST_TEMPLATE = "org-content-review-digest";
/** The email previews a bounded queue; the linked shared queue contains every review. */
const DIGEST_PREVIEW_LIMIT = 50;

/** Recompute unsent digests from the live queue inside the review's command boundary. */
export function prepareRefreshOrganizationContentReviewDigests(db: DatabaseLike, now: string): StatementLike {
  return db
    .prepare(`WITH pending AS MATERIALIZED (
      SELECT r.id, o.name FROM organization_content_reviews r
      JOIN organizations o ON o.id = r.organization_id
      WHERE r.status = 'pending'
      ORDER BY r.submitted_at ASC, r.id ASC LIMIT ?
    ), content AS MATERIALIZED (
      SELECT (SELECT COUNT(*) FROM organization_content_reviews WHERE status = 'pending') AS pending_count,
        COALESCE((SELECT json_group_array(json_object('organizationName', json_object(?, name))) FROM pending), '[]') AS reviews
    )
    UPDATE email_outbox SET payload_json = json_set(payload_json,
      '$.pendingCount', (SELECT pending_count FROM content),
      '$.reviews', json((SELECT reviews FROM content)),
      '$.hasMore', json(CASE WHEN (SELECT pending_count FROM content) > ? THEN 'true' ELSE 'false' END)),
      status = CASE WHEN (SELECT pending_count FROM content) = 0 OR NOT EXISTS (
        SELECT 1 FROM users u WHERE u.id = email_outbox.recipient_user_id AND u.active = 1
          AND u.email = email_outbox.recipient_email AND ${staffPermissionPredicate("u")}
      ) THEN 'cancelled' ELSE status END,
      updated_at = ?
    WHERE template_key = ? AND status IN ('queued', 'retrying')`)
    .bind(
      DIGEST_PREVIEW_LIMIT,
      Object.keys(emailPlainText(""))[0],
      DIGEST_PREVIEW_LIMIT,
      CONTENT_REVIEW_PERMISSION,
      CONTENT_REVIEW_PERMISSION,
      now,
      ORGANIZATION_CONTENT_REVIEW_DIGEST_TEMPLATE,
    );
}

/** A delivery that already owns its snapshot must finish before a review can be resolved. */
export function prepareOrganizationContentReviewDigestDeliveryGuard(db: DatabaseLike): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM email_outbox WHERE template_key = ? AND status = 'sending')",
    bindings: [ORGANIZATION_CONTENT_REVIEW_DIGEST_TEMPLATE],
  });
}

/**
 * One durable message per reviewer and completed UTC day, on the same cadence
 * as membership review digests. The scheduled due-work lane owns retries.
 * Recipients come from user identities, not individual role grants or aliases.
 */
export async function queueOrganizationContentReviewDigests(
  db: DatabaseLike,
  appBaseUrl: string,
  limit = 100,
  now = nowIso(),
): Promise<{ queued: number }> {
  const sendAt = reviewDigestSendAt(now);
  const prefix = `organization-content-review-digest:${now.slice(0, 10)}:`;
  const recipients = await all<{ id: string; email: string }>(
    db,
    `SELECT u.id, u.email FROM users u
     WHERE u.active = 1 AND ${staffPermissionPredicate("u")}
       AND EXISTS (SELECT 1 FROM organization_content_reviews WHERE status = 'pending')
       AND NOT EXISTS (SELECT 1 FROM email_outbox WHERE idempotency_key = ? || u.id AND status <> 'cancelled')
     ORDER BY u.id LIMIT ?`,
    [CONTENT_REVIEW_PERMISSION, CONTENT_REVIEW_PERMISSION, prefix, Math.max(0, Math.floor(limit))],
  );
  const statements = await Promise.all(
    recipients.map(async (recipient) => {
      const idempotencyKey = `${prefix}${recipient.id}`;
      return prepareQueueEmailStatementWhen(
        db,
        {
          outboxId: (await sha256Hex(idempotencyKey)).slice(0, 32),
          idempotencyKey,
          templateKey: ORGANIZATION_CONTENT_REVIEW_DIGEST_TEMPLATE,
          recipientUserId: recipient.id,
          recipientEmail: recipient.email,
          subject: `Pending organization content reviews — ${now.slice(0, 10)} UTC`,
          messageType: "transactional",
          sendAt,
          data: {
            pendingCount: 0,
            reviews: [],
            reviewUrl: buildManagementLink(appBaseUrl, { kind: "organization-content-reviews" }),
          },
        },
        {
          sql: `SELECT 1 FROM users u WHERE u.id = ? AND u.active = 1 AND u.email = ?
        AND ${staffPermissionPredicate("u")}
        AND EXISTS (SELECT 1 FROM organization_content_reviews WHERE status = 'pending')`,
          bindings: [recipient.id, recipient.email, CONTENT_REVIEW_PERMISSION, CONTENT_REVIEW_PERMISSION],
        },
        now,
      ).statement;
    }),
  );
  // Refresh prior days' retries as well as today's new messages before the
  // normal outbox runner claims any due mail. Cancel the retired immediate notices.
  const results = await db.batch([
    ...statements,
    // A queue emptied and refilled before midnight still belongs in that day's overview.
    db
      .prepare(`UPDATE email_outbox SET status = 'queued', updated_at = ?
      WHERE template_key = ? AND status = 'cancelled' AND attempts = 0 AND send_after > ?
      AND json_extract(payload_json, '$.pendingCount') = 0
      AND EXISTS (SELECT 1 FROM organization_content_reviews WHERE status = 'pending')`)
      .bind(now, ORGANIZATION_CONTENT_REVIEW_DIGEST_TEMPLATE, now),
    prepareRefreshOrganizationContentReviewDigests(db, now),
    db
      .prepare(
        "UPDATE email_outbox SET status = 'cancelled', updated_at = ? WHERE template_key = 'org-content-submitted' AND status IN ('queued', 'retrying')",
      )
      .bind(now),
  ]);
  return {
    queued: results
      .slice(0, statements.length + 1)
      .reduce((count, result) => count + Number(result.meta?.changes ?? 0), 0),
  };
}
