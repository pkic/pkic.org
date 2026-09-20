import type { MembershipCategoryOrder } from "../../../../assets/shared/schemas/membership-categories";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { listMembershipCategories } from "./categories";

/** Reorder the complete bounded reference catalog in one revision-guarded command. */
export async function reorderMembershipCategories(db: DatabaseLike, actor: AuthAdmin, input: MembershipCategoryOrder) {
  const snapshot = JSON.stringify(input.categories);
  const now = nowIso();
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "membership:write" }]),
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 WHERE (SELECT COUNT(*) FROM membership_categories) = json_array_length(?)
          AND NOT EXISTS (SELECT 1 FROM json_each(?) entry LEFT JOIN membership_categories category
            ON category.code = json_extract(entry.value, '$.code')
            AND category.revision = json_extract(entry.value, '$.expectedRevision') WHERE category.code IS NULL)`,
        bindings: [snapshot, snapshot],
      }),
      db
        .prepare(
          `UPDATE membership_categories SET display_order =
        (SELECT (CAST(entry.key AS INTEGER) + 1) * 10 FROM json_each(?) entry
          WHERE json_extract(entry.value, '$.code') = membership_categories.code),
        revision = revision + 1, updated_at = ?`,
        )
        .bind(snapshot, now),
      prepareAuditLog(
        db,
        "admin",
        actor.id,
        "membership_categories_reordered",
        "membership_category",
        null,
        { order: input.categories.map((entry) => entry.code) },
        now,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(
        409,
        "MEMBERSHIP_CONFIGURATION_CHANGED",
        "The category catalog or your permission changed. Reload and retry.",
      );
    throw error;
  }
  return { categories: await listMembershipCategories(db) };
}
