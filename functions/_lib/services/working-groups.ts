/**
 * Shared working-group membership helpers. Used by both the member
 * self-service flows (`member-self-service.ts`'s `joinMyWorkingGroup`/
 * `leaveMyWorkingGroup`, keyed to the caller's own identity) and the admin
 * working-groups CRUD endpoints (keyed to an arbitrary target user) — the
 * underlying `working_group_members` upsert-by-`left_at IS NULL` logic and
 * Google Groups sync enqueue is identical either way, only the caller's
 * authorization differs.
 */
import { all, first } from "../db/queries";
import { buildD1JsonMembershipFilter } from "../db/json-membership";
import { nowIso } from "../utils/time";
import { uuid } from "../utils/ids";
import { AppError } from "../errors";
import { buildEnqueueGoogleGroupsSyncStatement } from "./google-groups";
import type { DatabaseLike, StatementLike } from "../types";

export const CA_WORKING_GROUP_SLUG = "ca";
export const CA_ONLY_CATEGORY = "A";

export interface WorkingGroupRow {
  id: string;
  slug: string;
  name: string;
  mailing_list_email: string | null;
  active: number;
}

const WORKING_GROUP_SELECT_COLUMNS = "id, slug, name, mailing_list_email, active";

export async function getWorkingGroupBySlugOrId(db: DatabaseLike, wgIdOrSlug: string): Promise<WorkingGroupRow | null> {
  return first<WorkingGroupRow>(
    db,
    `SELECT ${WORKING_GROUP_SELECT_COLUMNS} FROM working_groups WHERE id = ? OR slug = ?`,
    [wgIdOrSlug, wgIdOrSlug],
  );
}

/** Resolves a bounded slug set once, preserving request order while dropping unknown and duplicate slugs. */
export async function getWorkingGroupsBySlugs(db: DatabaseLike, slugs: readonly string[]): Promise<WorkingGroupRow[]> {
  const uniqueSlugs = [...new Set(slugs)];
  if (uniqueSlugs.length === 0) return [];

  const filter = buildD1JsonMembershipFilter("slug", uniqueSlugs);
  const rows = await all<WorkingGroupRow>(
    db,
    `SELECT ${WORKING_GROUP_SELECT_COLUMNS} FROM working_groups WHERE ${filter.sql}`,
    filter.bindings,
  );
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return uniqueSlugs.flatMap((slug) => {
    const row = bySlug.get(slug);
    return row ? [row] : [];
  });
}

/** Bulk-resolves display names for a bounded set of canonical IDs. */
export async function getWorkingGroupNamesByIds(
  db: DatabaseLike,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return new Map();

  const filter = buildD1JsonMembershipFilter("id", uniqueIds);
  const rows = await all<Pick<WorkingGroupRow, "id" | "name">>(
    db,
    `SELECT id, name FROM working_groups WHERE ${filter.sql}`,
    filter.bindings,
  );
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * Only category-A members may belong to the CA working group. Takes every
 * membership category the target person currently holds (a person may
 * represent more than one organization at once, consolidated migration 0035) and
 * passes if *any* of them is category A — checking a single arbitrarily
 * -picked category here previously meant a person representing both a
 * category-A and a non-A organization could be accepted or rejected
 * depending on which row an unordered scalar subquery happened to return
 * (PR #1 review, phase1-2-review-20260817.md blocker 2).
 */
export function assertCaConstraint(wg: WorkingGroupRow, membershipCategories: readonly string[]): void {
  if (wg.slug === CA_WORKING_GROUP_SLUG && !membershipCategories.includes(CA_ONLY_CATEGORY)) {
    throw new AppError(403, "CA_CATEGORY_REQUIRED", "Only category A members may join the CA working group");
  }
}

/**
 * Builds the statements to add `targetUserId` to `wg`, without executing
 * them — lets a caller that's already assembling a larger atomic
 * `db.batch()` (e.g. admin-members.ts's createAdminMember) fold working-
 * group membership into that same transition instead of writing it
 * separately. `addWorkingGroupMember` below is the immediate-execution
 * wrapper most callers want.
 *
 * `INSERT OR IGNORE` (not a plain INSERT) against the partial unique index
 * on (working_group_id, user_id) WHERE left_at IS NULL — this is a real
 * concurrency safeguard, not defense-in-depth theater: the membership-check
 * read above happens before the statements are actually executed (by
 * `db.batch()`, possibly bundled with several other writes), so a
 * concurrent request could still win the race in between. OR IGNORE makes
 * that race resolve to "no-op", not a broken batch or a duplicate row.
 */
export async function buildAddWorkingGroupMemberStatements(
  db: DatabaseLike,
  wg: WorkingGroupRow,
  targetUserId: string,
  /** The membership this WG seat is held on behalf of, when the caller has an unambiguous one to record (PR #1 review blocker 2). Null when the caller has no single "acting as" context (e.g. a staff add for a target with more than one active membership). */
  memberId: string | null = null,
): Promise<StatementLike[]> {
  const statements: StatementLike[] = [
    db
      .prepare(
        `INSERT OR IGNORE INTO working_group_members
           (id, working_group_id, user_id, member_id, joined_at, left_at)
         SELECT ?, ?, ?, ?, ?, NULL
          WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND active = 1)
            AND (
              ? IS NULL
              OR EXISTS (
                SELECT 1
                  FROM members m
                  LEFT JOIN organization_representatives r
                    ON r.member_id = m.id AND r.user_id = ? AND r.left_at IS NULL
                 WHERE m.id = ? AND m.status = 'active'
                   AND (m.user_id = ? OR r.id IS NOT NULL)
              )
            )`,
      )
      .bind(
        uuid(),
        wg.id,
        targetUserId,
        memberId,
        nowIso(),
        targetUserId,
        memberId,
        targetUserId,
        memberId,
        targetUserId,
      ),
  ];

  if (wg.mailing_list_email) {
    statements.push(
      buildEnqueueGoogleGroupsSyncStatement(db, {
        userId: targetUserId,
        googleGroupEmail: wg.mailing_list_email,
        action: "add_to_list",
        onlyIfPreviousStatementChanged: true,
      }).statement,
    );
  }

  return statements;
}

export async function addWorkingGroupMember(
  db: DatabaseLike,
  wg: WorkingGroupRow,
  targetUserId: string,
  memberId: string | null = null,
): Promise<void> {
  const statements = await buildAddWorkingGroupMemberStatements(db, wg, targetUserId, memberId);
  if (statements.length > 0) {
    await db.batch(statements);
  }
}

export async function removeWorkingGroupMember(
  db: DatabaseLike,
  wg: WorkingGroupRow,
  targetUserId: string,
): Promise<void> {
  const statements = await buildRemoveWorkingGroupMemberStatements(db, wg, targetUserId);
  if (statements.length > 0) {
    await db.batch(statements);
  }
}

/** Prepared statements for callers that must include removal in a larger atomic use case. */
export async function buildRemoveWorkingGroupMemberStatements(
  db: DatabaseLike,
  wg: WorkingGroupRow,
  targetUserId: string,
): Promise<StatementLike[]> {
  const statements: StatementLike[] = [
    db
      .prepare(
        "UPDATE working_group_members SET left_at = ? WHERE working_group_id = ? AND user_id = ? AND left_at IS NULL",
      )
      .bind(nowIso(), wg.id, targetUserId),
  ];
  if (wg.mailing_list_email) {
    statements.push(
      buildEnqueueGoogleGroupsSyncStatement(db, {
        userId: targetUserId,
        googleGroupEmail: wg.mailing_list_email,
        action: "remove_from_list",
        onlyIfPreviousStatementChanged: true,
      }).statement,
    );
  }
  return statements;
}
