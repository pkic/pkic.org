import { operationalAllocationCompatibleSql } from "./session-allocation";
import { resolvePhysicalSessionRoom } from "./session-room";
import { offlineEligibilityExpiresAt } from "../../../../assets/shared/event-offline-expiry";
import {
  offlineEligibilityResponseSchema,
  type OfflineEligibilityQuery,
} from "../../../../assets/shared/schemas/event-offline-eligibility";
import type { DatabaseLike, D1StatementResult } from "../../types";
import { AppError } from "../../errors";
import { batchFirst, batchRows } from "../../db/pagination";
import { nowIso } from "../../utils/time";
import { publishedSessionsSql } from "./published-schedule";
import { nativeEventCaptureApplies } from "../../../../assets/shared/native-event-capture";
import { nativeEventCaptureContextSchema } from "../../../../assets/shared/schemas/event-attendance-capture";
import {
  registrationSessionDayOptionsSql,
  registrationSessionAttendance,
  sessionAccessEligibleSql,
} from "./session-access";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";

interface ManifestState {
  id: string;
  revision: number;
  published_revision: number | null;
  timezone: string;
  profile_key: string | null;
}
interface ManifestSession {
  admission_policy: string;
  visibility: string;
  start_at: string | null;
  timezone: string;
  room_id: string | null;
  additional_room_ids_json: string;
}
interface ManifestEntry {
  badgeId: string;
  userId: string;
  credentialHash: string;
  revoked: number;
  expiresAt: string | null;
  eventRegistered: number;
  registered: number;
  registration_default_mode: string | null;
  registration_days_json: string | null;
  allocationCompatible: number;
  privateAccess: number;
  entryEligible: number;
  sessionStatus: string | null;
}

/** Dated eligibility evidence only; this manifest never allocates admission. */
export async function offlineEligibility(
  db: DatabaseLike,
  eventId: string,
  operatorUserId: string,
  query: OfflineEligibilityQuery,
) {
  const read = prepareOfflineEligibility(db, eventId, query);
  return read.decode(await db.batch(read.statements), operatorUserId);
}

/** The schedule, destination and bounded badge page share one transaction snapshot. */
export function prepareOfflineEligibility(db: DatabaseLike, event: EventReadSelection, query: OfflineEligibilityQuery) {
  const scope = eventReadIdSql(event);
  const serverNow = nowIso();
  return {
    statements: [
      db
        .prepare(`SELECT e.id,COALESCE(s.revision,0) AS revision,s.published_revision,e.profile_key,
        COALESCE(json_extract(p.snapshot_json,'$.timeZone'),e.timezone) AS timezone
        FROM events e LEFT JOIN event_agenda_state s ON s.event_id=e.id
        LEFT JOIN event_agenda_publications p ON p.event_id=e.id AND p.revision=s.published_revision
        WHERE e.id=${scope.sql}`)
        .bind(...scope.bindings),
      db
        .prepare(`SELECT admission_policy,visibility,start_at,timezone,room_id,additional_room_ids_json
        FROM (${publishedSessionsSql}) WHERE event_id=${scope.sql} AND id=?`)
        .bind(...scope.bindings, query.occurrenceId ?? null),
      db
        .prepare(`WITH manifest_event AS(SELECT ${scope.sql} AS id),
        target AS(SELECT ? AS occurrence_id,COALESCE(?,s.room_id) AS room_id,COALESCE(s.start_at,?) AS start_at
          FROM manifest_event event LEFT JOIN (${publishedSessionsSql}) s ON s.event_id=event.id AND s.id=?)
        SELECT b.id AS badgeId,b.user_id AS userId,b.credential_hash AS credentialHash,
          b.revoked_at IS NOT NULL AS revoked,b.expires_at AS expiresAt,COALESCE(r.status='registered',0) AS eventRegistered,
          r.id IS NOT NULL AS registered,r.attendance_type AS registration_default_mode,
          ${registrationSessionDayOptionsSql("r", "target")} AS registration_days_json,
          ${operationalAllocationCompatibleSql("target.occurrence_id", "b.user_id", "'physical'", "target.room_id")} AS allocationCompatible,
          (s.id IS NULL OR ${sessionAccessEligibleSql("s", "b.user_id", "'physical'", false)}) AS privateAccess,
          (s.id IS NULL OR ${sessionAccessEligibleSql("s", "b.user_id", "'physical'")}) AS entryEligible,p.status AS sessionStatus
        FROM event_badge_credentials b CROSS JOIN target
        LEFT JOIN registrations r ON r.event_id=b.event_id AND r.user_id=b.user_id
        LEFT JOIN agenda_session_participations p ON p.user_id=b.user_id AND p.occurrence_id=target.occurrence_id
        LEFT JOIN (${publishedSessionsSql}) s ON s.id=target.occurrence_id AND s.event_id=b.event_id
        WHERE b.event_id=(SELECT id FROM manifest_event) AND b.id>? ORDER BY b.id LIMIT 251`)
        .bind(
          ...scope.bindings,
          query.occurrenceId ?? null,
          query.roomId ?? null,
          serverNow,
          query.occurrenceId ?? null,
          query.afterBadgeId ?? "",
        ),
    ],
    decode(results: D1StatementResult[], operatorUserId: string) {
      const state = batchFirst<ManifestState>(results[0]);
      if (!state) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found.");
      if (query.publishedRevision !== undefined && query.publishedRevision !== state.published_revision)
        throw new AppError(409, "OFFLINE_MANIFEST_CHANGED", "The approved schedule changed. Refresh the manifest.");
      const session = query.occurrenceId ? batchFirst<ManifestSession>(results[1]) : null;
      if (query.occurrenceId && !session)
        throw new AppError(404, "SESSION_NOT_PUBLISHED", "Select an approved session.");
      // The SQL room expression only plans the read; this canonical policy decides whether to release it.
      const roomId = session ? resolvePhysicalSessionRoom(session, query.roomId) : null;
      const nativeEventContext = nativeEventCaptureApplies({
        profileKey: state.profile_key,
        publishedRevision: state.published_revision,
        occurrenceId: query.occurrenceId,
        roomId: query.roomId,
      })
        ? nativeEventCaptureContextSchema.parse({ profileKey: state.profile_key, timeZone: state.timezone })
        : undefined;
      if (!session && query.roomId)
        throw new AppError(400, "SESSION_ROOM_INVALID", "Choose a session before selecting its room.");
      const timeZone = session?.timezone ?? state.timezone;
      const rows = batchRows<ManifestEntry>(results[2]);
      return offlineEligibilityResponseSchema.parse({
        eventId: state.id,
        operatorUserId,
        occurrenceId: query.occurrenceId ?? null,
        roomId,
        revision: state.revision,
        publishedRevision: state.published_revision ?? null,
        ...(nativeEventContext ? { nativeEventContext } : {}),
        serverNow,
        expiresAt: offlineEligibilityExpiresAt(serverNow, timeZone),
        session: session ? { admissionPolicy: session.admission_policy, visibility: session.visibility } : null,
        entries: rows.slice(0, 250).map((row) => {
          const physicalDayEligible =
            registrationSessionAttendance({ ...row, startAt: session?.start_at ?? serverNow, timeZone }) ===
            "in_person";
          return {
            badgeId: row.badgeId,
            userId: row.userId,
            credentialHash: row.credentialHash,
            revoked: Boolean(row.revoked),
            expiresAt: row.expiresAt,
            eventRegistered: Boolean(row.eventRegistered),
            physicalDayEligible,
            sessionStatus: row.sessionStatus,
            allocationCompatible: Boolean(row.allocationCompatible),
            privateAccess: Boolean(row.privateAccess),
            sessionEligible:
              !row.revoked &&
              Boolean(row.eventRegistered) &&
              physicalDayEligible &&
              Boolean(row.allocationCompatible) &&
              Boolean(row.entryEligible),
          };
        }),
        nextBadgeId: rows.length > 250 ? rows[249]!.badgeId : null,
      });
    },
  };
}
