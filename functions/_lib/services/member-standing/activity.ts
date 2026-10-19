import type { DatabaseLike, StatementLike } from "../../types";
import { prepareStandingAwards } from "./awards";

/** Called only by sign-in and explicit session refresh, never request authentication. */
export function prepareMonthlyActivity(db: DatabaseLike, userId: string, sessionId: string, at: string): StatementLike {
  return prepareStandingAwards(
    db,
    "active_month",
    "calendar_month",
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
