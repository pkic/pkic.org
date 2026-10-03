import { offlineEligibilityExpiresAt } from "../../../../assets/shared/event-offline-expiry";
import {
  offlineEligibilityResponseSchema,
  type OfflineEligibilityQuery,
} from "../../../../assets/shared/schemas/event-offline-eligibility";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { publishedSessionsSql } from "./published-schedule";

/** Dated eligibility evidence only: this manifest never allocates an offline seat. */
export async function offlineEligibility(
  db: DatabaseLike,
  eventId: string,
  operatorUserId: string,
  query: OfflineEligibilityQuery,
) {
  const state = await db
    .prepare(
      "SELECT COALESCE(s.revision,0) AS revision,s.published_revision,COALESCE(json_extract(p.snapshot_json,'$.timeZone'),e.timezone) AS timezone FROM events e LEFT JOIN event_agenda_state s ON s.event_id=e.id LEFT JOIN event_agenda_publications p ON p.event_id=e.id AND p.revision=s.published_revision WHERE e.id=?",
    )
    .bind(eventId)
    .first<{ revision: number; published_revision: number | null; timezone: string }>();
  if (!state) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found.");
  if (query.publishedRevision !== undefined && query.publishedRevision !== state.published_revision)
    throw new AppError(409, "OFFLINE_MANIFEST_CHANGED", "The approved schedule changed. Refresh the manifest.");
  const session = query.occurrenceId
    ? await db
        .prepare(
          `SELECT admission_policy,visibility,start_at,timezone FROM (${publishedSessionsSql}) WHERE event_id=? AND id=?`,
        )
        .bind(eventId, query.occurrenceId)
        .first<{ admission_policy: string; visibility: string; start_at: string | null; timezone: string }>()
    : null;
  if (query.occurrenceId && !session) throw new AppError(404, "SESSION_NOT_PUBLISHED", "Select an approved session.");
  const serverNow = new Date().toISOString();
  const day = instantToDateTimeLocal(session?.start_at ?? serverNow, session?.timezone ?? state.timezone).slice(0, 10);
  const result = await db
    .prepare(
      `SELECT b.id AS badgeId,b.user_id AS userId,b.credential_hash AS credentialHash,
    b.revoked_at IS NOT NULL AS revoked,COALESCE(r.status='registered',0) AS eventRegistered,
    COALESCE((SELECT a.attendance_type FROM registration_day_attendance a JOIN event_days d ON d.id=a.event_day_id WHERE a.registration_id=r.id AND d.event_id=b.event_id AND d.day_date=?),CASE WHEN EXISTS(SELECT 1 FROM event_days d WHERE d.event_id=b.event_id AND d.day_date=?) THEN 'none' ELSE r.attendance_type END)='in_person' AS physicalDayEligible,
    p.status AS sessionStatus,p.attendance_mode AS participantMode
    FROM event_badge_credentials b LEFT JOIN registrations r ON r.event_id=b.event_id AND r.user_id=b.user_id
    LEFT JOIN agenda_session_participations p ON p.user_id=b.user_id AND p.occurrence_id=?
    WHERE b.event_id=? AND b.id>? ORDER BY b.id LIMIT 251`,
    )
    .bind(day, day, query.occurrenceId ?? null, eventId, query.afterBadgeId ?? "")
    .all<{
      badgeId: string;
      userId: string;
      credentialHash: string;
      revoked: number;
      eventRegistered: number;
      physicalDayEligible: number | null;
      sessionStatus: string | null;
      participantMode: string | null;
    }>();
  const afterState = await db
    .prepare("SELECT published_revision FROM event_agenda_state WHERE event_id=?")
    .bind(eventId)
    .first<{ published_revision: number | null }>();
  if ((afterState?.published_revision ?? null) !== (state.published_revision ?? null))
    throw new AppError(409, "OFFLINE_MANIFEST_CHANGED", "The approved schedule changed. Refresh the manifest.");
  const rows = result.results ?? [];
  return offlineEligibilityResponseSchema.parse({
    eventId,
    operatorUserId,
    occurrenceId: query.occurrenceId ?? null,
    revision: state.revision,
    publishedRevision: state.published_revision ?? null,
    serverNow,
    expiresAt: offlineEligibilityExpiresAt(serverNow, session?.timezone ?? state.timezone),
    session: session ? { admissionPolicy: session.admission_policy, visibility: session.visibility } : null,
    entries: rows.slice(0, 250).map((row) => {
      const reserved = row.sessionStatus === "reserved" && row.participantMode === "physical";
      const privateAccess = !session || session.visibility === "public" || reserved;
      return {
        badgeId: row.badgeId,
        userId: row.userId,
        credentialHash: row.credentialHash,
        revoked: Boolean(row.revoked),
        eventRegistered: Boolean(row.eventRegistered),
        physicalDayEligible: Boolean(row.physicalDayEligible),
        sessionStatus: row.sessionStatus,
        privateAccess,
        sessionEligible:
          !row.revoked &&
          Boolean(row.eventRegistered) &&
          Boolean(row.physicalDayEligible) &&
          privateAccess &&
          (!session || session.admission_policy === "preference" || reserved),
      };
    }),
    nextBadgeId: rows.length > 250 ? rows[249]!.badgeId : null,
  });
}
