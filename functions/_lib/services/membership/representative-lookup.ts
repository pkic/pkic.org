/**
 * The deterministic "first" `organization_representatives` row for a user
 * who may represent more than one organization at once (consolidated migration 0035,
 * concurrent multi-organization representation is a supported case, not
 * an edge case to guard against). Read models that need to show or count
 * exactly one row per user — not one row per represented organization —
 * join through this instead of an unordered join, which would either fan
 * out duplicate rows or (worse, in a scalar-subquery context) return
 * whichever row SQLite happens to pick.
 *
 * This was previously seven near-identical copies of the same correlated
 * subquery independently inline in five files (directory.ts, leadership.ts,
 * group leadership and admin user projections) — PR #1
 * review, phase1-2-review-20260817.md blocker 2.
 *
 * "Earliest joined_at" is a display/listing tie-break, not a claim that
 * the picked organization is the "correct" one for every purpose — a
 * business-logic decision that depends on *all* of a user's affiliations
 * (e.g. working-group category eligibility) must check every membership,
 * not rely on this deterministic-but-arbitrary pick. See
 * group membership eligibility checks, which use
 * `findEligibleMemberById`'s full `activeMemberships` list instead of this
 * helper for exactly that reason.
 *
 * @param userIdExpr a SQL expression for the correlated user id column in
 *   the enclosing query (e.g. `"u.id"`, `"wgm.user_id"") — always a fixed,
 *   code-controlled alias string, never user input.
 */
export function deterministicRepresentativeJoinSql(userIdExpr: string): string {
  return `
     LEFT JOIN organization_representatives rep ON rep.id = (
       SELECT r2.id FROM organization_representatives r2
       WHERE r2.user_id = ${userIdExpr} AND r2.left_at IS NULL
       ORDER BY r2.joined_at ASC LIMIT 1
     )`;
}
