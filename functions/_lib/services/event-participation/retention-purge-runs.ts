import {
  evidencePurgeRunResponseSchema,
  type EvidencePurgeRunCreate,
} from "../../../../assets/shared/schemas/event-evidence-purge";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import {
  commitPurge,
  requirePurgeAuthority,
  purgeContextGuard,
  purgeReviewReadColumns,
  type PurgeReviewRow,
} from "./retention-purge-review";
export interface PurgeRunRow {
  id: string;
  event_id: string;
  review_id: string;
  actor_user_id: string;
  operation_id: string;
  policy_revision: number;
  expected_generation: number;
  publication_revision: number | null;
  time_zone: string;
  status: "running" | "complete";
  phase: string;
  ordinal: number;
  started_at: string;
  completed_at: string | null;
  reconciliation_json: string;
  current_policy_revision?: number;
}
export const purgeRunColumns =
  "id,event_id,review_id,actor_user_id,operation_id,policy_revision,expected_generation,publication_revision,time_zone,status,phase,ordinal,started_at,completed_at,reconciliation_json";
export function purgeRunResponse(run: PurgeRunRow) {
  return evidencePurgeRunResponseSchema.parse({
    success: true,
    runId: run.id,
    eventId: run.event_id,
    status: run.status,
    reviewRequired:
      run.status === "running" &&
      run.current_policy_revision !== undefined &&
      run.current_policy_revision !== run.policy_revision,
    phase: run.phase,
    ordinal: run.ordinal,
    sourceGeneration: run.expected_generation,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    reconciliation: JSON.parse(run.reconciliation_json),
  });
}
export async function readPurgeRun(db: DatabaseLike, actor: UserBackedAuthAdmin, eventId: string, runId: string) {
  requirePurgeAuthority(actor, eventId);
  const run = await first<PurgeRunRow>(
    db,
    `SELECT ${purgeRunColumns},(SELECT revision FROM event_evidence_retention_policies WHERE event_id=event_evidence_retention_runs.event_id) AS current_policy_revision FROM event_evidence_retention_runs WHERE id=? AND event_id=?`,
    [runId, eventId],
  );
  if (!run) throw new AppError(404, "EVIDENCE_PURGE_RUN_NOT_FOUND", "Evidence removal run unavailable.");
  return run;
}
export async function startEvidencePurgeRun(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  eventId: string,
  input: EvidencePurgeRunCreate,
) {
  requirePurgeAuthority(actor, eventId, true);
  const prior = await first<PurgeRunRow>(
    db,
    `SELECT ${purgeRunColumns} FROM event_evidence_retention_runs WHERE operation_id=?`,
    [input.operationId],
  );
  if (prior) {
    if (prior.event_id !== eventId || prior.actor_user_id !== actor.id || prior.review_id !== input.reviewId)
      throw new AppError(409, "EVIDENCE_RUN_OPERATION_CONFLICT", "Removal operation belongs to another request.");
    const review = await first<{ review_hash: string }>(
      db,
      "SELECT review_hash FROM event_evidence_retention_reviews WHERE id=?",
      [prior.review_id],
    );
    if (review?.review_hash !== input.reviewHash)
      throw new AppError(409, "EVIDENCE_RUN_OPERATION_CONFLICT", "The review hash does not match this run.");
    await commitPurge(db, actor, eventId, []);
    return purgeRunResponse(await readPurgeRun(db, actor, eventId, prior.id));
  }
  const review = await first<PurgeReviewRow>(
    db,
    `SELECT ${purgeReviewReadColumns} FROM event_evidence_retention_reviews WHERE id=? AND event_id=?`,
    [input.reviewId, eventId],
  );
  if (
    !review ||
    review.run_id ||
    review.actor_user_id !== actor.id ||
    review.review_hash !== input.reviewHash ||
    review.expires_at <= nowIso()
  )
    throw new AppError(
      409,
      "EVIDENCE_REVIEW_UNAVAILABLE",
      "This review is unavailable, expired or belongs to another operator.",
    );
  const id = uuid(),
    startedAt = nowIso();
  try {
    await commitPurge(db, actor, eventId, [
      purgeContextGuard(
        db,
        eventId,
        review.policy_revision,
        review.source_generation,
        review.publication_revision,
        review.time_zone,
        null,
        true,
      ),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM event_evidence_retention_reviews WHERE id=? AND actor_user_id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        bindings: [review.id, actor.id],
      }),
      db
        .prepare(
          `INSERT INTO event_evidence_retention_runs(${purgeRunColumns}) VALUES(?,?,?,?,?,?,?,?,?,'running','aggregates',0,?,NULL,?)`,
        )
        .bind(
          id,
          eventId,
          review.id,
          actor.id,
          input.operationId,
          review.policy_revision,
          review.source_generation,
          review.publication_revision,
          review.time_zone,
          startedAt,
          review.reconciliation_json,
        ),
      db
        .prepare(
          "INSERT INTO event_evidence_retention_state(event_id,generation,active_run_id,capture_closed_at) VALUES(?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET active_run_id=excluded.active_run_id,capture_closed_at=excluded.capture_closed_at",
        )
        .bind(eventId, review.source_generation, id, startedAt),
      db
        .prepare("INSERT INTO event_evidence_retention_progress(run_id,cursor_key,updated_at) VALUES(?,NULL,?)")
        .bind(id, startedAt),
      prepareAuditLog(
        db,
        "user",
        actor.id,
        "event_evidence_capture_retired",
        "event",
        eventId,
        {
          runId: id,
          reviewHash: review.review_hash,
          policyRevision: review.policy_revision,
          sourceGeneration: review.source_generation,
        },
        startedAt,
      ),
    ]);
  } catch (error) {
    const committed = await first(db, "SELECT 1 FROM event_evidence_retention_runs WHERE operation_id=?", [
      input.operationId,
    ]);
    if (committed) return startEvidencePurgeRun(db, actor, eventId, input);
    throw error;
  }
  return purgeRunResponse(await readPurgeRun(db, actor, eventId, id));
}
