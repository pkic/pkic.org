import {
  MEMBERSHIP_CATEGORY_CATALOG_LIMIT,
  type MembershipCategoryCreate,
} from "../../../../assets/shared/schemas/membership-categories";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { getMembershipCategory } from "./categories";

function conflict(error: unknown): never {
  if (
    isAuthorizationGuardFailure(error) ||
    isAuditChangeGuardFailure(error) ||
    (error instanceof Error && error.message.includes("FOREIGN KEY constraint failed"))
  ) {
    throw new AppError(
      409,
      "MEMBERSHIP_CATEGORY_CHANGED",
      "The category is in use, or the catalog or your permission changed. Reload and retry.",
    );
  }
  throw error;
}

export async function createMembershipCategory(db: DatabaseLike, actor: AuthAdmin, input: MembershipCategoryCreate) {
  if (await getMembershipCategory(db, input.code))
    throw new AppError(409, "MEMBERSHIP_CATEGORY_EXISTS", "This category code already exists");
  const count = await first<{ total: number }>(db, "SELECT COUNT(*) AS total FROM membership_categories");
  if ((count?.total ?? 0) >= MEMBERSHIP_CATEGORY_CATALOG_LIMIT)
    throw new AppError(
      422,
      "MEMBERSHIP_CATEGORY_LIMIT",
      `The catalog supports up to ${MEMBERSHIP_CATEGORY_CATALOG_LIMIT} categories`,
    );
  const now = nowIso();
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "membership:write" }]),
      ...(input.workflowVersionId
        ? [
            prepareAuthorizationGuard(db, {
              sql: "SELECT 1 FROM membership_workflow_versions WHERE id = ? AND published_at IS NOT NULL",
              bindings: [input.workflowVersionId],
            }),
          ]
        : []),
      db
        .prepare(
          `INSERT INTO membership_categories
        (code, label, description, display_order, is_voting, is_individual, requires_university_email, retired_at, workflow_version_id, revision, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?
        WHERE NOT EXISTS (SELECT 1 FROM membership_categories WHERE code = ?)
          AND (SELECT COUNT(*) FROM membership_categories) < ?`,
        )
        .bind(
          input.code,
          input.label,
          input.description,
          input.displayOrder,
          input.isVoting ? 1 : 0,
          input.isIndividual ? 1 : 0,
          input.requiresUniversityEmail ? 1 : 0,
          input.active ? null : now,
          input.workflowVersionId,
          now,
          input.code,
          MEMBERSHIP_CATEGORY_CATALOG_LIMIT,
        ),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "membership_category_created",
        "membership_category",
        input.code,
        input,
        now,
      ),
    ]);
  } catch (error) {
    conflict(error);
  }
  return { ...input, revision: 0, updatedAt: now };
}

export async function deleteMembershipCategory(
  db: DatabaseLike,
  actor: AuthAdmin,
  code: string,
  expectedRevision: number,
) {
  const current = await getMembershipCategory(db, code);
  if (!current) throw new AppError(404, "MEMBERSHIP_CATEGORY_NOT_FOUND", "Membership category not found");
  if (current.revision !== expectedRevision)
    throw new AppError(409, "MEMBERSHIP_CONFIGURATION_CHANGED", "Membership category changed; reload and retry");
  const now = nowIso();
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "membership:write" }]),
      db.prepare("DELETE FROM group_membership_category_rules WHERE membership_category_code = ?").bind(code),
      db
        .prepare(
          `DELETE FROM membership_categories WHERE code = ? AND revision = ?
        AND NOT EXISTS (SELECT 1 FROM member_category_assignments WHERE category_code = membership_categories.code)
        AND NOT EXISTS (SELECT 1 FROM member_applications WHERE membership_category = membership_categories.code)
        AND NOT EXISTS (SELECT 1 FROM votes, json_each(votes.eligible_categories) category_filter WHERE category_filter.value = membership_categories.code)
        AND NOT EXISTS (SELECT 1 FROM vote_proposals, json_each(vote_proposals.eligible_categories) category_filter WHERE category_filter.value = membership_categories.code)
        AND NOT EXISTS (SELECT 1 FROM mailing_lists, json_each(mailing_lists.auto_sync_categories_json) category_filter WHERE category_filter.value = membership_categories.code)`,
        )
        .bind(code, expectedRevision),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "membership_category_deleted",
        "membership_category",
        code,
        current,
        now,
      ),
    ]);
  } catch (error) {
    conflict(error);
  }
  return { deleted: true as const };
}
