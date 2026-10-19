import { publishedSessionsSql } from "./published-schedule";
import {
  EVIDENCE_PURGE_TABLES,
  evidencePurgeCountsSchema,
} from "../../../../assets/shared/schemas/event-evidence-purge";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
/** Trusted table metadata; no SQL identifiers come from request data. Row IDs are transient, never receipts. */
export function purgeSource(table: (typeof EVIDENCE_PURGE_TABLES)[number]) {
  const eventExpression =
    table === "event_attendance_correction_state"
      ? "(SELECT event_id FROM event_attendance_observations WHERE id=source.observation_id)"
      : [
            "event_offline_admission_access",
            "event_offline_admission_entitlements",
            "event_offline_admission_spends",
          ].includes(table)
        ? "(SELECT event_id FROM event_offline_admission_grants WHERE id=source.grant_id)"
        : table === "event_scanner_upload_receipts"
          ? "(SELECT event_id FROM event_scanner_device_sessions WHERE id=source.epoch_id)"
          : "source.event_id";
  return { table, eventExpression };
}
export async function rawEvidenceCounts(db: DatabaseLike, eventId: string) {
  const row = await first<{ counts: string }>(
    db,
    `SELECT json_object(${EVIDENCE_PURGE_TABLES.map((table) => {
      const source = purgeSource(table);
      return `'${table}',(SELECT COUNT(*) FROM ${table} source WHERE ${source.eventExpression}=?)`;
    }).join(",")}) AS counts`,
    EVIDENCE_PURGE_TABLES.map(() => eventId),
  );
  return evidencePurgeCountsSchema.parse(JSON.parse(row!.counts));
}
/** Four distinct intersections, each with whole-scope/all-mode unique populations. Missing captured days remain in all-day scopes. */
export async function nextPurgeScope(db: DatabaseLike, eventId: string, after: string | null) {
  return first<{
    scopeKey: string;
    dayDate: string | null;
    occurrenceId: string | null;
    attendanceMode: "physical" | "virtual" | null;
  }>(
    db,
    `WITH sources AS (
    SELECT occurrence_id,capture_day_date AS day_date FROM event_attendance_observations WHERE event_id=?
    UNION SELECT occurrence_id,capture_day_date FROM event_scan_attempts WHERE event_id=?
    UNION SELECT occurrence_id,day_date FROM event_offline_admission_grants WHERE event_id=?
    UNION SELECT published.id,NULL FROM (${publishedSessionsSql}) published WHERE published.event_id=?
  ), scopes AS (
    SELECT NULL AS occurrence_id,NULL AS day_date
    UNION SELECT occurrence_id,NULL FROM sources
    UNION SELECT NULL,day_date FROM sources WHERE day_date IS NOT NULL
    UNION SELECT occurrence_id,day_date FROM sources WHERE day_date IS NOT NULL
  ), modes(mode) AS (SELECT NULL UNION SELECT 'physical' UNION SELECT 'virtual'), keyed AS (
    SELECT json_array(scopes.day_date,scopes.occurrence_id,modes.mode) AS scopeKey,scopes.day_date AS dayDate,scopes.occurrence_id AS occurrenceId,modes.mode AS attendanceMode FROM scopes CROSS JOIN modes
  ) SELECT scopeKey,dayDate,occurrenceId,attendanceMode FROM keyed WHERE (? IS NULL OR scopeKey>?) ORDER BY scopeKey LIMIT 1`,
    [eventId, eventId, eventId, eventId, after, after],
  );
}
