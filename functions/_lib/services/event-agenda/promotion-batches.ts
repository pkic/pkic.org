import { prepareJobWake } from "../scheduled-jobs/dispatcher";
import type { z } from "zod";
import type { DatabaseLike, D1StatementResult, Env } from "../../types";
import {
  promotionBatchCreateSchema,
  promotionBatchSchema,
} from "../../../../assets/shared/schemas/event-promotion-batches";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { batchFirst } from "../../db/pagination";
import { prepareAuditLogWhen } from "../audit";
import { preparePromotionRequestActor } from "./promotion-request-context";
import { permissionAuthorizationEvidenceForResource, requirePermission } from "../../auth/permissions";
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
    ) SELECT batch.id,batch.requested_by AS requestedBy,batch.formats_json AS formatsJson,batch.published_revision AS publishedRevision,batch.created_at AS createdAt,
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
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  origin: string,
  input: z.infer<typeof promotionBatchCreateSchema>,
) {
  const actor = await preparePromotionRequestActor(db, request, env),
    event = eventReadIdSql({ slug: eventSlug }),
    at = nowIso();
  const permission = permissionAuthorizationEvidenceForResource(
    actor.permissionActor,
    "agenda:write",
    { type: "event", idSql: "(SELECT id FROM promotion_event)" },
    actor.memberSelection,
  );
  const allowed = {
    sql: `WITH promotion_event AS MATERIALIZED(SELECT id FROM events WHERE slug=?), promotion_permission AS MATERIALIZED(${permission.sql}), promotion_actor AS MATERIALIZED(${actor.managementAuthorizationEvidence.sql}) SELECT 1 FROM promotion_permission,promotion_actor WHERE EXISTS(SELECT 1 FROM event_agenda_state WHERE event_id=(SELECT id FROM promotion_event) AND published_revision=?)`,
    bindings: [
      eventSlug,
      ...permission.bindings,
      ...actor.managementAuthorizationEvidence.bindings,
      input.publishedRevision,
    ],
  };
  const read = preparePromotionBatchRead(db, { slug: eventSlug }, input.requestId);
  const results = await db.batch([
    ...actor.statements,
    db
      .prepare(
        `SELECT event.id,state.published_revision FROM events event LEFT JOIN event_agenda_state state ON state.event_id=event.id WHERE event.slug=?`,
      )
      .bind(eventSlug),
    db
      .prepare(
        `WITH allowed AS MATERIALIZED(${allowed.sql}) INSERT INTO event_promotion_batches(id,event_id,requested_by,published_revision,formats_json,origin,created_at) SELECT ?,${event.sql},?,?,?,?,? FROM allowed WHERE 1 ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        ...allowed.bindings,
        input.requestId,
        ...event.bindings,
        actor.subjectId,
        input.publishedRevision,
        JSON.stringify(input.formats),
        origin,
        at,
      ),
    db
      .prepare(`INSERT INTO event_promotion_batch_recipients(batch_id,occurrence_id,user_id,next_attempt_at,updated_at)
        SELECT ?,occurrence.id,speaker.user_id,?,? FROM event_agenda_occurrences occurrence JOIN event_agenda_occurrence_speakers speaker ON speaker.occurrence_id=occurrence.id JOIN users person ON person.id=speaker.user_id
        WHERE changes()=1 AND occurrence.event_id=${event.sql} AND person.active=1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL AND EXISTS(
          SELECT 1 FROM event_agenda_publications publication,json_each(publication.snapshot_json,'$.occurrences') entry
          WHERE publication.event_id=occurrence.event_id AND publication.revision=? AND json_extract(entry.value,'$.id')=occurrence.id AND json_extract(entry.value,'$.visibility')='public' AND json_extract(entry.value,'$.kind')<>'break' AND EXISTS(SELECT 1 FROM json_each(entry.value,'$.speakers') credit WHERE json_extract(credit.value,'$.userId')=speaker.user_id))
        ON CONFLICT(batch_id,occurrence_id,user_id) DO NOTHING`)
      .bind(input.requestId, at, at, ...event.bindings, input.publishedRevision),
    prepareAuditLogWhen(db, {
      actorType: "user",
      actorId: actor.subjectId,
      actorIdentityIdSelection: actor.actingIdentitySelection,
      action: "promotion_batch_requested",
      entityType: "event",
      entityId: null,
      entityIdSelection: event,
      scope: { type: "event", id: "" },
      scopeIdSelection: event,
      details: { batchId: input.requestId },
      createdAt: at,
      idempotencyKey: `promotion-batch:${input.requestId}`,
      conditionSql: `WITH allowed AS MATERIALIZED(${allowed.sql}) SELECT 1 FROM allowed WHERE EXISTS(SELECT 1 FROM event_promotion_batches WHERE id=? AND event_id=${event.sql} AND requested_by=? AND published_revision=? AND formats_json=?)`,
      conditionBindings: [
        ...allowed.bindings,
        input.requestId,
        ...event.bindings,
        actor.subjectId,
        input.publishedRevision,
        JSON.stringify(input.formats),
      ],
    }),
    prepareJobWake(db, "due_work", allowed),
    ...read.statements,
  ]);
  const current = await actor.decode(results.slice(0, actor.statements.length));
  const target = batchFirst<{ id: string; published_revision: number | null }>(results[actor.statements.length]);
  if (!target) throw new AppError(404, "EVENT_NOT_FOUND", "Event unavailable.");
  if (!current.staff)
    throw new AppError(403, "PERMISSION_REQUIRED", "Agenda access is required to prepare all speaker kits.");
  requirePermission(current.staff, "agenda:write", { type: "event", id: target.id });
  const loaded = results.slice(-read.statements.length),
    row = batchFirst<{ requestedBy: string; formatsJson: string; publishedRevision: number }>(loaded[0]);
  if (
    target.published_revision !== input.publishedRevision ||
    !row ||
    row.requestedBy !== actor.subjectId ||
    row.formatsJson !== JSON.stringify(input.formats) ||
    row.publishedRevision !== input.publishedRevision
  )
    throw new AppError(
      409,
      "PROMOTION_BATCH_CHANGED",
      "The agenda or bulk request changed. Refresh before starting another batch.",
    );
  return read.decode(loaded);
}
