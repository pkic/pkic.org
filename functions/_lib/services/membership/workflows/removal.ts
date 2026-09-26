import type { z } from "zod";
import type { membershipWorkflowRemovalSchema } from "../../../../../assets/shared/schemas/membership-workflows";
import { adminDatabaseUserId } from "../../../auth/admin-identity";
import { preparePermissionsAuthorizationGuard } from "../../../auth/permissions";
import type { AuthAdmin, DatabaseLike } from "../../../types";
import { AppError } from "../../../errors";
import { first } from "../../../db/queries";
import { nowIso } from "../../../utils/time";
import { prepareAuditLogAfterOneChange } from "../../audit";
import { getMembershipWorkflowVersion } from "./catalog";
import { workflowWriteConflict } from "./drafts";

/** Delete an unused draft or archive immutable policy, preserving all application evidence. */
export async function removeMembershipWorkflowVersion(
  db: DatabaseLike,
  actor: AuthAdmin,
  id: string,
  input: z.infer<typeof membershipWorkflowRemovalSchema>,
) {
  const version = await getMembershipWorkflowVersion(db, id);
  if (version.revision !== input.expectedRevision || version.archivedAt)
    throw new AppError(409, "MEMBERSHIP_WORKFLOW_CHANGED", "This workflow changed. Reload before removing it.");
  if (await first(db, "SELECT code FROM membership_categories WHERE workflow_version_id = ? LIMIT 1", [id]))
    throw new AppError(
      409,
      "MEMBERSHIP_WORKFLOW_ASSIGNED",
      "Select another workflow for every assigned category before removing this version.",
    );
  const outcome = version.status === "draft" ? ("deleted" as const) : ("archived" as const);
  const now = nowIso();
  const unused = "NOT EXISTS (SELECT 1 FROM membership_categories WHERE workflow_version_id = version.id)";
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "membership:write" }]),
      outcome === "deleted"
        ? db
            .prepare(
              `DELETE FROM membership_workflow_versions AS version WHERE id = ? AND revision = ?
            AND published_at IS NULL AND ${unused}
            AND NOT EXISTS (SELECT 1 FROM membership_application_workflows WHERE version_id = version.id)
            AND NOT EXISTS (SELECT 1 FROM membership_fee_intents WHERE version_id = version.id)`,
            )
            .bind(id, input.expectedRevision)
        : db
            .prepare(
              `INSERT INTO membership_workflow_archives (version_id, archived_at, archived_by_user_id, reason)
            SELECT version.id, ?, ?, ? FROM membership_workflow_versions version
            WHERE version.id = ? AND version.revision = ? AND version.published_at IS NOT NULL AND ${unused}
            AND NOT EXISTS (SELECT 1 FROM membership_workflow_archives WHERE version_id = version.id)`,
            )
            .bind(now, adminDatabaseUserId(actor), input.reason, id, input.expectedRevision),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        `membership_workflow_${outcome}`,
        "membership_workflow",
        id,
        { reason: input.reason, workflowId: version.workflowId, version: version.version },
        now,
      ),
    ]);
  } catch (error) {
    workflowWriteConflict(error);
  }
  return { id, outcome };
}
