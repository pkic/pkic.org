import { prepareJobWake } from "../scheduled-jobs/dispatcher";
import type { DatabaseLike } from "../../types";
import { all, first, run } from "../../db/queries";
import { createDurableJobLease, durableRenderRetry } from "../../jobs/lease";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { promotionBatchCreateSchema } from "../../../../assets/shared/schemas/event-promotion-batches";
import { assignedPromotionKit } from "./promotion-access";
import { requestPromotionRenders } from "./promotion-render-jobs";

interface Recipient {
  batch_id: string;
  occurrence_id: string;
  user_id: string;
  event_id: string;
  published_revision: number;
  formats_json: string;
  origin: string;
  attempts: number;
}
/** The scheduler's bounded preparation step feeds the existing durable render owner. */
export async function processPendingPromotionRecipients(db: DatabaseLike, limit = 1) {
  const count = Math.max(0, Math.min(5, Math.floor(limit)));
  if (!count) return { prepared: 0, failed: 0 };
  const at = nowIso();
  const recipients = await all<Recipient>(
    db,
    `SELECT recipient.batch_id,recipient.occurrence_id,recipient.user_id,recipient.attempts,batch.event_id,batch.published_revision,batch.formats_json,batch.origin
    FROM event_promotion_batch_recipients recipient JOIN event_promotion_batches batch ON batch.id=recipient.batch_id
    WHERE (recipient.status='queued' AND recipient.next_attempt_at<=?) OR (recipient.status='preparing' AND recipient.lease_expires_at<=?)
    ORDER BY recipient.next_attempt_at,recipient.batch_id,recipient.occurrence_id,recipient.user_id LIMIT ?`,
    [at, at, count],
  );
  let prepared = 0,
    failed = 0;
  for (const recipient of recipients) {
    const lease = createDurableJobLease();
    const claimed = await run(
      db,
      "UPDATE event_promotion_batch_recipients SET status='preparing',processing_token=?,lease_expires_at=?,updated_at=? WHERE batch_id=? AND occurrence_id=? AND user_id=? AND ((status='queued' AND next_attempt_at<=?) OR (status='preparing' AND lease_expires_at<=?))",
      [
        lease.token,
        lease.expiresAt,
        lease.claimedAt,
        recipient.batch_id,
        recipient.occurrence_id,
        recipient.user_id,
        lease.claimedAt,
        lease.claimedAt,
      ],
    );
    if (claimed.changes !== 1) continue;
    try {
      const current = await first<{ published_revision: number }>(
        db,
        "SELECT published_revision FROM event_agenda_state WHERE event_id=?",
        [recipient.event_id],
      );
      if (current?.published_revision !== recipient.published_revision)
        throw new AppError(409, "PROMOTION_BATCH_OBSOLETE", "The published agenda changed. Start a new batch.");
      const source = await assignedPromotionKit(
        db,
        recipient.event_id,
        recipient.occurrence_id,
        recipient.user_id,
        false,
        recipient.origin,
      );
      const formats = promotionBatchCreateSchema.shape.formats.parse(JSON.parse(recipient.formats_json));
      await requestPromotionRenders(db, recipient.event_id, source, formats, recipient.origin);
      await run(
        db,
        "UPDATE event_promotion_batch_recipients SET status='prepared',fingerprint=?,processing_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=? WHERE batch_id=? AND occurrence_id=? AND user_id=? AND processing_token=?",
        [source.kit.fingerprint, nowIso(), recipient.batch_id, recipient.occurrence_id, recipient.user_id, lease.token],
      );
      prepared++;
    } catch (error) {
      const attempts = recipient.attempts + 1;
      const retry = durableRenderRetry(attempts);
      const permanent = error instanceof AppError && [403, 404, 409, 422].includes(error.status);
      await run(
        db,
        "UPDATE event_promotion_batch_recipients SET status=?,attempts=?,next_attempt_at=?,processing_token=NULL,lease_expires_at=NULL,last_error=?,updated_at=? WHERE batch_id=? AND occurrence_id=? AND user_id=? AND processing_token=?",
        [
          permanent || retry.status === "failed" ? "failed" : "queued",
          attempts,
          new Date(Date.now() + retry.delaySeconds * 1000).toISOString(),
          (error instanceof Error ? error.message : "Could not prepare promotion materials").slice(0, 1000),
          nowIso(),
          recipient.batch_id,
          recipient.occurrence_id,
          recipient.user_id,
          lease.token,
        ],
      );
      failed++;
    }
  }
  await prepareJobWake(db, "due_work", {
    sql: "SELECT 1 FROM event_promotion_batch_recipients WHERE status='queued' AND next_attempt_at<=? LIMIT 1",
    bindings: [nowIso()],
  }).run();
  return { prepared, failed };
}
