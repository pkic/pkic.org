import type { DatabaseLike } from "../../functions/_lib/types";

/**
 * Records that a fixture account answered account setup's organization step
 * with "personal", as a person on a domain no organization has claimed does.
 * Its work address then signs in without the step, by link or passkey.
 */
export async function recordPersonalAddressAnswer(db: DatabaseLike, userId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO affiliation_offer_dismissals (id, user_id, organization_id, created_at)
       VALUES (?, ?, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
    .bind(crypto.randomUUID(), userId)
    .run();
}
