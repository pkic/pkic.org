import {
  attendanceImportContextSchema,
  attendanceImportRequestSchema,
  attendanceImportReviewSchema,
  attendanceImportApplySchema,
  attendanceImportReceiptSchema,
  attendanceImportsQuerySchema,
  attendanceImportsResponseSchema,
} from "../../../../assets/shared/schemas/event-attendance-imports";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { first, all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { prepareScopedAuditLog } from "../audit";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { captureImportContext, importContextEvidence, importRowsEvidence } from "./attendance-import-context";
import { captureAttendanceContext } from "../../../../assets/shared/schemas/event-attendance-capture";
const receiptProjection =
  "id,operation_id AS operationId,reviewer_user_id AS reviewerUserId,actor_user_id AS actorUserId,source,source_reference AS sourceReference,row_count AS rowCount,received_at AS receivedAt";
async function hashPayload(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function reviewAttendanceImport(
  db: DatabaseLike,
  eventId: string,
  actorId: string,
  raw: unknown,
): Promise<ReturnType<typeof attendanceImportReviewSchema.parse>> {
  const input = attendanceImportRequestSchema.parse(raw);

  const prior = await first<{
    id: string;
    actor_user_id: string;
    payload_hash: string;
    reviewed_at: string;
    expires_at: string;
    event_id: string;
    payload_json: string;
    capture_context_json: string | null;
    capture_context_hash: string | null;
  }>(
    db,
    "SELECT id,actor_user_id,payload_hash,reviewed_at,expires_at,event_id,payload_json,capture_context_json,capture_context_hash FROM event_attendance_import_reviews WHERE operation_id=?",
    [input.operationId],
  );
  if (prior) {
    if (
      prior.event_id !== eventId ||
      prior.actor_user_id !== actorId ||
      (await hashPayload(attendanceImportRequestSchema.parse(JSON.parse(prior.payload_json)))) !==
        (await hashPayload(input))
    )
      throw new AppError(
        409,
        "ATTENDANCE_IMPORT_OPERATION_CONFLICT",
        "This review operation was used for different evidence.",
      );
    if (!prior.capture_context_json || !prior.capture_context_hash)
      throw new AppError(
        409,
        "ATTENDANCE_IMPORT_REVIEW_CHANGED",
        "This legacy review has no captured context. Create a new review.",
      );
    return attendanceImportReviewSchema.parse({
      reviewId: prior.id,
      payloadHash: prior.payload_hash,
      captureContextHash: prior.capture_context_hash,
      captureContext: attendanceImportContextSchema.parse(JSON.parse(prior.capture_context_json)),
      rowCount: input.rows.length,
      reviewedAt: prior.reviewed_at,
      expiresAt: prior.expires_at,
    });
  }
  const reviewedAt = nowIso(),
    expiresAt = new Date(Date.parse(reviewedAt) + 15 * 60_000).toISOString(),
    id = crypto.randomUUID();
  const captureContext = await captureImportContext(db, eventId, input);
  const captureContextHash = await hashPayload(captureContext);
  const payloadHash = await hashPayload({ input, captureContext });
  const contextEvidence = importContextEvidence(eventId, captureContext);
  const rowsEvidence = importRowsEvidence(eventId, input.rows, captureContext, reviewedAt);
  if (!(await first(db, rowsEvidence.sql, [...rowsEvidence.bindings])))
    throw new AppError(
      422,
      "ATTENDANCE_IMPORT_EVIDENCE_INVALID",
      "Resolve unknown people or observations outside the reviewed event/session interval before reviewing.",
    );
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO event_attendance_import_guards(id,valid) SELECT ?,CASE WHEN EXISTS(${contextEvidence.sql}) AND EXISTS(${rowsEvidence.sql}) THEN 1 ELSE 0 END`,
        )
        .bind(id, ...contextEvidence.bindings, ...rowsEvidence.bindings),
      db
        .prepare(
          "INSERT INTO event_attendance_import_reviews(id,event_id,operation_id,actor_user_id,payload_hash,payload_json,reviewed_at,expires_at,capture_context_json,capture_context_hash) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          eventId,
          input.operationId,
          actorId,
          payloadHash,
          JSON.stringify(input),
          reviewedAt,
          expiresAt,
          JSON.stringify(captureContext),
          captureContextHash,
        ),
      prepareScopedAuditLog(
        db,
        { type: "event", id: eventId },
        "user",
        actorId,
        "agenda.attendance.import_reviewed",
        "attendance_import_review",
        id,
        { rowCount: input.rows.length, source: input.source, payloadHash },
      ),
      db.prepare("DELETE FROM event_attendance_import_guards WHERE id=?").bind(id),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("UNIQUE constraint") &&
      (await first(db, "SELECT 1 FROM event_attendance_import_reviews WHERE operation_id=?", [input.operationId]))
    )
      return reviewAttendanceImport(db, eventId, actorId, input);
    if (error instanceof Error && error.message.includes("attendance_import_review_valid"))
      throw new AppError(409, "ATTENDANCE_IMPORT_REVIEW_CHANGED", "Evidence changed; review again.");
    throw error;
  }
  return attendanceImportReviewSchema.parse({
    reviewId: id,
    payloadHash,
    captureContextHash,
    captureContext,
    rowCount: input.rows.length,
    reviewedAt,
    expiresAt,
  });
}
export async function applyAttendanceImport(
  db: DatabaseLike,
  eventId: string,
  actorId: string,
  raw: unknown,
): Promise<ReturnType<typeof attendanceImportReceiptSchema.parse>> {
  const input = attendanceImportApplySchema.parse(raw);
  const prior = await first<Record<string, unknown>>(
    db,
    `SELECT ${receiptProjection},review_id AS reviewId FROM event_attendance_imports WHERE operation_id=?`,
    [input.operationId],
  );
  if (prior) {
    const hash = await first<{ payload_hash: string; event_id: string }>(
      db,
      "SELECT payload_hash,event_id FROM event_attendance_import_reviews WHERE id=?",
      [input.reviewId],
    );
    if (
      prior.actorUserId !== actorId ||
      prior.reviewId !== input.reviewId ||
      hash?.event_id !== eventId ||
      hash?.payload_hash !== input.payloadHash
    )
      throw new AppError(
        409,
        "ATTENDANCE_IMPORT_OPERATION_CONFLICT",
        "This operation was used for different evidence.",
      );
    return attendanceImportReceiptSchema.parse(prior);
  }
  const review = await first<{
    payload_json: string;
    actor_user_id: string;
    payload_hash: string;
    expires_at: string;
    applied_at: string | null;
    capture_context_json: string | null;
    capture_context_hash: string | null;
  }>(
    db,
    "SELECT payload_json,actor_user_id,payload_hash,expires_at,applied_at,capture_context_json,capture_context_hash FROM event_attendance_import_reviews WHERE id=? AND event_id=?",
    [input.reviewId, eventId],
  );
  const receivedAt = nowIso();
  if (
    !review ||
    review.actor_user_id !== actorId ||
    review.payload_hash !== input.payloadHash ||
    !review.capture_context_json ||
    !review.capture_context_hash ||
    review.applied_at ||
    review.expires_at <= receivedAt
  )
    throw new AppError(409, "ATTENDANCE_IMPORT_REVIEW_CHANGED", "Review the evidence again before importing.");
  const payload = attendanceImportRequestSchema.parse(JSON.parse(review.payload_json));
  const captureContext = attendanceImportContextSchema.parse(JSON.parse(review.capture_context_json!));
  if (
    (await hashPayload(captureContext)) !== review.capture_context_hash ||
    (await hashPayload({ input: payload, captureContext })) !== review.payload_hash
  )
    throw new AppError(409, "ATTENDANCE_IMPORT_REVIEW_CHANGED", "Review context changed; review the evidence again.");
  const contextEvidence = importContextEvidence(eventId, captureContext),
    rowsEvidence = importRowsEvidence(eventId, payload.rows, captureContext, receivedAt);
  const id = crypto.randomUUID(),
    guardId = crypto.randomUUID();
  const evidence = `EXISTS(SELECT 1 FROM event_attendance_import_reviews WHERE id=? AND event_id=? AND actor_user_id=? AND payload_hash=? AND capture_context_hash=? AND capture_context_json=? AND applied_at IS NULL AND expires_at>?) AND EXISTS(${contextEvidence.sql}) AND EXISTS(${rowsEvidence.sql})`;
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO event_attendance_import_guards(id,valid) SELECT ?,CASE WHEN ${evidence} THEN 1 ELSE 0 END`,
        )
        .bind(
          guardId,
          input.reviewId,
          eventId,
          actorId,
          input.payloadHash,
          review.capture_context_hash,
          review.capture_context_json,
          receivedAt,
          ...contextEvidence.bindings,
          ...rowsEvidence.bindings,
        ),
      db
        .prepare(
          "INSERT INTO event_attendance_imports(id,event_id,operation_id,review_id,reviewer_user_id,actor_user_id,source,source_reference,row_count,received_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          eventId,
          input.operationId,
          input.reviewId,
          actorId,
          actorId,
          payload.source,
          payload.sourceReference,
          payload.rows.length,
          receivedAt,
        ),
      ...payload.rows.flatMap((row) => {
        const observationId = crypto.randomUUID();
        const capture = captureAttendanceContext(row.observedAt, {
          timeZone: captureContext.timeZone,
          publicationRevision: captureContext.publicationRevision,
          source: "import_review",
        });
        return [
          db
            .prepare(
              "INSERT INTO event_attendance_observations(id,attempt_id,event_id,occurrence_id,user_id,attendance_mode,observed_at,capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source) VALUES(?,NULL,?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              observationId,
              eventId,
              row.occurrenceId,
              row.userId,
              row.attendanceMode,
              row.observedAt,
              capture.dayDate,
              capture.timeZone,
              capture.publicationRevision,
              capture.source,
            ),
          db
            .prepare(
              "INSERT INTO event_attendance_import_provenance(observation_id,import_id,event_id,source,source_reference,source_record_id,verification) VALUES(?,?,?,?,?,?,?)",
            )
            .bind(
              observationId,
              id,
              eventId,
              payload.source,
              payload.sourceReference,
              row.sourceRecordId,
              row.verification,
            ),
        ];
      }),
      db.prepare("UPDATE event_attendance_import_reviews SET applied_at=? WHERE id=?").bind(receivedAt, input.reviewId),
      prepareScopedAuditLog(
        db,
        { type: "event", id: eventId },
        "user",
        actorId,
        "agenda.attendance.imported",
        "attendance_import",
        id,
        { rowCount: payload.rows.length, source: payload.source, payloadHash: input.payloadHash },
      ),
      db.prepare("DELETE FROM event_attendance_import_guards WHERE id=?").bind(guardId),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("attendance_import_review_valid") || error.message.includes("UNIQUE constraint"))
    ) {
      if (await first(db, "SELECT 1 FROM event_attendance_imports WHERE operation_id=?", [input.operationId]))
        return applyAttendanceImport(db, eventId, actorId, input);
      throw new AppError(
        409,
        "ATTENDANCE_IMPORT_REVIEW_CHANGED",
        "Evidence changed or source records were already imported; review again.",
      );
    }
    throw error;
  }
  return attendanceImportReceiptSchema.parse({
    id,
    operationId: input.operationId,
    reviewerUserId: actorId,
    actorUserId: actorId,
    source: payload.source,
    sourceReference: payload.sourceReference,
    rowCount: payload.rows.length,
    receivedAt,
  });
}
export async function attendanceImports(db: DatabaseLike, eventId: string, raw: unknown) {
  const query = attendanceImportsQuerySchema.parse(raw);
  const count = await first<{ total: number }>(
    db,
    "SELECT COUNT(*) AS total FROM event_attendance_imports WHERE event_id=?",
    [eventId],
  );
  const imports = await all(
    db,
    `SELECT ${receiptProjection} FROM event_attendance_imports WHERE event_id=? ORDER BY received_at ${query.sort === "receivedAt" ? "ASC" : "DESC"},id LIMIT ? OFFSET ?`,
    [eventId, query.limit, query.offset],
  );
  return attendanceImportsResponseSchema.parse({
    imports,
    page: buildPageInfo(query.limit, query.offset, count?.total ?? 0, imports.length),
  });
}
