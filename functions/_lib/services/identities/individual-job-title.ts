import type { DatabaseLike, StatementLike } from "../../types";

/**
 * An individual identity has no organization to carry a title (the
 * identities CHECK keeps titles on organization identities), so its holder's
 * title lives in individual_job_titles. A null or empty title clears it.
 */
export function prepareIndividualJobTitleStatement(
  db: DatabaseLike,
  userId: string,
  jobTitle: string | null,
  at: string,
): StatementLike {
  return jobTitle
    ? db
        .prepare(
          `INSERT INTO individual_job_titles (user_id, job_title, created_at, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET job_title = excluded.job_title, updated_at = excluded.updated_at`,
        )
        .bind(userId, jobTitle, at, at)
    : db.prepare("DELETE FROM individual_job_titles WHERE user_id = ?").bind(userId);
}
