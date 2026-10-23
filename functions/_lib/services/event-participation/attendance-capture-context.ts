import {
  captureAttendanceContext,
  attendanceCaptureRequestFieldsSchema,
  type CapturedAttendanceContext,
  type AttendanceCaptureContext,
  refineAttendanceCaptureIntent,
} from "../../../../assets/shared/schemas/event-attendance-capture";
import { utcInstantSchema } from "../../../../assets/shared/schemas/api-common";
import { databaseIdSchema } from "../../../../assets/shared/schemas/identifiers";
import { offlineAdmissionRightSchema } from "../../../../assets/shared/schemas/event-offline-rights";
import type { DatabaseLike, D1StatementResult, StatementLike } from "../../types";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import { z } from "zod";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";

/** Internal resolver input composes canonical request fields, rather than inventing a second HTTP shape. */
export const resolveAttendanceCaptureInputSchema = z
  .object({
    observedAt: utcInstantSchema,
    operatorUserId: databaseIdSchema,
    deviceId: databaseIdSchema,
    occurrenceId: databaseIdSchema.nullable(),
    roomId: databaseIdSchema.nullable().optional(),
    offlineRight: offlineAdmissionRightSchema.optional(),
    ...attendanceCaptureRequestFieldsSchema.shape,
  })
  .strict()
  .superRefine(refineAttendanceCaptureIntent);
export type ResolveCaptureInput = z.infer<typeof resolveAttendanceCaptureInputSchema>;
type CurrentContext = {
  event_time_zone: string;
  publication_revision: number | null;
  publication_time_zone: string | null;
};
export interface ResolvedAttendanceCapture {
  context: AttendanceCaptureContext;
  /** Frozen context equality only. This is NOT badge, admission, grant validity or operator authorization. */
  contextEvidence: AuthorizationEvidence;
  admissionDayDate: string | null;
}
function requirePublication(publication: { time_zone: string | null } | null): { time_zone: string } {
  if (!publication || publication.time_zone === null)
    throw new AppError(
      409,
      "ATTENDANCE_CAPTURE_CONTEXT_UNAVAILABLE",
      "Refresh the event context before scanning again.",
    );
  return { time_zone: publication.time_zone };
}
function capture(
  observedAt: string,
  timeZone: string,
  publicationRevision: number | null,
  source: CapturedAttendanceContext["source"],
) {
  try {
    return captureAttendanceContext(observedAt, { timeZone, publicationRevision, source });
  } catch {
    throw new AppError(
      422,
      "ATTENDANCE_CAPTURE_CONTEXT_INVALID",
      "The event capture context has an invalid timezone or date.",
    );
  }
}
function prepareCurrentContext(db: DatabaseLike, event: EventReadSelection) {
  const scope = eventReadIdSql(event);
  return db
    .prepare(
      `SELECT capture_event.timezone AS event_time_zone,capture_state.published_revision AS publication_revision,json_extract(capture_publication.snapshot_json,'$.timeZone') AS publication_time_zone FROM events capture_event LEFT JOIN event_agenda_state capture_state ON capture_state.event_id=capture_event.id LEFT JOIN event_agenda_publications capture_publication ON capture_publication.event_id=capture_event.id AND capture_publication.revision=capture_state.published_revision WHERE capture_event.id=${scope.sql}`,
    )
    .bind(...scope.bindings);
}
function requireCurrentContext(current: CurrentContext | null): CurrentContext {
  if (!current) throw new AppError(404, "EVENT_NOT_FOUND", "Event unavailable.");
  return current;
}
function currentContextEvidence(eventId: string, current: CurrentContext): AuthorizationEvidence {
  return {
    sql: "SELECT 1 FROM events capture_event LEFT JOIN event_agenda_state capture_state ON capture_state.event_id=capture_event.id LEFT JOIN event_agenda_publications capture_publication ON capture_publication.event_id=capture_event.id AND capture_publication.revision=capture_state.published_revision WHERE capture_event.id=? AND capture_state.published_revision IS ? AND capture_event.timezone=? AND (capture_state.published_revision IS NULL OR json_extract(capture_publication.snapshot_json,'$.timeZone')=?)",
    bindings: [eventId, current.publication_revision, current.event_time_zone, current.publication_time_zone],
  };
}
/** Prepare current policy and historical capture together, without inferring historical data from current settings. */
export function prepareAttendanceCapture(
  db: DatabaseLike,
  event: EventReadSelection,
  raw: ResolveCaptureInput,
  includeOperational = false,
) {
  const scope = eventReadIdSql(event);
  const input = resolveAttendanceCaptureInputSchema.parse(raw);
  const statements: StatementLike[] = [];
  const needsCurrent =
    includeOperational ||
    (!input.nativeEventContext && !input.offlineRight && input.capturePublicationRevision === undefined);
  const currentIndex = needsCurrent ? statements.push(prepareCurrentContext(db, event)) - 1 : -1;
  let historyIndex = -1;
  if (!input.nativeEventContext && input.offlineRight) {
    historyIndex =
      statements.push(
        db
          .prepare(
            `SELECT grant_row.published_revision,grant_row.day_date,json_extract(publication.snapshot_json,'$.timeZone') AS time_zone FROM event_offline_admission_grants grant_row LEFT JOIN event_agenda_publications publication ON publication.event_id=grant_row.event_id AND publication.revision=grant_row.published_revision WHERE grant_row.id=? AND grant_row.event_id=${scope.sql} AND grant_row.operator_user_id=? AND grant_row.device_id=? AND grant_row.occurrence_id IS ?`,
          )
          .bind(
            input.offlineRight.grantId,
            ...scope.bindings,
            input.operatorUserId,
            input.deviceId,
            input.occurrenceId,
          ),
      ) - 1;
  } else if (!input.nativeEventContext && typeof input.capturePublicationRevision === "number") {
    historyIndex =
      statements.push(
        db
          .prepare(
            `SELECT json_extract(snapshot_json,'$.timeZone') AS time_zone FROM event_agenda_publications WHERE event_id=${scope.sql} AND revision=?`,
          )
          .bind(...scope.bindings, input.capturePublicationRevision),
      ) - 1;
  }
  return {
    statements,
    decode(results: D1StatementResult[], canonicalEventId?: string) {
      const eventId = typeof event === "string" ? event : canonicalEventId;
      if (!eventId) throw new Error("Capture decoding requires the resolved event ID");
      const current =
        currentIndex < 0 ? null : requireCurrentContext(batchFirst<CurrentContext>(results[currentIndex]));
      const resolved = decodeAttendanceCapture(
        input,
        eventId,
        current,
        historyIndex < 0 ? null : results[historyIndex],
      );
      return {
        resolved,
        operational: includeOperational ? currentContextEvidence(eventId, requireCurrentContext(current)) : null,
      };
    },
  };
}

/** Resolve a frozen original context. The caller owns recognized-failure persistence and atomic command behavior. */
export async function resolveAttendanceCapture(
  db: DatabaseLike,
  eventId: string,
  raw: ResolveCaptureInput,
): Promise<ResolvedAttendanceCapture> {
  const read = prepareAttendanceCapture(db, eventId, raw);
  return read.decode(read.statements.length ? await db.batch(read.statements) : []).resolved;
}

function decodeAttendanceCapture(
  input: ResolveCaptureInput,
  eventId: string,
  currentRead: CurrentContext | null,
  history: D1StatementResult | null,
): ResolvedAttendanceCapture {
  if (input.nativeEventContext) {
    const native = input.nativeEventContext;
    // Preserve the submitted calendar provenance even when its live policy is stale.
    // Only the same-batch evidence below can make this attempt eligible.
    return {
      context: capture(input.observedAt, native.timeZone, null, "native_event_manifest"),
      contextEvidence: {
        sql: "SELECT 1 FROM events capture_event LEFT JOIN event_agenda_state capture_state ON capture_state.event_id=capture_event.id WHERE capture_event.id=? AND capture_event.profile_key=? AND capture_event.timezone=? AND capture_state.published_revision IS NULL",
        bindings: [eventId, native.profileKey, native.timeZone],
      },
      admissionDayDate: null,
    };
  }
  if (input.offlineRight) {
    const grant = history
      ? batchFirst<{ published_revision: number | null; day_date: string; time_zone: string | null }>(history)
      : null;
    if (!grant)
      throw new AppError(409, "ATTENDANCE_CAPTURE_CONTEXT_UNAVAILABLE", "The prepared grant context is unavailable.");
    if (input.capturePublicationRevision !== undefined && input.capturePublicationRevision !== grant.published_revision)
      throw new AppError(
        409,
        "ATTENDANCE_CAPTURE_CONTEXT_MISMATCH",
        "The badge operation and its prepared grant use different context revisions.",
      );
    if (grant.published_revision === null)
      return {
        context: { state: "missing", reason: "not_captured" },
        contextEvidence: {
          sql: "SELECT 1 FROM event_offline_admission_grants capture_grant WHERE capture_grant.id=? AND capture_grant.event_id=? AND capture_grant.operator_user_id=? AND capture_grant.device_id=? AND capture_grant.occurrence_id IS ? AND capture_grant.published_revision IS NULL",
          bindings: [input.offlineRight.grantId, eventId, input.operatorUserId, input.deviceId, input.occurrenceId],
        },
        admissionDayDate: grant.day_date,
      };
    const publication = requirePublication(grant);
    return {
      context: capture(input.observedAt, publication.time_zone, grant.published_revision, "offline_grant"),
      contextEvidence: {
        sql: "SELECT 1 FROM event_offline_admission_grants capture_grant JOIN event_agenda_publications capture_publication ON capture_publication.event_id=capture_grant.event_id AND capture_publication.revision=capture_grant.published_revision WHERE capture_grant.id=? AND capture_grant.event_id=? AND capture_grant.operator_user_id=? AND capture_grant.device_id=? AND capture_grant.occurrence_id IS ? AND capture_grant.published_revision=? AND json_extract(capture_publication.snapshot_json,'$.timeZone')=?",
        bindings: [
          input.offlineRight.grantId,
          eventId,
          input.operatorUserId,
          input.deviceId,
          input.occurrenceId,
          grant.published_revision,
          publication.time_zone,
        ],
      },
      admissionDayDate: grant.day_date,
    };
  }
  if (typeof input.capturePublicationRevision === "number") {
    const revision = input.capturePublicationRevision;
    const publication = requirePublication(history ? batchFirst<{ time_zone: string | null }>(history) : null);
    return {
      context: capture(input.observedAt, publication.time_zone, revision, "published_manifest"),
      contextEvidence: {
        sql: "SELECT 1 FROM event_agenda_publications capture_publication WHERE event_id=? AND revision=? AND json_extract(snapshot_json,'$.timeZone')=?",
        bindings: [eventId, revision, publication.time_zone],
      },
      admissionDayDate: null,
    };
  }
  if (input.capturePublicationRevision === null)
    return {
      context: { state: "missing", reason: "not_captured" },
      contextEvidence: {
        sql: "SELECT 1 FROM events capture_event LEFT JOIN event_agenda_state capture_state ON capture_state.event_id=capture_event.id WHERE capture_event.id=? AND capture_state.published_revision IS NULL",
        bindings: [eventId],
      },
      admissionDayDate: null,
    };
  const current = requireCurrentContext(currentRead);
  if (current.publication_revision !== null && current.publication_time_zone === null)
    throw new AppError(
      409,
      "ATTENDANCE_CAPTURE_CONTEXT_UNAVAILABLE",
      "The published context is unavailable; do not infer a historical timezone from current event settings.",
    );
  const timeZone = current.publication_time_zone ?? current.event_time_zone;
  return {
    context: capture(input.observedAt, timeZone, current.publication_revision, "server_receipt"),
    contextEvidence: currentContextEvidence(eventId, current),
    admissionDayDate: null,
  };
}
