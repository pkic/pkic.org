import type { MembershipCategoryCatalogEntry } from "../../../../../assets/shared/schemas/membership-categories";
import type { MembershipWorkflowVersion } from "../../../../../assets/shared/schemas/membership-workflows";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import { AppError } from "../../../errors";
import type { DatabaseLike, StatementLike } from "../../../types";
import { getMembershipWorkflowVersion } from "./catalog";

export async function requireCategoryWorkflow(db: DatabaseLike, category: MembershipCategoryCatalogEntry) {
  if (!category.active || !category.workflowVersionId)
    throw new AppError(409, "MEMBERSHIP_CATEGORY_UNAVAILABLE", "This category is not accepting applications.");
  const version = await getMembershipWorkflowVersion(db, category.workflowVersionId);
  if (version.status !== "published")
    throw new AppError(409, "MEMBERSHIP_WORKFLOW_UNPUBLISHED", "The selected category has no published workflow.");
  return version;
}

/** Pin immutable policy and all required step identities with the application submission. */
export function prepareMembershipWorkflowPin(
  db: DatabaseLike,
  applicationId: string,
  category: MembershipCategoryCatalogEntry,
  version: MembershipWorkflowVersion,
  generation: number,
  now: string,
  explicitVersion = false,
): StatementLike[] {
  return [
    prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM membership_categories category JOIN membership_workflow_versions version
        ON version.id = ? AND version.published_at IS NOT NULL
        WHERE category.code = ? AND category.revision = ?${explicitVersion ? "" : " AND category.retired_at IS NULL AND category.workflow_version_id = version.id"}`,
      bindings: [version.id, category.code, category.revision],
    }),
    db
      .prepare(
        `INSERT INTO membership_application_workflows
      (application_id, generation, version_id, category_code, category_revision, next_evaluation_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(applicationId, generation, version.id, category.code, category.revision, now, now),
    ...version.definition.steps.map((step, position) =>
      db
        .prepare(
          `INSERT INTO membership_application_steps
      (application_id, generation, position, step_id) VALUES (?, ?, ?, ?)`,
        )
        .bind(applicationId, generation, position, step.id),
    ),
  ];
}
