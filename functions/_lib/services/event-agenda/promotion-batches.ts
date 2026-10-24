import type { z } from "zod";
import type { DatabaseLike, D1StatementResult } from "../../types";
import {
  promotionBatchCreateSchema,
  promotionBatchSchema,
} from "../../../../assets/shared/schemas/event-promotion-batches";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { batchFirst } from "../../db/pagination";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { prepareAuditLog } from "../audit";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";

/** One bounded aggregate, composed with the caller's canonical authorization read. */
export function preparePromotionBatchRead(db: DatabaseLike, event: EventReadSelection, batchId: string) {
  const selection = eventReadIdSql(event);
  return {
    statements: [
      db
        .prepare(`WITH recipients AS (
      SELECT recipient.status,
        (SELECT COUNT(*) FROM event_promotion_renders render WHERE render.event_id=batch.event_id AND render.occurrence_id=recipient.occurrence_id AND render.user_id=recipient.user_id AND render.fingerprint=recipient.fingerprint AND render.format IN(SELECT value FROM json_each(batch.formats_json)) AND render.status='rendered') AS ready,
        EXISTS(SELECT 1 FROM event_promotion_renders render WHERE render.event_id=batch.event_id AND render.occurrence_id=recipient.occurrence_id AND render.user_id=recipient.user_id AND render.fingerprint=recipient.fingerprint AND render.format IN(SELECT value FROM json_each(batch.formats_json)) AND render.status IN('failed','obsolete')) AS failed,
        json_array_length(batch.formats_json) AS formats
      FROM event_promotion_batch_recipients recipient JOIN event_promotion_batches batch ON batch.id=recipient.batch_id WHERE batch.id=? AND batch.event_id=${selection.sql}
    ) SELECT batch.id,batch.published_revision AS publishedRevision,batch.created_at AS createdAt,
      COALESCE(state.published_revision,0)<>batch.published_revision AS obsolete,
      (SELECT COUNT(*) FROM recipients) AS totalKits,
      (SELECT COUNT(*) FROM recipients WHERE status='prepared' AND ready=formats AND failed=0) AS readyKits,
      (SELECT COUNT(*) FROM recipients WHERE status='failed' OR failed=1) AS failedKits,
      (SELECT COUNT(*) FROM recipients WHERE status IN('queued','preparing')) AS preparing
      FROM event_promotion_batches batch LEFT JOIN event_agenda_state state ON state.event_id=batch.event_id WHERE batch.id=? AND batch.event_id=${selection.sql}`)
        .bind(batchId, ...selection.bindings, batchId, ...selection.bindings),
    ],
    decode(loaded: D1StatementResult[]) {
      const row = batchFirst<{
        id: string;
        publishedRevision: number;
        createdAt: string;
        obsolete: number;
        totalKits: number;
        readyKits: number;
        failedKits: number;
        preparing: number;
      }>(loaded[0]);
      if (!row) throw new AppError(404, "PROMOTION_BATCH_NOT_FOUND", "Promotion batch not found.");
      const pendingKits = row.totalKits - row.readyKits - row.failedKits;
      return promotionBatchSchema.parse({
        ...row,
        pendingKits,
        status: row.obsolete
          ? "obsolete"
          : pendingKits
            ? row.preparing
              ? "preparing"
              : "rendering"
            : row.failedKits
              ? "needs_attention"
              : "complete",
      });
    },
  };
}
/** Capture eligible public session/speaker pairs atomically; no personal profile data is copied. */
export async function createPromotionBatch(
  db: DatabaseLike,
  eventId: string,
  actorId: string,
  origin: string,
  input: z.infer<typeof promotionBatchCreateSchema>,
) {
  const at = nowIso();
  const read = preparePromotionBatchRead(db, eventId, input.requestId);
  try {
    const results = await db.batch([
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM event_agenda_state WHERE event_id=? AND published_revision=?",
        bindings: [eventId, input.publishedRevision],
      }),
      db
        .prepare(
          "INSERT INTO event_promotion_batches(id,event_id,requested_by,published_revision,formats_json,origin,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
        )
        .bind(input.requestId, eventId, actorId, input.publishedRevision, JSON.stringify(input.formats), origin, at),
      db
        .prepare(`INSERT INTO event_promotion_batch_recipients(batch_id,occurrence_id,user_id,next_attempt_at,updated_at)
        SELECT ?,occurrence.id,speaker.user_id,?,? FROM event_agenda_occurrences occurrence JOIN event_agenda_occurrence_speakers speaker ON speaker.occurrence_id=occurrence.id JOIN users person ON person.id=speaker.user_id
        WHERE changes()=1 AND occurrence.event_id=? AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL AND EXISTS(
          SELECT 1 FROM event_agenda_publications publication,json_each(publication.snapshot_json,'$.occurrences') entry
          WHERE publication.event_id=occurrence.event_id AND publication.revision=? AND json_extract(entry.value,'$.id')=occurrence.id AND json_extract(entry.value,'$.visibility')='public' AND json_extract(entry.value,'$.kind')<>'break' AND EXISTS(SELECT 1 FROM json_each(entry.value,'$.speakers') credit WHERE json_extract(credit.value,'$.userId')=speaker.user_id))
        ON CONFLICT(batch_id,occurrence_id,user_id) DO NOTHING`)
        .bind(input.requestId, at, at, eventId, input.publishedRevision),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM event_promotion_batches WHERE id=? AND event_id=? AND requested_by=? AND published_revision=? AND formats_json=?",
        bindings: [input.requestId, eventId, actorId, input.publishedRevision, JSON.stringify(input.formats)],
      }),
      prepareAuditLog(
        db,
        "user",
        actorId,
        "promotion_batch_requested",
        "event",
        eventId,
        { batchId: input.requestId },
        at,
        `promotion-batch:${input.requestId}`,
        { type: "event", id: eventId },
      ),
      ...read.statements,
    ]);
    return read.decode(results.slice(-read.statements.length));
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(
        409,
        "PROMOTION_BATCH_CHANGED",
        "The agenda or bulk request changed. Refresh before starting another batch.",
      );
    throw error;
  }
}
