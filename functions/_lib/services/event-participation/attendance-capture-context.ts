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
import type { DatabaseLike } from "../../types";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import { z } from "zod";

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
async function publishedContext(db: DatabaseLike, eventId: string, revision: number) {
  const publication = await first<{ time_zone: string }>(
    db,
    "SELECT json_extract(snapshot_json,'$.timeZone') AS time_zone FROM event_agenda_publications WHERE event_id=? AND revision=?",
    [eventId, revision],
  );
  if (!publication)
    throw new AppError(
      409,
      "ATTENDANCE_CAPTURE_CONTEXT_UNAVAILABLE",
      "Refresh the event context before scanning again.",
    );
  return publication;
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
async function readCurrentContext(db: DatabaseLike, eventId: string): Promise<CurrentContext> {
  const current = await first<CurrentContext>(
    db,
    "SELECT capture_event.timezone AS event_time_zone,capture_state.published_revision AS publication_revision,json_extract(capture_publication.snapshot_json,'$.timeZone') AS publication_time_zone FROM events capture_event LEFT JOIN event_agenda_state capture_state ON capture_state.event_id=capture_event.id LEFT JOIN event_agenda_publications capture_publication ON capture_publication.event_id=capture_event.id AND capture_publication.revision=capture_state.published_revision WHERE capture_event.id=?",
    [eventId],
  );
  if (!current) throw new AppError(404, "EVENT_NOT_FOUND", "Event unavailable.");
  return current;
}
function currentContextEvidence(eventId: string, current: CurrentContext): AuthorizationEvidence {
  return {
    sql: "SELECT 1 FROM events capture_event LEFT JOIN event_agenda_state capture_state ON capture_state.event_id=capture_event.id LEFT JOIN event_agenda_publications capture_publication ON capture_publication.event_id=capture_event.id AND capture_publication.revision=capture_state.published_revision WHERE capture_event.id=? AND capture_state.published_revision IS ? AND capture_event.timezone=? AND (capture_state.published_revision IS NULL OR json_extract(capture_publication.snapshot_json,'$.timeZone')=?)",
    bindings: [eventId, current.publication_revision, current.event_time_zone, current.publication_time_zone],
  };
}
/** Current policy fence for ordinary admission, independent of a historical capture revision. */
export async function currentOperationalContextEvidence(
  db: DatabaseLike,
  eventId: string,
): Promise<AuthorizationEvidence> {
  return currentContextEvidence(eventId, await readCurrentContext(db, eventId));
}
/** Resolve a frozen original context. The caller owns recognized-failure persistence and atomic command behavior. */
export async function resolveAttendanceCapture(
  db: DatabaseLike,
  eventId: string,
  raw: ResolveCaptureInput,
): Promise<ResolvedAttendanceCapture> {
  const input = resolveAttendanceCaptureInputSchema.parse(raw);
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
    const grant = await first<{ published_revision: number | null; day_date: string }>(
      db,
      "SELECT published_revision,day_date FROM event_offline_admission_grants WHERE id=? AND event_id=? AND operator_user_id=? AND device_id=? AND occurrence_id IS ?",
      [input.offlineRight.grantId, eventId, input.operatorUserId, input.deviceId, input.occurrenceId],
    );
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
    const publication = await publishedContext(db, eventId, grant.published_revision);
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
    const publication = await publishedContext(db, eventId, revision);
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
  const current = await readCurrentContext(db, eventId);
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
