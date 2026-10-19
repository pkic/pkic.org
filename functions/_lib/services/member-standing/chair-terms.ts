import type { DatabaseLike } from "../../types";
import { prepareStandingAwards } from "./awards";

/** Ended lead terms use the same end instant as the leadership read model. No historical backfill. */
export async function awardCompletedChairTerms(db: DatabaseLike, at: string, limit = 50): Promise<void> {
  await db.batch([
    prepareStandingAwards(
      db,
      "group_chaired_term",
      "user_role",
      {
        sql: `SELECT term.user_id, term.id AS source_ref, COALESCE(term.revoked_at,term.expires_at) AS awarded_at
      FROM user_roles term JOIN standing_settings settings ON settings.id='default'
      JOIN users person ON person.id=term.user_id
        AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
      WHERE term.context_type='group' AND term.role_id='role-group_lead'
        AND COALESCE(term.revoked_at,term.expires_at)<=? AND COALESCE(term.revoked_at,term.expires_at)>=settings.activity_started_at
        AND COALESCE(term.starts_at,term.created_at)<COALESCE(term.revoked_at,term.expires_at)
        AND NOT EXISTS(SELECT 1 FROM user_standing_awards award WHERE award.user_id=term.user_id
          AND award.reason_key='group_chaired_term' AND award.source_type='user_role' AND award.source_ref=term.id)
      ORDER BY COALESCE(term.revoked_at,term.expires_at),term.id LIMIT ?`,
        bindings: [at, limit],
      },
      at,
    ),
  ]);
}
