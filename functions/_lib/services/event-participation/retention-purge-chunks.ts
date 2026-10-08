import {
  EVIDENCE_PURGE_TABLES,
  evidencePurgeChunkResponseSchema,
  type EvidencePurgeChunkCreate,
  type EvidencePurgePhase,
} from "../../../../assets/shared/schemas/event-evidence-purge";
import { scannerReconciliationSchema } from "../../../../assets/shared/schemas/event-scanner-reconciliation";
import { attendanceScopeQuerySchema } from "../../../../assets/shared/schemas/event-attendance-reporting";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first, all } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { commitPurge, requirePurgeAuthority, purgeContextGuard } from "./retention-purge-review";
import { readPurgeRun } from "./retention-purge-runs";
import { nextPurgeScope, purgeSource, rawEvidenceCounts } from "./retention-purge-source";
import { materializeEventAttendanceSummary } from "./attendance-summary";
import { attendanceReportContext, attendanceScopeSql, attendanceScopeBindings } from "./attendance-report-context";
const RAW_ROWS_PER_CHUNK = 100;
interface Receipt {
  run_id: string;
  ordinal: number;
  operation_id: string;
  actor_user_id: string;
  phase: string;
  source_generation_before: number;
  source_generation_after: number;
  row_count: number;
  committed_at: string;
}
const receiptColumns =
  "run_id,ordinal,operation_id,actor_user_id,phase,source_generation_before,source_generation_after,row_count,committed_at";
function receiptResponse(row: Receipt) {
  return evidencePurgeChunkResponseSchema.parse({
    success: true,
    runId: row.run_id,
    ordinal: row.ordinal,
    phase: row.phase,
    sourceGenerationBefore: row.source_generation_before,
    sourceGenerationAfter: row.source_generation_after,
    rowCount: row.row_count,
    committedAt: row.committed_at,
  });
}
export async function commitEvidencePurgeChunk(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  eventId: string,
  runId: string,
  input: EvidencePurgeChunkCreate,
) {
  requirePurgeAuthority(actor, eventId, true);
  const run = await readPurgeRun(db, actor, eventId, runId);
  const prior = await first<Receipt>(
    db,
    `SELECT ${receiptColumns} FROM event_evidence_retention_chunks WHERE operation_id=?`,
    [input.operationId],
  );
  if (prior) {
    if (prior.run_id !== runId || prior.actor_user_id !== actor.id || prior.ordinal !== input.expectedOrdinal + 1)
      throw new AppError(409, "EVIDENCE_CHUNK_OPERATION_CONFLICT", "Step operation belongs to another request.");
    await commitPurge(db, actor, eventId, []);
    return receiptResponse(prior);
  }
  if (run.status !== "running" || run.ordinal !== input.expectedOrdinal)
    throw new AppError(409, "EVIDENCE_CHUNK_REVISION_CHANGED", "The removal run advanced. Reload its progress.");
  const committedAt = nowIso(),
    ordinal = run.ordinal + 1;
  const statements: StatementLike[] = [
    purgeContextGuard(
      db,
      eventId,
      run.policy_revision,
      run.expected_generation,
      run.publication_revision,
      run.time_zone,
      runId,
    ),
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM event_evidence_retention_runs WHERE id=? AND event_id=? AND status='running' AND ordinal=? AND expected_generation=? AND phase=?",
      bindings: [runId, eventId, run.ordinal, run.expected_generation, run.phase],
    }),
  ];
  let nextPhase = run.phase as EvidencePurgePhase,
    rowCount = 0,
    cursor: string | null = null;
  if (run.phase === "aggregates") {
    const progress = await first<{ cursor_key: string | null }>(
      db,
      "SELECT cursor_key FROM event_evidence_retention_progress WHERE run_id=?",
      [runId],
    );
    const scope = await nextPurgeScope(db, eventId, progress?.cursor_key ?? null);
    if (scope) {
      const query = attendanceScopeQuerySchema.parse({
        ...(scope.dayDate ? { dayDate: scope.dayDate } : {}),
        ...(scope.occurrenceId ? { occurrenceId: scope.occurrenceId } : {}),
        ...(scope.attendanceMode ? { attendanceMode: scope.attendanceMode } : {}),
      });
      const summary = await materializeEventAttendanceSummary(db, eventId, query),
        reconciliation = scannerReconciliationSchema.parse(JSON.parse(run.reconciliation_json));
      summary.sync.scannerReconciliation = reconciliation;
      summary.sync.deviceBacklog = reconciliation.deviceBacklog;
      statements.push(
        db
          .prepare("INSERT INTO event_evidence_retention_grains(run_id,scope_key,summary_json) VALUES(?,?,?)")
          .bind(runId, scope.scopeKey, JSON.stringify(summary)),
      );
      const context = await attendanceReportContext(db, eventId, query);
      statements.push(
        db
          .prepare(
            `INSERT INTO event_evidence_retention_reasons(run_id,scope_key,action,outcome,reason,count)
        SELECT ?,?,a.action,a.outcome,a.reason,COUNT(*) FROM event_scan_attempts a WHERE ${attendanceScopeSql("a", context)} AND a.user_id IS NOT NULL AND a.action<>'lead' AND (? IS NULL OR ?='physical') GROUP BY a.action,a.outcome,a.reason`,
          )
          .bind(
            runId,
            scope.scopeKey,
            ...attendanceScopeBindings(context),
            context.attendanceMode,
            context.attendanceMode,
          ),
      );
      statements.push(
        db
          .prepare(
            `INSERT INTO event_evidence_retention_reasons(run_id,scope_key,action,outcome,reason,count)
        SELECT ?,?,a.action,a.outcome,a.reason,COUNT(*) FROM event_scan_attempts a WHERE ${attendanceScopeSql("a", context)} AND (? IS NULL OR ?='physical') GROUP BY a.action,a.outcome,a.reason`,
          )
          .bind(
            runId,
            scope.scopeKey + ":all_scans",
            ...attendanceScopeBindings(context),
            context.attendanceMode,
            context.attendanceMode,
          ),
      );
      if (scope.dayDate === null && scope.occurrenceId === null && scope.attendanceMode === null)
        statements.push(
          db
            .prepare(
              "INSERT INTO event_evidence_retention_sponsors(run_id,sponsor_id,lead_count) SELECT ?,sponsor_id,COUNT(*) FROM event_sponsor_leads WHERE event_id=? GROUP BY sponsor_id",
            )
            .bind(runId, eventId),
        );
      cursor = scope.scopeKey;
      rowCount = 1;
    } else nextPhase = EVIDENCE_PURGE_TABLES[0];
  } else if (run.phase === "complete") {
    const counts = await rawEvidenceCounts(db, eventId);
    if (Object.values(counts).some((count) => count !== 0))
      throw new AppError(409, "EVIDENCE_PURGE_REMAINS", "Raw evidence remains. The removal run cannot be completed.");
    statements.push(
      db
        .prepare(
          "UPDATE event_evidence_retention_state SET purged_at=?,active_run_id=NULL WHERE event_id=? AND active_run_id=?",
        )
        .bind(committedAt, eventId, runId),
    );
    statements.push(db.prepare("DELETE FROM event_evidence_retention_progress WHERE run_id=?").bind(runId));
  } else {
    const phase = EVIDENCE_PURGE_TABLES.find((table) => table === run.phase);
    if (!phase) throw new AppError(500, "EVIDENCE_PURGE_PHASE_INVALID", "Removal run phase is invalid.");
    const source = purgeSource(phase);
    const rows = await all<{ rowId: number }>(
      db,
      `SELECT source.rowid AS rowId FROM ${phase} source WHERE ${source.eventExpression}=? ORDER BY source.rowid LIMIT ?`,
      [eventId, RAW_ROWS_PER_CHUNK],
    );
    rowCount = rows.length;
    if (rowCount) {
      statements.push(
        db
          .prepare(
            "INSERT INTO event_evidence_retention_delete_permits(event_id,run_id,chunk_operation_id,table_name,row_id) SELECT ?,?,?,?,CAST(value AS INTEGER) FROM json_each(?)",
          )
          .bind(eventId, runId, input.operationId, phase, JSON.stringify(rows.map((row) => row.rowId))),
      );
      statements.push(
        db
          .prepare(
            `DELETE FROM ${phase} AS source WHERE ${source.eventExpression}=? AND source.rowid IN(SELECT permit.row_id FROM event_evidence_retention_delete_permits permit WHERE permit.run_id=? AND permit.chunk_operation_id=? AND permit.table_name=?)`,
          )
          .bind(eventId, runId, input.operationId, phase),
      );
    }
    if (rowCount < RAW_ROWS_PER_CHUNK)
      nextPhase = EVIDENCE_PURGE_TABLES[EVIDENCE_PURGE_TABLES.indexOf(phase) + 1] ?? "complete";
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO event_evidence_retention_chunks(${receiptColumns}) SELECT ?,?,?,?,?,?,generation,?,? FROM event_evidence_retention_state WHERE event_id=?`,
      )
      .bind(
        runId,
        ordinal,
        input.operationId,
        actor.id,
        run.phase,
        run.expected_generation,
        rowCount,
        committedAt,
        eventId,
      ),
  );
  statements.push(
    db
      .prepare("DELETE FROM event_evidence_retention_delete_permits WHERE run_id=? AND chunk_operation_id=?")
      .bind(runId, input.operationId),
  );
  statements.push(
    db
      .prepare(
        "UPDATE event_evidence_retention_runs SET ordinal=?,expected_generation=(SELECT generation FROM event_evidence_retention_state WHERE event_id=?),phase=?,status=?,completed_at=? WHERE id=? AND ordinal=?",
      )
      .bind(
        ordinal,
        eventId,
        nextPhase,
        run.phase === "complete" ? "complete" : "running",
        run.phase === "complete" ? committedAt : null,
        runId,
        run.ordinal,
      ),
  );
  if (run.phase !== "complete")
    statements.push(
      db
        .prepare("UPDATE event_evidence_retention_progress SET cursor_key=?,updated_at=? WHERE run_id=?")
        .bind(cursor, committedAt, runId),
    );
  statements.push(
    prepareAuditLog(
      db,
      "user",
      actor.id,
      run.phase === "complete" ? "event_evidence_removal_completed" : "event_evidence_removal_step",
      "event",
      eventId,
      { runId, ordinal, phase: run.phase, rowCount },
      committedAt,
    ),
  );
  try {
    await commitPurge(db, actor, eventId, statements);
  } catch (error) {
    const committed = await first(db, "SELECT 1 FROM event_evidence_retention_chunks WHERE operation_id=?", [
      input.operationId,
    ]);
    if (committed) return commitEvidencePurgeChunk(db, actor, eventId, runId, input);
    throw error;
  }
  const receipt = await first<Receipt>(
    db,
    `SELECT ${receiptColumns} FROM event_evidence_retention_chunks WHERE operation_id=?`,
    [input.operationId],
  );
  return receiptResponse(receipt!);
}
