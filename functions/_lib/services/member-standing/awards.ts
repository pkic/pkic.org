import { STANDING_REASON_POINTS, type StandingReason } from "../../../../assets/shared/member-standing";
import type { DatabaseLike, StatementLike } from "../../types";

/** A source query returns only activity recorded by the caller's atomic command. */
export function prepareStandingAwards(
  db: DatabaseLike,
  reason: StandingReason,
  sourceType: string,
  source: { sql: string; bindings: unknown[] },
  createdAt: string,
): StatementLike {
  return db
    .prepare(`INSERT INTO user_standing_awards
      (id,user_id,reason_key,points,source_type,source_ref,awarded_at,created_at)
    SELECT lower(hex(randomblob(16))), activity.user_id, ?, ?, ?, activity.source_ref, activity.awarded_at, ?
      FROM (${source.sql}) activity
      JOIN users person ON person.id=activity.user_id
      JOIN standing_settings settings ON settings.id='default'
     WHERE activity.awarded_at >= settings.activity_started_at
       AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
    ON CONFLICT(user_id,reason_key,source_type,source_ref)
      WHERE source_type IS NOT NULL AND source_ref IS NOT NULL DO NOTHING`)
    .bind(reason, STANDING_REASON_POINTS[reason], sourceType, createdAt, ...source.bindings);
}

/** Once per event, regardless of sessions, days, repeated scans or capture mode. */
export function prepareCheckInStanding(db: DatabaseLike, attemptId: string, at: string): StatementLike {
  return prepareStandingAwards(
    db,
    "event_attended",
    "event",
    {
      sql: `SELECT observation.user_id, observation.event_id AS source_ref, observation.observed_at AS awarded_at
      FROM event_attendance_observations observation
      JOIN event_scan_attempts attempt ON attempt.id=observation.attempt_id
      WHERE attempt.id=? AND attempt.action<>'checkout'`,
      bindings: [attemptId],
    },
    at,
  );
}
