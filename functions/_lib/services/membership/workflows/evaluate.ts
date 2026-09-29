import {
  evaluateMembershipRequirement,
  evaluateMembershipWorkflow,
} from "../../../../../assets/shared/membership-workflow-evaluation";
import { isApplicationTerminalStage } from "../../../../../assets/shared/schemas/member-applications";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../../db/authorization-guard";
import { AppError } from "../../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../../types";
import { uuid } from "../../../utils/ids";
import { nowIso } from "../../../utils/time";
import { isAuditChangeGuardFailure, prepareAuditLogAfterOneChange } from "../../audit";
import { buildApplicationApproval } from "../applications/provision-application";
import { getMembershipExecution, membershipStepEvidence, type MembershipExecution } from "./execution";
import { prepareOpenMembershipStep } from "./open-step";

export interface MembershipWorkflowCommand {
  statements: StatementLike[];
  actor: AuthAdmin | null;
  actorUserId: string | null;
  reason: string;
}

/** Every evidence change, step advance, provisioning write, and durable effect commits together. */
export async function commitMembershipWorkflow(
  db: DatabaseLike,
  execution: MembershipExecution,
  appBaseUrl: string,
  command: MembershipWorkflowCommand,
  now = nowIso(),
) {
  const application = execution.application;
  if (isApplicationTerminalStage(application.stage))
    throw new AppError(409, "MEMBERSHIP_APPLICATION_CLOSED", "This application is already closed");
  const held = application.stage === "on_hold";
  const evidence = membershipStepEvidence(execution);
  const evaluation = evaluateMembershipWorkflow(execution.version.definition, evidence, execution.objections, now);
  const readyToProvision = evaluation.readyToProvision && !held;
  const currentPosition = held ? execution.currentPosition : evaluation.currentPosition;
  const updates: StatementLike[] = [...command.statements];
  if (!held) {
    for (let position = 0; position < execution.version.definition.steps.length; position++) {
      const step = execution.version.definition.steps[position];
      const row = execution.steps[position];
      if (row.completed_at || row.state !== "active" || step.kind !== "consensus") continue;
      const requirement = evaluateMembershipRequirement(step, evidence[position], false, now);
      if (!requirement.openedAt) continue;
      // Provider acceptance can race a webhook changing delivery state. Recheck the exact notice evidence.
      updates.push(
        prepareAuthorizationGuard(db, {
          sql: "SELECT 1 FROM email_outbox WHERE id = ? AND sent_at = ? AND status IN ('sent', 'delivered')",
          bindings: [row.notice_outbox_id, requirement.openedAt],
        }),
      );
      if (row.opened_at !== requirement.openedAt || row.deadline_at !== requirement.deadlineAt) {
        updates.push(
          db
            .prepare(
              `UPDATE membership_application_steps SET opened_at = ?, deadline_at = ?
          WHERE application_id = ? AND generation = ? AND position = ?`,
            )
            .bind(requirement.openedAt, requirement.deadlineAt, application.id, execution.generation, position),
        );
      }
    }
    for (const position of evaluation.completedPositions) {
      updates.push(
        db
          .prepare(
            `UPDATE membership_application_steps SET state = 'complete', completed_at = ?, completion_reason = ?
        WHERE application_id = ? AND generation = ? AND position = ? AND completed_at IS NULL`,
          )
          .bind(now, command.reason, application.id, execution.generation, position),
      );
    }
    updates.push(...(await prepareOpenMembershipStep(db, execution, currentPosition, appBaseUrl, now)));
  }
  const currentStep = execution.version.definition.steps[currentPosition];
  const currentRow = execution.steps[currentPosition];
  const nextEvaluation =
    held || readyToProvision || !currentStep
      ? null
      : currentStep.kind === "consensus" && !evaluation.deadlineAt
        ? new Date(Date.parse(now) + 300_000).toISOString()
        : evaluation.deadlineAt && evaluation.deadlineAt > now
          ? evaluation.deadlineAt
          : null;
  const evidenceChanged =
    command.statements.length > 0 ||
    evaluation.completedPositions.length > 0 ||
    currentPosition !== execution.currentPosition ||
    currentRow?.state === "waiting" ||
    execution.steps.some((row, position) => {
      const step = execution.version.definition.steps[position];
      if (step.kind !== "consensus" || row.state !== "active" || row.completed_at) return false;
      const requirement = evaluateMembershipRequirement(step, evidence[position], false, now);
      return (
        requirement.openedAt !== null &&
        (row.opened_at !== requirement.openedAt || row.deadline_at !== requirement.deadlineAt)
      );
    });
  const snapshot = prepareAuthorizationGuard(db, {
    sql: `SELECT 1 FROM member_applications application JOIN membership_application_workflows workflow ON workflow.application_id = application.id
      WHERE application.id = ? AND application.stage = ? AND application.transition_revision = ?
        AND workflow.generation = ? AND workflow.revision = ? AND workflow.superseded_at IS NULL`,
    bindings: [
      application.id,
      application.stage,
      application.transition_revision,
      execution.generation,
      execution.revision,
    ],
  });
  if (!evidenceChanged && !readyToProvision) {
    await db.batch([
      snapshot,
      db
        .prepare(
          `UPDATE membership_application_workflows SET next_evaluation_at = ?
      WHERE application_id = ? AND generation = ? AND revision = ? AND superseded_at IS NULL`,
        )
        .bind(nextEvaluation, application.id, execution.generation, execution.revision),
    ]);
    return { approved: false, outboxIds: [], approval: null };
  }
  const statements: StatementLike[] = [snapshot];
  let approval: Awaited<ReturnType<typeof buildApplicationApproval>> | null = null;
  if (readyToProvision) {
    updates.push(
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM membership_application_objections WHERE application_id = ? AND state IN ('unresolved', 'upheld'))",
        bindings: [application.id],
      }),
    );
    approval = await buildApplicationApproval(db, application, {
      actor: command.actor,
      eventNote: "All requirements in the pinned membership workflow are satisfied",
      loginUrl: `${appBaseUrl}/portal/`,
      sendOrgContactAssignedEmail: true,
    });
  } else {
    statements.push(
      db
        .prepare(
          `UPDATE member_applications SET stage_entered_at = CASE WHEN stage <> ? THEN ? ELSE stage_entered_at END,
          stage = ?, transition_revision = transition_revision + 1, updated_at = ?
        WHERE id = ? AND stage = ? AND transition_revision = ?`,
        )
        .bind(
          held ? "on_hold" : "processing",
          now,
          held ? "on_hold" : "processing",
          now,
          application.id,
          application.stage,
          application.transition_revision,
        ),
      prepareAuditLogAfterOneChange(
        db,
        command.actorUserId ? "user" : "system",
        command.actorUserId,
        "membership_workflow_evaluated",
        "member_application",
        application.id,
        {
          reason: command.reason,
          versionId: execution.version.id,
          currentPosition,
          blocker: held ? "Application on hold" : evaluation.blocker,
        },
        now,
      ),
    );
  }
  if (!readyToProvision && !held && application.stage !== "processing") {
    updates.push(
      db
        .prepare(
          "INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at) VALUES (?, ?, ?, 'processing', ?, ?, ?)",
        )
        .bind(
          uuid(),
          application.id,
          application.stage,
          command.actorUserId,
          "Started the pinned membership workflow",
          now,
        ),
    );
  }
  statements.push(
    ...updates,
    db
      .prepare(
        `UPDATE membership_application_workflows SET current_position = ?, revision = revision + 1, next_evaluation_at = ?
      WHERE application_id = ? AND generation = ? AND revision = ? AND superseded_at IS NULL`,
      )
      .bind(currentPosition, nextEvaluation, application.id, execution.generation, execution.revision),
    ...(approval?.statements ?? []),
  );
  try {
    await db.batch(statements);
  } catch (error) {
    if (
      isAuthorizationGuardFailure(error) ||
      isAuditChangeGuardFailure(error) ||
      (error instanceof Error && error.message.includes("member_application_events.to_stage"))
    ) {
      throw new AppError(
        409,
        "MEMBERSHIP_WORKFLOW_CHANGED",
        "The application, review evidence, or your eligibility changed. Reload and retry.",
      );
    }
    throw error;
  }
  return {
    approved: readyToProvision,
    outboxIds: approval?.result.outboxIds ?? [],
    approval: approval?.result ?? null,
  };
}
export async function evaluateMembershipApplication(db: DatabaseLike, applicationId: string, appBaseUrl: string) {
  const execution = await getMembershipExecution(db, applicationId);
  if (isApplicationTerminalStage(execution.application.stage) || execution.application.stage === "on_hold")
    return { approved: false, outboxIds: [], approval: null };
  return commitMembershipWorkflow(db, execution, appBaseUrl, {
    statements: [],
    actor: null,
    actorUserId: null,
    reason: "Re-evaluate required membership evidence",
  });
}
