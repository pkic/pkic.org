/** D1 category catalog and membership holder compatibility policy. */
import { prepareMembershipCategoryRename } from "./category-renaming";
import { all, first } from "../../db/queries";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import {
  MEMBERSHIP_CATEGORY_CATALOG_LIMIT,
  membershipCategoryCatalogEntrySchema,
  type MembershipCategoryCatalogEntry,
  type MembershipCategoryUpdate,
} from "../../../../assets/shared/schemas/membership-categories";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";

/** Resolve configured policy before preparing a membership change. */
export async function requireMembershipCategory(
  db: DatabaseLike,
  categoryCode: string,
): Promise<MembershipCategoryCatalogEntry> {
  const category = await getMembershipCategory(db, categoryCode);
  if (!category) throw new AppError(422, "INVALID_MEMBERSHIP_CATEGORY", `Unknown membership category: ${categoryCode}`);
  return category;
}

export async function assertCategoryCompatible(
  db: DatabaseLike,
  categoryCode: string,
  wantsIndividual: boolean,
): Promise<void> {
  const category = await requireMembershipCategory(db, categoryCode);
  if (category.isIndividual !== wantsIndividual) {
    throw new AppError(
      422,
      "MEMBERSHIP_CATEGORY_TYPE_MISMATCH",
      wantsIndividual ? "Choose a category for an individual user" : "Choose a category for an organization",
    );
  }
}

export function prepareMembershipCategoryGuard(db: DatabaseLike, categoryCode: string, wantsIndividual: boolean) {
  return prepareAuthorizationGuard(db, {
    sql: "SELECT 1 FROM membership_categories WHERE code = ? AND is_individual = ?",
    bindings: [categoryCode, wantsIndividual ? 1 : 0],
  });
}

interface MembershipCategoryRow {
  code: string;
  label: string;
  description: string | null;
  display_order: number;
  is_voting: number;
  is_individual: number;
  requires_university_email: number;
  retired_at: string | null;
  workflow_version_id: string | null;
  revision: number;
  updated_at: string;
}

const MEMBERSHIP_CATEGORY_COLUMNS =
  "code, label, description, display_order, is_voting, is_individual, requires_university_email, retired_at, workflow_version_id, revision, updated_at";

function toMembershipCategory(row: MembershipCategoryRow): MembershipCategoryCatalogEntry {
  return membershipCategoryCatalogEntrySchema.parse({
    code: row.code,
    label: row.label,
    description: row.description,
    displayOrder: row.display_order,
    isIndividual: row.is_individual === 1,
    requiresUniversityEmail: row.requires_university_email === 1,
    isVoting: row.is_voting === 1,
    active: row.retired_at === null,
    workflowVersionId: row.workflow_version_id,
    revision: row.revision,
    updatedAt: row.updated_at,
  });
}

/** The DB-backed category reference table (consolidated migration 0035) — kept in parity with the shared TS vocabulary above by tests/membership-aggregate.test.ts. */
export async function listMembershipCategories(
  db: DatabaseLike,
  availableForApplication = false,
): Promise<MembershipCategoryCatalogEntry[]> {
  const rows = await all<MembershipCategoryRow>(
    db,
    `SELECT ${MEMBERSHIP_CATEGORY_COLUMNS}
       FROM membership_categories
       ${availableForApplication ? "WHERE retired_at IS NULL AND EXISTS (SELECT 1 FROM membership_workflow_versions version WHERE version.id = membership_categories.workflow_version_id AND version.published_at IS NOT NULL)" : ""}
      ORDER BY display_order, code LIMIT ?`,
    [MEMBERSHIP_CATEGORY_CATALOG_LIMIT],
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
export function activeVotingMemberCapacitySelect(memberIdExpression = "?", userIdExpression = "?"): string {
  if (memberIdExpression !== "?" && !SAFE_SQL_COLUMN_REFERENCE.test(memberIdExpression))
    throw new Error("Voting capacity requires a trusted column reference");
  if (userIdExpression !== "?" && !SAFE_SQL_COLUMN_REFERENCE.test(userIdExpression))
    throw new Error("Voting capacity requires a trusted user column reference");
  return `
  SELECT 1
    FROM members active_voting_member
    JOIN users active_voting_user
      ON active_voting_user.id = ${userIdExpression}
     AND active_voting_user.active = 1
     AND active_voting_user.pii_redacted_at IS NULL
     AND active_voting_user.merged_into_user_id IS NULL
    JOIN member_category_assignments active_voting_category
      ON active_voting_category.member_id = active_voting_member.id
   WHERE active_voting_member.id = ${memberIdExpression}
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
}

export const ACTIVE_VOTING_MEMBER_CAPACITY_SELECT = activeVotingMemberCapacitySelect();

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

  const nextCode = updates.code ?? current.code;
  if (nextCode !== categoryCode && (await getMembershipCategory(db, nextCode)))
    throw new AppError(409, "MEMBERSHIP_CATEGORY_EXISTS", "This category code already exists");
  const now = nowIso();
  const next = {
    code: nextCode,
    label: updates.label ?? current.label,
    description: updates.description === undefined ? current.description : updates.description,
    displayOrder: updates.displayOrder ?? current.displayOrder,
    isVoting: updates.isVoting ?? current.isVoting,
    active: updates.active ?? current.active,
    workflowVersionId: updates.workflowVersionId === undefined ? current.workflowVersionId : updates.workflowVersionId,
  };
  const { expectedRevision: _expectedRevision, ...changes } = updates;
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "membership:write" }]),
      ...(next.workflowVersionId
        ? [
            prepareAuthorizationGuard(db, {
              sql: "SELECT 1 FROM membership_workflow_versions WHERE id = ? AND published_at IS NOT NULL",
              bindings: [next.workflowVersionId],
            }),
          ]
        : []),
      ...prepareMembershipCategoryRename(db, categoryCode, nextCode, updates.expectedRevision, now),
      db
        .prepare(
          `UPDATE membership_categories
              SET label = ?, description = ?, display_order = ?, is_voting = ?,
                  retired_at = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(retired_at, ?) END, workflow_version_id = ?,
                  revision = revision + 1, updated_at = ?
            WHERE code = ? AND revision = ?`,
        )
        .bind(
          next.label,
          next.description,
          next.displayOrder,
          next.isVoting ? 1 : 0,
          next.active ? 1 : 0,
          now,
          next.workflowVersionId,
          now,
          nextCode,
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
        "The category code, catalog, workflow, or your permission changed. Reload and retry",
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
