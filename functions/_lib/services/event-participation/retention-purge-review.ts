import {
  evidencePurgePreviewSchema,
  evidencePurgeReviewResponseSchema,
  type EvidencePurgeReviewCreate,
} from "../../../../assets/shared/schemas/event-evidence-purge";
import { preparePermissionsAuthorizationGuard, requirePermission } from "../../auth/permissions";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin, StatementLike } from "../../types";
import { nowIso, addMinutes } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { sha256Hex } from "../../utils/crypto";
import { prepareAuditLog } from "../audit";
import { readEventEvidenceRetentionPolicy } from "./retention-policy";
import { readEventContactRetention, eventContactAccessSql } from "./evidence-retention";
import { eventScannerReconciliation } from "./scanner-reconciliation";
import { rawEvidenceCounts } from "./retention-purge-source";
export function purgePermissions(eventId: string, destructive = false) {
  return [
    { permission: "retention:read" },
    ...(destructive ? [{ permission: "retention:run" }, { permission: "users:anonymize" }] : []),
    { permission: "events:manage", context: { type: "event", id: eventId } },
  ];
}
export function requirePurgeAuthority(actor: UserBackedAuthAdmin, eventId: string, destructive = false) {
  for (const requirement of purgePermissions(eventId, destructive))
    requirePermission(actor, requirement.permission, requirement.context);
  if (destructive && !actor.sessionId)
    throw new AppError(403, "HUMAN_SESSION_REQUIRED", "Evidence removal requires a live attributable session.");
}
export const purgeDeviceBarrierSql = `EXISTS(SELECT 1 FROM event_scanner_reconciliation_coverage coverage WHERE coverage.event_id=e.id)
  AND NOT EXISTS(SELECT 1 FROM event_scanner_device_sessions session WHERE session.event_id=e.id AND
    (session.closed_at IS NULL OR session.high_water_sequence IS NULL OR session.high_water_sequence<>(SELECT COUNT(*) FROM event_scanner_upload_receipts receipt WHERE receipt.epoch_id=session.id) OR
    COALESCE((SELECT MAX(sequence) FROM event_scanner_upload_receipts receipt WHERE receipt.epoch_id=session.id),0)>session.high_water_sequence))
  AND NOT EXISTS(SELECT 1 FROM event_scan_attempts attempt WHERE attempt.event_id=e.id AND NOT EXISTS(
    SELECT 1 FROM event_scanner_upload_receipts receipt JOIN event_scanner_device_sessions session ON session.id=receipt.epoch_id
    WHERE receipt.operation_id=attempt.operation_id AND session.event_id=attempt.event_id AND session.operator_user_id=attempt.operator_user_id AND session.device_id=attempt.device_id))`;
export function purgeContextGuard(
  db: DatabaseLike,
  eventId: string,
  revision: number,
  generation: number,
  publicationRevision: number | null,
  timeZone: string,
  runId: string | null,
  reviewDevices = false,
) {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1 FROM events e
    JOIN event_evidence_retention_policies policy ON policy.event_id=e.id
    LEFT JOIN event_evidence_retention_state state ON state.event_id=e.id
    LEFT JOIN event_agenda_state agenda ON agenda.event_id=e.id
    LEFT JOIN event_agenda_publications publication ON publication.event_id=e.id AND publication.revision=agenda.published_revision
    WHERE e.id=? AND policy.revision=? AND policy.evidence_until IS NOT NULL AND policy.evidence_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND policy.legal_hold=0
    AND COALESCE(state.generation,0)=? AND state.active_run_id IS ? AND state.purged_at IS NULL
    AND agenda.published_revision IS ? AND COALESCE(json_extract(publication.snapshot_json,'$.timeZone'),e.timezone,'UTC')=?
    AND NOT (${eventContactAccessSql("e.id")})
    AND NOT EXISTS(SELECT 1 FROM event_offline_admission_grants grant_record WHERE grant_record.event_id=e.id AND grant_record.closed_at IS NULL)
    ${reviewDevices ? `AND ${purgeDeviceBarrierSql}` : "AND NOT EXISTS(SELECT 1 FROM event_scanner_device_sessions session WHERE session.event_id=e.id AND session.closed_at IS NULL)"}`,
    bindings: [eventId, revision, generation, runId, publicationRevision, timeZone],
  });
}
export async function commitPurge(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  eventId: string,
  statements: StatementLike[],
  destructive = true,
) {
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, purgePermissions(eventId, destructive)),
      ...statements,
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(
        409,
        "EVIDENCE_PURGE_CONTEXT_CHANGED",
        "Evidence, policy, reconciliation or authority changed. Review the current state before continuing.",
      );
    throw error;
  }
}
export async function evidencePurgePreview(db: DatabaseLike, actor: UserBackedAuthAdmin, eventId: string) {
  requirePurgeAuthority(actor, eventId);
  const policy = await readEventEvidenceRetentionPolicy(db, actor, eventId);
  const meta = await first<{
    generation: number;
    activeRunId: string | null;
    publicationRevision: number | null;
    timeZone: string;
  }>(
    db,
    `SELECT COALESCE(retention.generation,0) AS generation,retention.active_run_id AS activeRunId,agenda.published_revision AS publicationRevision,COALESCE(json_extract(publication.snapshot_json,'$.timeZone'),e.timezone,'UTC') AS timeZone FROM events e LEFT JOIN event_evidence_retention_state retention ON retention.event_id=e.id LEFT JOIN event_agenda_state agenda ON agenda.event_id=e.id LEFT JOIN event_agenda_publications publication ON publication.event_id=e.id AND publication.revision=agenda.published_revision WHERE e.id=?`,
    [eventId],
  );
  const counts = await rawEvidenceCounts(db, eventId),
    reconciliation = await eventScannerReconciliation(db, eventId),
    contact = await readEventContactRetention(db, eventId);
  const blockers: string[] = [];
  if (policy.policy.evidenceUntil === null) blockers.push("policy_unconfigured");
  else if (policy.policy.evidenceUntil > nowIso()) blockers.push("cutoff_not_due");
  if (policy.policy.legalHold) blockers.push("removal_paused");
  if (contact.state !== "closed") blockers.push("contact_open");
  if (reconciliation.deviceBacklog !== "complete") blockers.push("device_reconciliation_incomplete");
  if (meta!.activeRunId) blockers.push("active_run");
  if (policy.purgedAt) blockers.push("already_purged");
  const snapshot = {
    success: true,
    eventId,
    activeRunId: meta!.activeRunId,
    policyRevision: policy.revision,
    sourceGeneration: meta!.generation,
    publicationRevision: meta!.publicationRevision,
    timeZone: meta!.timeZone,
    counts,
    reconciliation,
    blockers,
  };
  return evidencePurgePreviewSchema.parse({ ...snapshot, previewHash: await sha256Hex(JSON.stringify(snapshot)) });
}
export interface PurgeReviewRow {
  id: string;
  event_id: string;
  actor_user_id: string;
  operation_id: string;
  review_hash: string;
  policy_revision: number;
  source_generation: number;
  publication_revision: number | null;
  time_zone: string;
  counts_json: string;
  reconciliation_json: string;
  reviewed_at: string;
  expires_at: string;
  run_id?: string | null;
}
export function purgeReviewResponse(row: PurgeReviewRow) {
  return evidencePurgeReviewResponseSchema.parse({
    success: true,
    eventId: row.event_id,
    activeRunId: row.run_id ?? null,
    policyRevision: row.policy_revision,
    sourceGeneration: row.source_generation,
    publicationRevision: row.publication_revision,
    timeZone: row.time_zone,
    counts: JSON.parse(row.counts_json),
    reconciliation: JSON.parse(row.reconciliation_json),
    blockers: [],
    previewHash: row.review_hash,
    reviewId: row.id,
    reviewHash: row.review_hash,
    reviewedAt: row.reviewed_at,
    expiresAt: row.expires_at,
  });
}
export const purgeReviewColumns =
  "id,event_id,actor_user_id,operation_id,review_hash,policy_revision,source_generation,publication_revision,time_zone,counts_json,reconciliation_json,reviewed_at,expires_at";
export const purgeReviewReadColumns =
  purgeReviewColumns +
  ",(SELECT mapping.run_id FROM event_evidence_retention_review_runs mapping WHERE mapping.review_id=event_evidence_retention_reviews.id) AS run_id";
export function preparePurgeReviewInsert(db: DatabaseLike, row: PurgeReviewRow) {
  return db
    .prepare(`INSERT INTO event_evidence_retention_reviews(${purgeReviewColumns}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      row.id,
      row.event_id,
      row.actor_user_id,
      row.operation_id,
      row.review_hash,
      row.policy_revision,
      row.source_generation,
      row.publication_revision,
      row.time_zone,
      row.counts_json,
      row.reconciliation_json,
      row.reviewed_at,
      row.expires_at,
    );
}
export async function createEvidencePurgeReview(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  eventId: string,
  input: EvidencePurgeReviewCreate,
) {
  requirePurgeAuthority(actor, eventId, true);
  const prior = await first<PurgeReviewRow>(
    db,
    `SELECT ${purgeReviewReadColumns} FROM event_evidence_retention_reviews WHERE operation_id=?`,
    [input.operationId],
  );
  if (prior) {
    if (
      prior.run_id ||
      prior.event_id !== eventId ||
      prior.actor_user_id !== actor.id ||
      prior.policy_revision !== input.expectedPolicyRevision ||
      prior.source_generation !== input.expectedGeneration ||
      prior.review_hash !== input.expectedPreviewHash
    )
      throw new AppError(409, "EVIDENCE_REVIEW_OPERATION_CONFLICT", "Review operation belongs to another request.");
    await commitPurge(db, actor, eventId, []);
    return purgeReviewResponse(prior);
  }
  const preview = await evidencePurgePreview(db, actor, eventId);
  if (
    preview.blockers.length ||
    preview.policyRevision !== input.expectedPolicyRevision ||
    preview.sourceGeneration !== input.expectedGeneration ||
    preview.previewHash !== input.expectedPreviewHash
  )
    throw new AppError(
      409,
      "EVIDENCE_REVIEW_BLOCKED",
      "Evidence removal readiness changed or has unresolved prerequisites.",
    );
  const id = uuid(),
    reviewedAt = nowIso(),
    expiresAt = addMinutes(reviewedAt, 15),
    reviewHash = preview.previewHash;
  const row: PurgeReviewRow = {
    id,
    event_id: eventId,
    actor_user_id: actor.id,
    operation_id: input.operationId,
    review_hash: reviewHash,
    policy_revision: preview.policyRevision,
    source_generation: preview.sourceGeneration,
    publication_revision: preview.publicationRevision,
    time_zone: preview.timeZone,
    counts_json: JSON.stringify(preview.counts),
    reconciliation_json: JSON.stringify(preview.reconciliation),
    reviewed_at: reviewedAt,
    expires_at: expiresAt,
  };
  try {
    await commitPurge(db, actor, eventId, [
      purgeContextGuard(
        db,
        eventId,
        preview.policyRevision,
        preview.sourceGeneration,
        preview.publicationRevision,
        preview.timeZone,
        null,
        true,
      ),
      preparePurgeReviewInsert(db, row),
      prepareAuditLog(
        db,
        "user",
        actor.id,
        "event_evidence_removal_reviewed",
        "event",
        eventId,
        { reviewId: id, reviewHash, counts: preview.counts },
        reviewedAt,
      ),
    ]);
  } catch (error) {
    const committed = await first(db, "SELECT 1 FROM event_evidence_retention_reviews WHERE operation_id=?", [
      input.operationId,
    ]);
    if (committed) return createEvidencePurgeReview(db, actor, eventId, input);
    throw error;
  }
  return purgeReviewResponse(row);
}
