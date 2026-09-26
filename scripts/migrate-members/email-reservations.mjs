/**
 * Post-import reservation check: which member addresses the database
 * refused to hand an account, and which account is holding each one.
 *
 * One address is one reservation across `users.normalized_email`,
 * `user_emails.normalized_email` and `users.pending_email` (consolidated
 * migration 0035). The generated SQL therefore creates an account only for
 * an address nothing has claimed yet — see `buildUpsertUserStatements` —
 * which leaves exactly two ways for a directory address to end the import
 * without a live account behind it:
 *
 *   - another account reserved it with an unconfirmed pending email
 *     change, which claims the address without owning it; or
 *   - the account that owns it is redacted or merged, so nothing may be
 *     written to it.
 *
 * Neither is something the importer may resolve on its own: cancelling
 * someone's in-flight email change, or re-populating a redacted profile,
 * is a staff decision. They are reported per address instead, and the
 * import stays idempotent — once staff settle the reservation, rerunning
 * the importer creates the account.
 *
 * This module is pure. The database round trip lives in r2-adapter.mjs.
 */
import { ownerUserIdForEmailExpression } from "./sql-renderer.mjs";

/** A reservation only matters when no live account ended up behind it. */
const withoutLiveAccount = (emailExpression) => `${ownerUserIdForEmailExpression(emailExpression)} IS NULL`;

/**
 * Every reservation in the target database that left its address without a
 * live account, independent of what this import contains — the row count is
 * bounded by in-flight email changes and closed accounts, so the importer's
 * own (much larger) address list never has to be sent to D1 to be checked
 * against it.
 *
 * The live-account guard is what keeps a legacy row honest: a dump written
 * before migration 0035's reservation triggers existed can hold a pending
 * change for an address another account already owns, and that member
 * imports fine — reporting it would send staff after a member who arrived.
 */
export const EMAIL_RESERVATION_QUERY = `
SELECT pending.pending_email AS email, pending.email AS reservedBy, 'pending_email_change' AS reason
  FROM users pending
 WHERE pending.pending_email IS NOT NULL
   AND ${withoutLiveAccount("pending.pending_email")}
 UNION ALL
SELECT closed.normalized_email AS email, closed.email AS reservedBy, 'closed_account' AS reason
  FROM users closed
 WHERE (closed.pii_redacted_at IS NOT NULL OR closed.merged_into_user_id IS NOT NULL)
   AND ${withoutLiveAccount("closed.normalized_email")}
 UNION ALL
SELECT alternate.normalized_email AS email, closed.email AS reservedBy, 'closed_account' AS reason
  FROM user_emails alternate
  JOIN users closed ON closed.id = alternate.user_id
 WHERE (closed.pii_redacted_at IS NOT NULL OR closed.merged_into_user_id IS NOT NULL)
   AND ${withoutLiveAccount("alternate.normalized_email")}
`;

export const RESERVATION_REASONS = {
  pending_email_change: "reserved by another account's unconfirmed email change",
  closed_account: "owned by a redacted or merged account",
};

/**
 * Intersects the addresses this import expected to have accounts for with
 * the reservations the database actually holds.
 *
 * @param {Iterable<string>} importedEmails normalized addresses the import covered
 * @param {Record<string, unknown>[]} reservations rows returned by EMAIL_RESERVATION_QUERY
 * @returns {{ email: string, reservedBy: string | null, reason: string }[]} sorted by address
 */
export function findEmailReservationConflicts(importedEmails, reservations) {
  const expected = new Set(importedEmails);
  const conflicts = new Map();
  for (const row of reservations) {
    const email = String(row.email ?? "").toLowerCase();
    if (!expected.has(email) || conflicts.has(email)) continue;
    conflicts.set(email, {
      email,
      reservedBy: typeof row.reservedBy === "string" ? row.reservedBy : null,
      reason: String(row.reason),
    });
  }
  return [...conflicts.values()].sort((a, b) => a.email.localeCompare(b.email));
}
