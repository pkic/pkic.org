/**
 * The managed membership category catalog (PR #1 review §1.5). The
 * canonical A-G/H1-H8 code vocabulary and structural individual policy live
 * in assets/shared/schemas/membership-categories.ts (isomorphic — the same
 * source the frontend and API contracts use). Editable presentation and
 * voting policy live in D1; this module owns the
 * category/aggregate-type compatibility policy built on top of it, plus a
 * read model for the `membership_categories` reference table (migration
 * 0035) for any caller that needs the DB-backed catalog directly rather
 * than duplicating configuration in code.
 */
import { all, first } from "../../db/queries";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import {
  MEMBERSHIP_CATEGORIES,
  isIndividualMembershipCategory,
  membershipCategoryCatalogEntrySchema,
  type MembershipCategoryCatalogEntry,
  type MembershipCategoryUpdate,
} from "../../../../assets/shared/schemas/membership-categories";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";

/**
 * Category/aggregate-type compatibility, enforced once here rather than
 * left to whichever caller happens to remember to check it (PR #1 review:
 * individual-only categories were previously accepted for organization
 * aggregates and vice versa, with tests deliberately exercising the
 * invalid combinations). Uses the canonical shared vocabulary
 * (membership-categories.ts) rather than a DB round-trip — its parity with
 * the `membership_categories` reference table is itself covered by
 * tests/membership-aggregate.test.ts.
 */
export function assertCategoryCompatible(categoryCode: string, wantsIndividual: boolean): void {
  if (!(MEMBERSHIP_CATEGORIES as readonly string[]).includes(categoryCode)) {
    throw new AppError(422, "INVALID_MEMBERSHIP_CATEGORY", `Unknown membership category: ${categoryCode}`);
  }
  const isIndividual = isIndividualMembershipCategory(categoryCode);
  if (isIndividual !== wantsIndividual) {
    throw new AppError(
      422,
      "MEMBERSHIP_CATEGORY_TYPE_MISMATCH",
      wantsIndividual
        ? `Category ${categoryCode} is not an individual (org-less) membership category`
        : `Category ${categoryCode} is an individual (org-less) membership category and cannot be assigned to an organization`,
    );
  }
}

interface MembershipCategoryRow {
  code: string;
  label: string;
  description: string | null;
  display_order: number;
  is_voting: number;
  revision: number;
  updated_at: string;
}

const MEMBERSHIP_CATEGORY_COLUMNS = "code, label, description, display_order, is_voting, revision, updated_at";

function toMembershipCategory(row: MembershipCategoryRow): MembershipCategoryCatalogEntry {
  return membershipCategoryCatalogEntrySchema.parse({
    code: row.code,
    label: row.label,
    description: row.description,
    displayOrder: row.display_order,
    isIndividual: isIndividualMembershipCategory(row.code),
    isVoting: row.is_voting === 1,
    revision: row.revision,
    updatedAt: row.updated_at,
  });
}

/** The DB-backed category reference table (consolidated migration 0035) — kept in parity with the shared TS vocabulary above by tests/membership-aggregate.test.ts. */
export async function listMembershipCategories(db: DatabaseLike): Promise<MembershipCategoryCatalogEntry[]> {
  const rows = await all<MembershipCategoryRow>(
    db,
    `SELECT ${MEMBERSHIP_CATEGORY_COLUMNS}
       FROM membership_categories
      ORDER BY display_order, code`,
  );
  return rows.map(toMembershipCategory);
}

export async function getMembershipCategory(
  db: DatabaseLike,
  categoryCode: string,
): Promise<MembershipCategoryCatalogEntry | null> {
  const row = await first<MembershipCategoryRow>(
    db,
    `SELECT ${MEMBERSHIP_CATEGORY_COLUMNS} FROM membership_categories WHERE code = ?`,
    [categoryCode],
  );
  return row ? toMembershipCategory(row) : null;
}

export async function isVotingMembershipCategory(db: DatabaseLike, categoryCode: string): Promise<boolean> {
  return Boolean(
    await first<{ authorized: number }>(
      db,
      "SELECT 1 AS authorized FROM membership_categories WHERE code = ? AND is_voting = 1",
      [categoryCode],
    ),
  );
}

const SAFE_SQL_COLUMN_REFERENCE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

/** Canonical D1 voting-policy predicate for trusted internal category-column references. */
export function votingMembershipCategoryExistsSql(categoryCodeReference: string): string {
  if (!SAFE_SQL_COLUMN_REFERENCE.test(categoryCodeReference)) {
    throw new Error("Voting-category SQL requires a qualified column reference");
  }
  return `EXISTS (
    SELECT 1
      FROM membership_categories voting_membership_category
     WHERE voting_membership_category.code = ${categoryCodeReference}
       AND voting_membership_category.is_voting = 1
  )`;
}

/**
 * Canonical live authorization query for one exact user/Member capacity.
 * Bind user id first and member id second. It covers both an individual
 * membership owned by the user and an active organizational representation.
 */
export const ACTIVE_VOTING_MEMBER_CAPACITY_SELECT = `
  SELECT 1
    FROM members active_voting_member
    JOIN users active_voting_user
      ON active_voting_user.id = ?
     AND active_voting_user.active = 1
    JOIN member_category_assignments active_voting_category
      ON active_voting_category.member_id = active_voting_member.id
   WHERE active_voting_member.id = ?
     AND active_voting_member.status = 'active'
     AND ${votingMembershipCategoryExistsSql("active_voting_category.category_code")}
     AND (
       active_voting_member.user_id = active_voting_user.id
       OR EXISTS (
         SELECT 1
           FROM identities active_voting_identity
           JOIN identity_member_capacities active_voting_capacity
             ON active_voting_capacity.identity_id = active_voting_identity.id
          WHERE active_voting_capacity.member_id = active_voting_member.id
            AND active_voting_identity.user_id = active_voting_user.id
            AND active_voting_identity.started_at IS NOT NULL
            AND active_voting_identity.ended_at IS NULL
            AND active_voting_identity.blocked_at IS NULL
       )
     )
   LIMIT 1`;

export async function isActiveVotingMemberCapacity(
  db: DatabaseLike,
  memberId: string,
  userId: string,
): Promise<boolean> {
  return Boolean(await first<{ authorized: number }>(db, ACTIVE_VOTING_MEMBER_CAPACITY_SELECT, [userId, memberId]));
}

export async function updateMembershipCategory(
  db: DatabaseLike,
  actor: AuthAdmin,
  categoryCode: string,
  updates: MembershipCategoryUpdate,
): Promise<MembershipCategoryCatalogEntry> {
  const current = await getMembershipCategory(db, categoryCode);
  if (!current) throw new AppError(404, "MEMBERSHIP_CATEGORY_NOT_FOUND", "Membership category not found");
  if (current.revision !== updates.expectedRevision) {
    throw new AppError(409, "MEMBERSHIP_CONFIGURATION_CHANGED", "Membership category changed; reload and retry");
  }

  const now = nowIso();
  const next = {
    label: updates.label ?? current.label,
    description: updates.description === undefined ? current.description : updates.description,
    displayOrder: updates.displayOrder ?? current.displayOrder,
    isVoting: updates.isVoting ?? current.isVoting,
  };
  const { expectedRevision: _expectedRevision, ...changes } = updates;
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "membership:write" }]),
      db
        .prepare(
          `UPDATE membership_categories
              SET label = ?, description = ?, display_order = ?, is_voting = ?,
                  revision = revision + 1, updated_at = ?
            WHERE code = ? AND revision = ?`,
        )
        .bind(
          next.label,
          next.description,
          next.displayOrder,
          next.isVoting ? 1 : 0,
          now,
          categoryCode,
          updates.expectedRevision,
        ),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "membership_category_updated",
        "membership_category",
        categoryCode,
        changes,
        now,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "MEMBERSHIP_CONFIGURATION_AUTHORIZATION_CHANGED",
        "Membership-management permission changed while the category was being saved",
      );
    }
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(409, "MEMBERSHIP_CONFIGURATION_CHANGED", "Membership category changed; reload and retry");
    }
    throw error;
  }

  return {
    ...current,
    ...next,
    revision: current.revision + 1,
    updatedAt: now,
  };
}
