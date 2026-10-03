import { preparePermissionsAuthorizationGuard } from "../../../auth/permissions";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import { first } from "../../../db/queries";
import { AppError } from "../../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../../types";
import { nowIso } from "../../../utils/time";
import { prepareAuditLogAfterOneChange } from "../../audit";
import { getMembershipExecution } from "../workflows/execution";

export function prepareApplicationImportActivationGuard(db: DatabaseLike, applicationId: string) {
  return prepareAuthorizationGuard(db, {
    sql: "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM membership_application_sources WHERE application_id = ? AND activated_at IS NULL)",
    bindings: [applicationId],
  });
}
export async function applicationImportPending(db: DatabaseLike, applicationId: string) {
  return Boolean(
    await first<{ id: string }>(
      db,
      "SELECT id FROM membership_application_sources WHERE application_id = ? AND activated_at IS NULL",
      [applicationId],
    ),
  );
}

/** Cutover is audited separately; activation never advances a step or sends a source notice. */
export async function activateImportedApplication(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  applicationId: string,
  reason: string,
  releaseManualHold = false,
) {
  if (reason.trim().length < 10)
    throw new AppError(
      422,
      "IMPORT_ACTIVATION_REASON_REQUIRED",
      "Record the reconciliation and processing ownership decision",
    );
  const execution = await getMembershipExecution(db, applicationId);
  const now = nowIso();
  if (execution.application.stage === "on_hold" && !releaseManualHold)
    throw new AppError(
      409,
      "IMPORT_MANUAL_HOLD",
      "Keep this application held until an explicit release instruction is reconciled",
    );
  const current = execution.steps[execution.currentPosition];
  if (
    !current ||
    execution.steps.slice(0, execution.currentPosition).some((step) => !step.completed_at) ||
    execution.objections.length
  )
    throw new AppError(
      409,
      "IMPORT_RECONCILIATION_REQUIRED",
      "Reconcile preceding requirements and every unresolved objection before activation",
    );
  const definition = execution.version.definition.steps[execution.currentPosition];
  if (
    definition.kind === "consensus" &&
    (!current.source_notice_opened_at || !current.source_notice_deadline_at || current.source_notice_deadline_at <= now)
  )
    throw new AppError(
      409,
      "IMPORT_REVIEW_TIMING_REQUIRED",
      "Reconcile the source notice and remaining review window before activation; an elapsed deadline is not an approval",
    );
  await db.batch([
    preparePermissionsAuthorizationGuard(db, actor, [{ permission: "membership:approve" }]),
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM member_applications application JOIN membership_application_workflows workflow ON workflow.application_id = application.id WHERE application.id = ? AND application.transition_revision = ? AND workflow.revision = ? AND workflow.generation = ? AND workflow.superseded_at IS NULL",
      bindings: [applicationId, execution.application.transition_revision, execution.revision, execution.generation],
    }),
    db
      .prepare(
        "UPDATE membership_application_sources SET activated_at = ?, activated_by_user_id = ?, activation_note = ? WHERE application_id = ? AND activated_at IS NULL",
      )
      .bind(now, actor.id, reason, applicationId),
    prepareAuditLogAfterOneChange(
      db,
      "admin",
      actor.id,
      "membership_application_import_activated",
      "member_application",
      applicationId,
      { reason, processingOwner: "portal" },
      now,
    ),
    ...(releaseManualHold
      ? [
          db
            .prepare(
              "UPDATE member_applications SET stage = 'processing', on_hold_subtype = NULL, stage_entered_at = ?, updated_at = ?, transition_revision = transition_revision + 1 WHERE id = ? AND stage = 'on_hold'",
            )
            .bind(now, now, applicationId),
          db
            .prepare(
              "INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at) VALUES (?, ?, 'on_hold', 'processing', ?, ?, ?)",
            )
            .bind(crypto.randomUUID(), applicationId, actor.id, reason, now),
        ]
      : []),
    db
      .prepare(
        "UPDATE membership_application_workflows SET next_evaluation_at = ?, revision = revision + 1 WHERE application_id = ? AND superseded_at IS NULL",
      )
      .bind(now, applicationId),
  ]);
}
