import type { DatabaseLike, StatementLike } from "../../types";
import { first } from "../../db/queries";
import { prepareStandingAwards } from "./awards";

const MONTHLY_ACTIVITY_REASON = "active_month";
const MONTHLY_ACTIVITY_SOURCE = "calendar_month";

/** A repeat refresh remains a replica read; a missing month still uses the atomic, idempotent source check. */
export async function recordMonthlyActivity(db: DatabaseLike, userId: string, sessionId: string, at: string) {
  const missing = await first(
    db,
    `SELECT 1 FROM standing_settings settings
    WHERE settings.id='default' AND settings.activity_started_at<=?
      AND NOT EXISTS(SELECT 1 FROM user_standing_awards award
        WHERE award.user_id=? AND award.reason_key=? AND award.source_type=? AND award.source_ref=substr(?,1,7))`,
    [at, userId, MONTHLY_ACTIVITY_REASON, MONTHLY_ACTIVITY_SOURCE, at],
  );
  if (missing) await db.batch([prepareMonthlyActivity(db, userId, sessionId, at)]);
}

/** Called only by sign-in and explicit session refresh, never request authentication. */
export function prepareMonthlyActivity(db: DatabaseLike, userId: string, sessionId: string, at: string): StatementLike {
  return prepareStandingAwards(
    db,
    MONTHLY_ACTIVITY_REASON,
    MONTHLY_ACTIVITY_SOURCE,
    {
      sql: `SELECT session.user_id, substr(?,1,7) AS source_ref, ? AS awarded_at
      FROM sessions session JOIN users person ON person.id=session.user_id
      WHERE session.id=? AND session.user_id=? AND session.revoked_at IS NULL
        AND session.expires_at>? AND person.active=1`,
      bindings: [at, at, sessionId, userId, at],
    },
    at,
  );
}
