import { operationalAllocationCompatibleSql } from "./session-allocation";
import { resolvePhysicalSessionRoom } from "./session-room";
import { offlineEligibilityExpiresAt } from "../../../../assets/shared/event-offline-expiry";
import {
  offlineEligibilityResponseSchema,
  type OfflineEligibilityQuery,
} from "../../../../assets/shared/schemas/event-offline-eligibility";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { publishedSessionsSql } from "./published-schedule";
import { nativeEventCaptureApplies } from "../../../../assets/shared/native-event-capture";
import { nativeEventCaptureContextSchema } from "../../../../assets/shared/schemas/event-attendance-capture";
import { registrationDayAttendanceSql, sessionAccessEligibleSql } from "./session-access";

/** Dated eligibility evidence only; this manifest never allocates admission. */
export async function offlineEligibility(
  db: DatabaseLike,
  eventId: string,
  operatorUserId: string,
  query: OfflineEligibilityQuery,
) {
  const state = await db
    .prepare(
      "SELECT COALESCE(s.revision,0) AS revision,s.published_revision,e.profile_key,COALESCE(json_extract(p.snapshot_json,'$.timeZone'),e.timezone) AS timezone FROM events e LEFT JOIN event_agenda_state s ON s.event_id=e.id LEFT JOIN event_agenda_publications p ON p.event_id=e.id AND p.revision=s.published_revision WHERE e.id=?",
    )
    .bind(eventId)
    .first<{ revision: number; published_revision: number | null; timezone: string; profile_key: string | null }>();
  if (!state) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found.");
  if (query.publishedRevision !== undefined && query.publishedRevision !== state.published_revision)
    throw new AppError(409, "OFFLINE_MANIFEST_CHANGED", "The approved schedule changed. Refresh the manifest.");
  const session = query.occurrenceId
    ? await db
        .prepare(
          `SELECT admission_policy,visibility,start_at,timezone,room_id,additional_room_ids_json FROM (${publishedSessionsSql}) WHERE event_id=? AND id=?`,
        )
        .bind(eventId, query.occurrenceId)
        .first<{
          admission_policy: string;
          visibility: string;
          start_at: string | null;
          timezone: string;
          room_id: string | null;
          additional_room_ids_json: string;
        }>()
    : null;
  if (query.occurrenceId && !session) throw new AppError(404, "SESSION_NOT_PUBLISHED", "Select an approved session.");
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
  const serverNow = new Date().toISOString();
  const day = instantToDateTimeLocal(session?.start_at ?? serverNow, session?.timezone ?? state.timezone).slice(0, 10);
  const result = await db
    .prepare(
      `WITH target AS(SELECT ? AS occurrence_id,? AS room_id,? AS day_date) SELECT b.id AS badgeId,b.user_id AS userId,b.credential_hash AS credentialHash,
    b.revoked_at IS NOT NULL AS revoked,b.expires_at AS expiresAt,COALESCE(r.status='registered',0) AS eventRegistered,
    ${registrationDayAttendanceSql("r", "target.day_date")}='in_person' AS physicalDayEligible,
    ${operationalAllocationCompatibleSql("target.occurrence_id", "b.user_id", "'physical'", "target.room_id")} AS allocationCompatible,
    (s.id IS NULL OR ${sessionAccessEligibleSql("s", "b.user_id", "'physical'", "target.room_id", false)}) AS privateAccess,
    (s.id IS NULL OR ${sessionAccessEligibleSql("s", "b.user_id", "'physical'", "target.room_id")}) AS entryEligible,p.status AS sessionStatus
    FROM event_badge_credentials b CROSS JOIN target LEFT JOIN registrations r ON r.event_id=b.event_id AND r.user_id=b.user_id
    LEFT JOIN agenda_session_participations p ON p.user_id=b.user_id AND p.occurrence_id=target.occurrence_id
    LEFT JOIN (${publishedSessionsSql}) s ON s.id=target.occurrence_id AND s.event_id=b.event_id
    WHERE b.event_id=? AND b.id>? ORDER BY b.id LIMIT 251`,
    )
    .bind(query.occurrenceId ?? null, roomId, day, eventId, query.afterBadgeId ?? "")
    .all<{
      badgeId: string;
      userId: string;
      credentialHash: string;
      revoked: number;
      expiresAt: string | null;
      eventRegistered: number;
      physicalDayEligible: number | null;
      allocationCompatible: number;
      privateAccess: number;
      entryEligible: number;
      sessionStatus: string | null;
    }>();
  const afterState = await db
    .prepare(
      "SELECT e.profile_key,e.timezone,s.published_revision FROM events e LEFT JOIN event_agenda_state s ON s.event_id=e.id WHERE e.id=?",
    )
    .bind(eventId)
    .first<{ published_revision: number | null; profile_key: string | null; timezone: string }>();
  if (
    !afterState ||
    (afterState.published_revision ?? null) !== (state.published_revision ?? null) ||
    (nativeEventContext &&
      (afterState.profile_key !== nativeEventContext.profileKey || afterState.timezone !== nativeEventContext.timeZone))
  )
    throw new AppError(409, "OFFLINE_MANIFEST_CHANGED", "The approved schedule changed. Refresh the manifest.");
  const rows = result.results ?? [];
  return offlineEligibilityResponseSchema.parse({
    eventId,
    operatorUserId,
    occurrenceId: query.occurrenceId ?? null,
    roomId,
    revision: state.revision,
    publishedRevision: state.published_revision ?? null,
    ...(nativeEventContext ? { nativeEventContext } : {}),
    serverNow,
    expiresAt: offlineEligibilityExpiresAt(serverNow, session?.timezone ?? state.timezone),
    session: session ? { admissionPolicy: session.admission_policy, visibility: session.visibility } : null,
    entries: rows.slice(0, 250).map((row) => {
      return {
        badgeId: row.badgeId,
        userId: row.userId,
        credentialHash: row.credentialHash,
        revoked: Boolean(row.revoked),
        expiresAt: row.expiresAt,
        eventRegistered: Boolean(row.eventRegistered),
        physicalDayEligible: Boolean(row.physicalDayEligible),
        sessionStatus: row.sessionStatus,
        allocationCompatible: Boolean(row.allocationCompatible),
        privateAccess: Boolean(row.privateAccess),
        sessionEligible:
          !row.revoked &&
          Boolean(row.eventRegistered) &&
          Boolean(row.physicalDayEligible) &&
          Boolean(row.allocationCompatible) &&
          Boolean(row.entryEligible),
      };
    }),
    nextBadgeId: rows.length > 250 ? rows[249]!.badgeId : null,
  });
}
