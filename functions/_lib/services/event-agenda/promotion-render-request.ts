import { prepareJobWake } from "../scheduled-jobs/dispatcher";
import type { z } from "zod";
import type { DatabaseLike, D1StatementResult } from "../../types";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import {
  promotionFormatSchema,
  PROMOTION_TEMPLATE_VERSION,
  PROMOTION_RENDER_ORDER,
} from "../../../../assets/shared/schemas/event-promotion-kit";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { sha256Hex } from "../../utils/crypto";
import { nowIso } from "../../utils/time";
import { batchRows } from "../../db/pagination";
import { AppError } from "../../errors";
export interface PromotionRenderJob {
  id: string;
  event_id: string;
  occurrence_id: string | null;
  fingerprint: string | null;
  user_id: string;
  revision: number;
  format: z.infer<typeof promotionFormatSchema>;
  origin: string;
  cache_key: string;
  status: string;
  attempts: number;
}
export async function promotionRenderLocation(
  userId: string,
  occurrenceId: string | null,
  fingerprint: string,
  format: z.infer<typeof promotionFormatSchema>,
) {
  const id = await sha256Hex(
    JSON.stringify({
      occurrence: occurrenceId,
      fingerprint,
      user: userId,
      format,
      template: PROMOTION_TEMPLATE_VERSION,
    }),
  );
  return { id, key: `promotion/v${PROMOTION_TEMPLATE_VERSION}/${id}.${format === "carousel" ? "pdf" : "png"}` };
}
/** A client fingerprint is only a queue hint; the durable render owner re-resolves and verifies the source. */
export async function preparePromotionRenderRequests(
  db: DatabaseLike,
  event: EventReadSelection,
  userId: string,
  occurrenceId: string | null,
  revision: number,
  fingerprint: string,
  formats: readonly z.infer<typeof promotionFormatSchema>[],
  origin: string,
  authority?: AuthorizationEvidence,
) {
  if (!formats.length || formats.length > 5 || new Set(formats).size !== formats.length)
    throw new Error("Choose one to five distinct promotion formats.");
  const scope = eventReadIdSql(event),
    now = nowIso();
  const jobs = await Promise.all(
    [...formats]
      .sort((a, b) => PROMOTION_RENDER_ORDER.indexOf(a) - PROMOTION_RENDER_ORDER.indexOf(b))
      .map(async (format, index) => ({
        ...(await promotionRenderLocation(userId, occurrenceId, fingerprint, format)),
        format,
        due: new Date(Date.parse(now) + index).toISOString(),
      })),
  );
  return {
    jobs,
    statements: [
      ...jobs.map((job) =>
        db
          .prepare(`${authority ? `WITH allowed AS MATERIALIZED(${authority.sql}) ` : ""}INSERT INTO event_promotion_renders(id,event_id,occurrence_id,user_id,revision,fingerprint,format,origin,cache_key,status,next_attempt_at,created_at,updated_at,requested_at)
    SELECT ?,${scope.sql},?,?,?,?,?,?,?,'queued',?,?,?,? ${authority ? "FROM allowed WHERE 1" : "WHERE 1"} ON CONFLICT(id) DO UPDATE SET requested_at=excluded.requested_at,
      status=CASE WHEN event_promotion_renders.status IN('failed','obsolete') THEN 'queued' ELSE event_promotion_renders.status END,
      attempts=CASE WHEN event_promotion_renders.status IN('failed','obsolete') THEN 0 ELSE event_promotion_renders.attempts END,
      next_attempt_at=CASE WHEN event_promotion_renders.status IN('failed','obsolete') THEN excluded.next_attempt_at ELSE event_promotion_renders.next_attempt_at END,
      processing_token=CASE WHEN event_promotion_renders.status IN('failed','obsolete') THEN NULL ELSE event_promotion_renders.processing_token END,
      lease_expires_at=CASE WHEN event_promotion_renders.status IN('failed','obsolete') THEN NULL ELSE event_promotion_renders.lease_expires_at END,
      last_error=CASE WHEN event_promotion_renders.status IN('failed','obsolete') THEN NULL ELSE event_promotion_renders.last_error END,updated_at=excluded.updated_at`)
          .bind(
            ...(authority?.bindings ?? []),
            job.id,
            ...scope.bindings,
            occurrenceId,
            userId,
            revision,
            fingerprint,
            job.format,
            origin,
            job.key,
            job.due,
            now,
            now,
            now,
          ),
      ),
      prepareJobWake(db, "due_work", authority),
      db
        .prepare(
          `SELECT id,event_id,occurrence_id,user_id,revision,fingerprint,format,origin,cache_key,status,attempts FROM event_promotion_renders WHERE event_id=${scope.sql} AND user_id=? AND id IN(SELECT value FROM json_each(?)) LIMIT 5`,
        )
        .bind(...scope.bindings, userId, JSON.stringify(jobs.map((job) => job.id))),
    ],
    decode(loaded: D1StatementResult[]) {
      const rows = batchRows<PromotionRenderJob>(loaded.at(-1)!);
      return jobs.map((job) => {
        const row = rows.find((row) => row.id === job.id);
        if (!row) throw new AppError(409, "PROMOTION_JOB_CHANGED", "Refresh your promotion kit and try again.");
        return row;
      });
    },
  };
}
