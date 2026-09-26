import type { z } from "zod";
import {
  membershipWorkflowMigrationPreviewResponseSchema,
  type membershipWorkflowMigrationSchema,
} from "../../../../../assets/shared/schemas/membership-workflow-migration";
import { isApplicationTerminalStage } from "../../../../../assets/shared/schemas/member-applications";
import { preparePermissionsAuthorizationGuard } from "../../../auth/permissions";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import { first } from "../../../db/queries";
import { AppError } from "../../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../../types";
import { sha256Hex } from "../../../utils/crypto";
import { uuid } from "../../../utils/ids";
import { nowIso } from "../../../utils/time";
import { prepareAuditLog } from "../../audit";
import { getMemberApplicationById } from "../applications/queries";
import { requireMembershipCategory } from "../categories";
import { getMembershipWorkflowVersion } from "./catalog";
import { prepareMembershipWorkflowPin } from "./pinning";
import { workflowWriteConflict } from "./drafts";

async function migrationSnapshot(db: DatabaseLike, applicationId: string, versionId: string) {
  const application = await getMemberApplicationById(db, applicationId);
  if (!application) throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
  if (isApplicationTerminalStage(application.stage))
    throw new AppError(409, "MEMBERSHIP_APPLICATION_CLOSED", "Closed applications cannot change workflow.");
  const target = await getMembershipWorkflowVersion(db, versionId);
  if (target.status !== "published" || target.archivedAt)
    throw new AppError(409, "MEMBERSHIP_WORKFLOW_UNPUBLISHED", "Choose an available published workflow version.");
  const current = await first<{ generation: number; version_id: string; revision: number }>(
    db,
    "SELECT generation, version_id, revision FROM membership_application_workflows WHERE application_id = ? AND superseded_at IS NULL",
    [applicationId],
  );
  if (!current) throw new AppError(409, "MEMBERSHIP_WORKFLOW_MISSING", "This application has no pinned workflow.");
  const category = await requireMembershipCategory(db, application.membership_category);
  const counts = await first<{ objections: number; paid: number }>(
    db,
    `SELECT
    (SELECT COUNT(*) FROM membership_application_objections WHERE application_id = ? AND state IN ('unresolved', 'upheld')) AS objections,
    (SELECT COUNT(*) FROM membership_fee_intents WHERE application_id = ? AND status = 'paid') AS paid`,
    [applicationId, applicationId],
  );
  const fingerprint = await sha256Hex(
    JSON.stringify({
      applicationRevision: application.transition_revision,
      stage: application.stage,
      categoryRevision: category.revision,
      current,
      target: target.id,
      counts,
    }),
  );
  return { application, target, category, current, counts: counts!, fingerprint };
}
export async function previewMembershipWorkflowMigration(db: DatabaseLike, applicationId: string, versionId: string) {
  const snapshot = await migrationSnapshot(db, applicationId, versionId);
  return membershipWorkflowMigrationPreviewResponseSchema.parse({
    fingerprint: snapshot.fingerprint,
    applicationId,
    fromVersionId: snapshot.current?.version_id ?? null,
    target: snapshot.target,
    generation: (snapshot.current?.generation ?? 0) + 1,
    currentStage: snapshot.application.stage,
    unresolvedObjections: snapshot.counts.objections,
    paidFees: snapshot.counts.paid,
    effect:
      "Every required step starts again. New consensus notices receive a full response window after sending. Existing objections remain blocking. Old payments remain recorded for staff handling and do not pay the new requirement. An application on hold stays on hold.",
  });
}
export async function migrateMembershipWorkflow(
  db: DatabaseLike,
  applicationId: string,
  actor: UserBackedAuthAdmin,
  input: z.infer<typeof membershipWorkflowMigrationSchema>,
) {
  const snapshot = await migrationSnapshot(db, applicationId, input.versionId);
  if (snapshot.fingerprint !== input.previewFingerprint || !input.acknowledgeRestart)
    throw new AppError(
      409,
      "MEMBERSHIP_MIGRATION_PREVIEW_CHANGED",
      "The application or its evidence changed. Review a fresh preview.",
    );
  const { application, target, category, current, counts } = snapshot;
  const generation = (current?.generation ?? 0) + 1;
  const now = nowIso();
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "membership:approve" }]),
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM member_applications application JOIN membership_application_workflows workflow
          ON workflow.application_id = application.id AND workflow.superseded_at IS NULL
          WHERE application.id = ? AND application.stage = ? AND application.transition_revision = ?
            AND workflow.generation = ? AND workflow.revision = ?`,
        bindings: [
          applicationId,
          application.stage,
          application.transition_revision,
          current.generation,
          current.revision,
        ],
      }),
      db
        .prepare(
          "UPDATE membership_application_workflows SET superseded_at = ?, next_evaluation_at = NULL WHERE application_id = ? AND superseded_at IS NULL",
        )
        .bind(now, applicationId),
      ...prepareMembershipWorkflowPin(db, applicationId, category, target, generation, now, true),
      db
        .prepare(
          "UPDATE membership_fee_intents SET handling_required = 1, updated_at = ? WHERE application_id = ? AND status = 'paid'",
        )
        .bind(now, applicationId),
      db
        .prepare(
          "UPDATE member_applications SET stage = ?, stage_entered_at = ?, transition_revision = transition_revision + 1, updated_at = ? WHERE id = ?",
        )
        .bind(application.stage === "on_hold" ? "on_hold" : "processing", now, now, applicationId),
      db
        .prepare(
          "INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          uuid(),
          applicationId,
          application.stage,
          application.stage === "on_hold" ? "on_hold" : "processing",
          actor.id,
          input.reason,
          now,
        ),
      prepareAuditLog(
        db,
        "user",
        actor.id,
        "membership_workflow_migrated",
        "member_application",
        applicationId,
        {
          fromVersionId: current?.version_id ?? null,
          toVersionId: target.id,
          generation,
          reason: input.reason,
          evidenceRestarted: true,
          preservedCounts: counts,
        },
        now,
      ),
    ]);
  } catch (error) {
    workflowWriteConflict(error);
  }
  return { applicationId, versionId: target.id, generation };
}
