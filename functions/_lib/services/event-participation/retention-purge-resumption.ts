import { scannerReconciliationSchema } from "../../../../assets/shared/schemas/event-scanner-reconciliation";
import type {
  EvidencePurgeReviewCreate,
  EvidencePurgeResumptionCreate,
} from "../../../../assets/shared/schemas/event-evidence-purge";
import { first } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso, addMinutes } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import {
  requirePurgeAuthority,
  commitPurge,
  purgeContextGuard,
  evidencePurgePreview,
  purgeReviewReadColumns,
  purgeReviewResponse,
  preparePurgeReviewInsert,
  type PurgeReviewRow,
} from "./retention-purge-review";
import { readPurgeRun, purgeRunResponse } from "./retention-purge-runs";
export async function renewEvidencePurgeReview(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  eventId: string,
  runId: string,
  input: EvidencePurgeReviewCreate,
) {
  requirePurgeAuthority(actor, eventId, true);
  const run = await readPurgeRun(db, actor, eventId, runId);
  const prior = await first<PurgeReviewRow>(
    db,
    `SELECT ${purgeReviewReadColumns} FROM event_evidence_retention_reviews WHERE operation_id=?`,
    [input.operationId],
  );
  if (prior) {
    if (
      prior.run_id !== runId ||
      prior.actor_user_id !== actor.id ||
      prior.policy_revision !== input.expectedPolicyRevision ||
      prior.source_generation !== input.expectedGeneration ||
      prior.review_hash !== input.expectedPreviewHash
    )
      throw new AppError(409, "EVIDENCE_REVIEW_OPERATION_CONFLICT", "Renewal review belongs to another request.");
    await commitPurge(db, actor, eventId, []);
    return purgeReviewResponse(prior);
  }
  if (run.status !== "running")
    throw new AppError(409, "EVIDENCE_RUN_COMPLETE", "This evidence removal run is already complete.");
  const current = await evidencePurgePreview(db, actor, eventId);
  const preview = {
    ...current,
    reconciliation: scannerReconciliationSchema.parse(JSON.parse(run.reconciliation_json)),
    blockers: current.blockers.filter((code) => code !== "active_run" && code !== "device_reconciliation_incomplete"),
  };
  if (
    preview.blockers.length ||
    current.activeRunId !== runId ||
    current.previewHash !== input.expectedPreviewHash ||
    current.policyRevision !== input.expectedPolicyRevision ||
    current.sourceGeneration !== input.expectedGeneration ||
    current.sourceGeneration !== run.expected_generation ||
    current.publicationRevision !== run.publication_revision ||
    current.timeZone !== run.time_zone
  )
    throw new AppError(
      409,
      "EVIDENCE_RENEWAL_BLOCKED",
      "The policy, source or pinned publication cannot be renewed for this run. Keep capture retired until its prerequisites are resolved.",
    );
  const id = uuid(),
    reviewedAt = nowIso(),
    expiresAt = addMinutes(reviewedAt, 15),
    reviewHash = current.previewHash;
  const row: PurgeReviewRow = {
    id,
    event_id: eventId,
    actor_user_id: actor.id,
    operation_id: input.operationId,
    review_hash: reviewHash,
    policy_revision: preview.policyRevision,
    source_generation: preview.sourceGeneration,
    publication_revision: run.publication_revision,
    time_zone: run.time_zone,
    counts_json: JSON.stringify(preview.counts),
    reconciliation_json: run.reconciliation_json,
    reviewed_at: reviewedAt,
    expires_at: expiresAt,
    run_id: runId,
  };
  try {
    await commitPurge(db, actor, eventId, [
      purgeContextGuard(
        db,
        eventId,
        row.policy_revision,
        row.source_generation,
        run.publication_revision,
        run.time_zone,
        runId,
      ),
      preparePurgeReviewInsert(db, row),
      db.prepare("INSERT INTO event_evidence_retention_review_runs(review_id,run_id) VALUES(?,?)").bind(id, runId),
      prepareAuditLog(
        db,
        "user",
        actor.id,
        "event_evidence_removal_review_renewed",
        "event",
        eventId,
        { runId, reviewId: id, reviewHash, policyRevision: row.policy_revision, counts: preview.counts },
        reviewedAt,
      ),
    ]);
  } catch (error) {
    const committed = await first(db, "SELECT 1 FROM event_evidence_retention_reviews WHERE operation_id=?", [
      input.operationId,
    ]);
    if (committed) return renewEvidencePurgeReview(db, actor, eventId, runId, input);
    throw error;
  }
  return purgeReviewResponse(row);
}
export async function resumeEvidencePurgeRun(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  eventId: string,
  runId: string,
  input: EvidencePurgeResumptionCreate,
) {
  requirePurgeAuthority(actor, eventId, true);
  const run = await readPurgeRun(db, actor, eventId, runId);
  const prior = await first<{ run_id: string; review_id: string; actor_user_id: string }>(
    db,
    "SELECT run_id,review_id,actor_user_id FROM event_evidence_retention_resumptions WHERE operation_id=?",
    [input.operationId],
  );
  const review = await first<PurgeReviewRow>(
    db,
    `SELECT ${purgeReviewReadColumns} FROM event_evidence_retention_reviews WHERE id=?`,
    [input.reviewId],
  );
  if (prior) {
    if (
      prior.run_id !== runId ||
      prior.review_id !== input.reviewId ||
      prior.actor_user_id !== actor.id ||
      review?.review_hash !== input.reviewHash
    )
      throw new AppError(409, "EVIDENCE_RESUMPTION_OPERATION_CONFLICT", "Resumption belongs to another request.");
    await commitPurge(db, actor, eventId, []);
    return purgeRunResponse(run);
  }
  if (
    run.status !== "running" ||
    !review ||
    review.run_id !== runId ||
    review.actor_user_id !== actor.id ||
    review.review_hash !== input.reviewHash ||
    review.expires_at <= nowIso() ||
    review.source_generation !== run.expected_generation ||
    review.publication_revision !== run.publication_revision ||
    review.time_zone !== run.time_zone
  )
    throw new AppError(
      409,
      "EVIDENCE_RENEWAL_UNAVAILABLE",
      "The renewed review is unavailable, expired or no longer matches this run.",
    );
  const now = nowIso();
  try {
    await commitPurge(db, actor, eventId, [
      purgeContextGuard(
        db,
        eventId,
        review.policy_revision,
        run.expected_generation,
        run.publication_revision,
        run.time_zone,
        runId,
      ),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM event_evidence_retention_reviews review JOIN event_evidence_retention_review_runs mapping ON mapping.review_id=review.id JOIN event_evidence_retention_runs run ON run.id=mapping.run_id WHERE review.id=? AND mapping.run_id=? AND review.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND run.expected_generation=? AND run.ordinal=? AND run.status='running'",
        bindings: [review.id, runId, run.expected_generation, run.ordinal],
      }),
      db
        .prepare(
          "INSERT INTO event_evidence_retention_resumptions(operation_id,run_id,review_id,actor_user_id,created_at) VALUES(?,?,?,?,?)",
        )
        .bind(input.operationId, runId, review.id, actor.id, now),
      db
        .prepare(
          "UPDATE event_evidence_retention_runs SET policy_revision=? WHERE id=? AND expected_generation=? AND ordinal=?",
        )
        .bind(review.policy_revision, runId, run.expected_generation, run.ordinal),
      prepareAuditLog(
        db,
        "user",
        actor.id,
        "event_evidence_removal_resumed",
        "event",
        eventId,
        { runId, reviewId: review.id, policyRevision: review.policy_revision, ordinal: run.ordinal },
        now,
      ),
    ]);
  } catch (error) {
    const committed = await first(db, "SELECT 1 FROM event_evidence_retention_resumptions WHERE operation_id=?", [
      input.operationId,
    ]);
    if (committed) return resumeEvidencePurgeRun(db, actor, eventId, runId, input);
    throw error;
  }
  return purgeRunResponse(await readPurgeRun(db, actor, eventId, runId));
}
