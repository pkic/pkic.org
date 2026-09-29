import type { z } from "zod";
import type {
  membershipWorkflowCreateSchema,
  membershipWorkflowUpdateSchema,
} from "../../../../../assets/shared/schemas/membership-workflows";
import { preparePermissionsAuthorizationGuard } from "../../../auth/permissions";
import { isAuthorizationGuardFailure } from "../../../db/authorization-guard";
import { first } from "../../../db/queries";
import { AppError } from "../../../errors";
import type { AuthAdmin, DatabaseLike } from "../../../types";
import { uuid } from "../../../utils/ids";
import { nowIso } from "../../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../../audit";
import { getMembershipWorkflowVersion } from "./catalog";

export function workflowWriteConflict(error: unknown): never {
  if (
    isAuthorizationGuardFailure(error) ||
    isAuditChangeGuardFailure(error) ||
    (error instanceof Error &&
      error.message.includes("UNIQUE constraint failed: membership_workflow_versions.workflow_id"))
  ) {
    throw new AppError(
      409,
      "MEMBERSHIP_WORKFLOW_CHANGED",
      "The workflow or your permission changed. Reload and retry.",
    );
  }
  throw error;
}
export async function createMembershipWorkflowDraft(
  db: DatabaseLike,
  actor: AuthAdmin,
  input: z.infer<typeof membershipWorkflowCreateSchema>,
) {
  const source = input.sourceVersionId ? await getMembershipWorkflowVersion(db, input.sourceVersionId) : null;
  const id = uuid();
  const workflowId = source?.workflowId ?? uuid();
  const latest = source
    ? await first<{ version: number }>(
        db,
        "SELECT MAX(version) AS version FROM membership_workflow_versions WHERE workflow_id = ?",
        [workflowId],
      )
    : null;
  const version = (latest?.version ?? 0) + 1;
  const now = nowIso();
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "membership:write" }]),
      ...(!source
        ? [db.prepare("INSERT INTO membership_workflows (id, created_at) VALUES (?, ?)").bind(workflowId, now)]
        : []),
      db
        .prepare(
          `INSERT INTO membership_workflow_versions (id, workflow_id, version, revision, name, status, definition_json, created_at)
        VALUES (?, ?, ?, 0, ?, 'draft', ?, ?)`,
        )
        .bind(id, workflowId, version, input.definition.name, JSON.stringify(input.definition), now),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "membership_workflow_draft_created",
        "membership_workflow",
        id,
        { sourceVersionId: source?.id ?? null, version },
        now,
      ),
    ]);
  } catch (error) {
    workflowWriteConflict(error);
  }
  return getMembershipWorkflowVersion(db, id);
}
export async function updateMembershipWorkflowDraft(
  db: DatabaseLike,
  actor: AuthAdmin,
  id: string,
  input: z.infer<typeof membershipWorkflowUpdateSchema>,
) {
  const current = await getMembershipWorkflowVersion(db, id);
  if (current.status !== "draft")
    throw new AppError(
      409,
      "MEMBERSHIP_WORKFLOW_IMMUTABLE",
      "Published versions are immutable. Create a new draft version.",
    );
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "membership:write" }]),
      db
        .prepare(
          `UPDATE membership_workflow_versions SET name = ?, definition_json = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND published_at IS NULL`,
        )
        .bind(input.definition.name, JSON.stringify(input.definition), id, input.expectedRevision),
      prepareAuditLogAfterOneChange(
        db,
        "admin",
        actor.id,
        "membership_workflow_draft_updated",
        "membership_workflow",
        id,
        { expectedRevision: input.expectedRevision },
      ),
    ]);
  } catch (error) {
    workflowWriteConflict(error);
  }
  return getMembershipWorkflowVersion(db, id);
}
