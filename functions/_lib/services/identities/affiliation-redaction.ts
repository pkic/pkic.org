import type { DatabaseLike, StatementLike } from "../../types";

/**
 * Statements that remove the personal affiliation text a person carries once
 * their profile is redacted: the title, biography and links on each of their
 * identities, a title held without an organization, any affiliation text
 * still waiting for staff review, and their answers to the organization
 * offer. The identities themselves remain so records that name them keep
 * their organization.
 *
 * `userIdsSql` is a trusted subquery (or `?`) selecting the affected user ids.
 */
export function prepareAffiliationRedactionStatements(
  db: DatabaseLike,
  userIdsSql: string,
  bindings: readonly unknown[],
  at: string,
): StatementLike[] {
  return [
    db
      .prepare(
        `UPDATE identities
            SET job_title = NULL, biography = NULL, links_json = NULL, updated_at = ?
          WHERE user_id IN (${userIdsSql})
            AND (job_title IS NOT NULL OR biography IS NOT NULL OR links_json IS NOT NULL)`,
      )
      .bind(at, ...bindings),
    db.prepare(`DELETE FROM individual_job_titles WHERE user_id IN (${userIdsSql})`).bind(...bindings),
    db.prepare(`DELETE FROM affiliation_reviews WHERE user_id IN (${userIdsSql})`).bind(...bindings),
    db.prepare(`DELETE FROM affiliation_offer_dismissals WHERE user_id IN (${userIdsSql})`).bind(...bindings),
  ];
}

/** One person's affiliation redaction, for anonymization. */
export function prepareAffiliationRedaction(db: DatabaseLike, userId: string, at: string): StatementLike[] {
  return prepareAffiliationRedactionStatements(db, "?", [userId], at);
}
