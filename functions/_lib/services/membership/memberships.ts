/**
 * Load/create the `members` aggregate row plus its category assignment.
 *
 * `members` (migration 0000) is never rebuilt or altered by this PR — it
 * already models one row per organization or per individual, with
 * user_id/organization_id mutual exclusivity DB-enforced. Category lives in
 * `member_category_assignments` (consolidated migration 0035), one row per aggregate,
 * for both org-tied and org-less members alike.
 */
import { first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { AppError } from "../../errors";
import { assertCategoryCompatible } from "./categories";
import type { DatabaseLike, StatementLike } from "../../types";

export interface MemberAggregate {
  id: string;
  categoryCode: string;
}

interface MemberAggregateRow {
  id: string;
  category_code: string | null;
}

/**
 * Organization-tied aggregates: `members.organization_id` is UNIQUE
 * (migration 0000), so concurrent callers racing to provision the same
 * organization's first member need a race-safe get-or-create, not a
 * plain read-then-insert.
 *
 * Uses `INSERT OR IGNORE` (a losing writer's statement is a no-op, not an
 * error) followed by an unconditional re-read — not a try/catch around the
 * insert. A blanket catch would also swallow an invalid category, an
 * unrelated FK failure, schema drift, or a database outage, and silently
 * reinterpret all of them as a race. Any D1 error other than the intended
 * race propagates instead. Same idiom as
 * `functions/_lib/auth/capability-links.ts`'s `loadOrCreateCapabilitySecret`.
 *
 * Returns statement builders only when the caller wants to fold this into
 * a larger `db.batch()` (e.g. together with a representative insert) — see
 * `getOrCreateOrganizationMemberAggregate` for the common "just do it now"
 * form.
 */
export function buildGetOrCreateOrganizationMemberAggregateStatements(
  db: DatabaseLike,
  organizationId: string,
  categoryCode: string,
  now: string,
): { proposedId: string; statements: StatementLike[] } {
  assertCategoryCompatible(categoryCode, false);
  const proposedId = uuid();
  const statements: StatementLike[] = [
    db
      .prepare(
        `INSERT OR IGNORE INTO members (id, member_type, organization_id, status, created_at, updated_at)
         VALUES (?, 'organization', ?, 'active', ?, ?)`,
      )
      .bind(proposedId, organizationId, now, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO member_category_assignments (member_id, category_code, created_at, updated_at)
         SELECT id, ?, ?, ? FROM members WHERE organization_id = ?`,
      )
      .bind(categoryCode, now, now, organizationId),
  ];
  return { proposedId, statements };
}

/**
 * Exported so callers folding this aggregate into a larger atomic batch
 * (see membership/provisioning.ts) can resolve an *existing* aggregate
 * before building any statements — the same pre-write conflict check
 * `getOrCreateOrganizationMemberAggregate` does after its own batch, just
 * usable before one too.
 */
export async function readOrganizationMemberAggregate(
  db: DatabaseLike,
  organizationId: string,
): Promise<MemberAggregateRow | null> {
  return first<MemberAggregateRow>(
    db,
    `SELECT m.id, a.category_code
     FROM members m LEFT JOIN member_category_assignments a ON a.member_id = m.id
     WHERE m.organization_id = ?`,
    [organizationId],
  );
}

/** Shared by both the standalone get-or-create below and provisioning.ts's pre-batch resolution. */
export function assertNoAggregateCategoryConflict(
  row: MemberAggregateRow,
  categoryCode: string,
): asserts row is { id: string; category_code: string } {
  if (row.category_code && row.category_code !== categoryCode) {
    throw new AppError(
      409,
      "MEMBER_CATEGORY_CONFLICT",
      "Organization already has a different membership category assigned",
    );
  }
}

/**
 * Get-or-create in one call, for callers that don't need to fold this into
 * a larger batch. Re-reads unconditionally — this also runs on the
 * non-race common path, not only after a caught error, so it can't hide a
 * real failure behind a swallowed exception.
 */
export async function getOrCreateOrganizationMemberAggregate(
  db: DatabaseLike,
  organizationId: string,
  categoryCode: string,
  now: string = nowIso(),
): Promise<MemberAggregate> {
  const { statements } = buildGetOrCreateOrganizationMemberAggregateStatements(db, organizationId, categoryCode, now);
  await db.batch(statements);

  const row = await readOrganizationMemberAggregate(db, organizationId);
  if (!row) {
    throw new AppError(500, "MEMBER_AGGREGATE_RACE_UNRESOLVED", "Concurrent member creation did not converge");
  }
  assertNoAggregateCategoryConflict(row, categoryCode);
  return { id: row.id, categoryCode: row.category_code ?? categoryCode };
}

/**
 * Org-less individual aggregates (H5/H6/H7): `members.user_id` is UNIQUE,
 * so — unlike the organization case — a plain insert is already the race
 * boundary (a losing concurrent caller gets a UNIQUE constraint failure,
 * which the caller's find-or-create-user flow already serializes against
 * by resolving the user first). No get-or-create needed; this is a
 * statement builder for the caller's own batch.
 */
export function buildCreateIndividualMemberStatements(
  db: DatabaseLike,
  userId: string,
  categoryCode: string,
  now: string,
  targetEligibility?: { sql: string; bindings: readonly unknown[] },
): { memberId: string; statements: StatementLike[] } {
  assertCategoryCompatible(categoryCode, true);
  const memberId = uuid();
  const memberInsert = targetEligibility
    ? db
        .prepare(
          `INSERT INTO members (id, member_type, user_id, status, created_at, updated_at)
           SELECT ?, 'individual', ?, 'active', ?, ?
            WHERE EXISTS (${targetEligibility.sql})`,
        )
        .bind(memberId, userId, now, now, ...targetEligibility.bindings)
    : db
        .prepare(
          `INSERT INTO members (id, member_type, user_id, status, created_at, updated_at)
           VALUES (?, 'individual', ?, 'active', ?, ?)`,
        )
        .bind(memberId, userId, now, now);
  const statements: StatementLike[] = [
    memberInsert,
    db
      .prepare(
        `INSERT INTO member_category_assignments (member_id, category_code, created_at, updated_at)
         SELECT id, ?, ?, ? FROM members WHERE id = ?`,
      )
      .bind(categoryCode, now, now, memberId),
  ];
  return { memberId, statements };
}

export async function getMemberCategory(db: DatabaseLike, memberId: string): Promise<string | null> {
  const row = await first<{ category_code: string }>(
    db,
    "SELECT category_code FROM member_category_assignments WHERE member_id = ?",
    [memberId],
  );
  return row?.category_code ?? null;
}
