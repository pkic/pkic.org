import type { MembershipWorkflowVersion } from "../../../../../assets/shared/schemas/membership-workflows";
import type {
  MembershipObjectionEvidence,
  MembershipStepEvidence,
} from "../../../../../assets/shared/membership-workflow-evaluation";
import { all, first } from "../../../db/queries";
import { AppError } from "../../../errors";
import type { DatabaseLike } from "../../../types";
import { getMemberApplicationById, type MemberApplicationRow } from "../applications/queries";
import { getMembershipWorkflowVersion } from "./catalog";

export interface MembershipExecutionStep {
  position: number;
  step_id: string;
  state: string;
  notice_outbox_id: string | null;
  opened_at: string | null;
  deadline_at: string | null;
  completed_at: string | null;
  completed_by_user_id: string | null;
  completion_reason: string | null;
  notice_sent_at: string | null;
  notice_status: string | null;
  fee_id: string | null;
  fee_status: string | null;
  fee_paid_at: string | null;
  fee_deadline_at: string | null;
  fee_handling_required: number | null;
  checkout_url: string | null;
  checkout_expires_at: string | null;
}
export interface MembershipExecution {
  application: MemberApplicationRow;
  version: MembershipWorkflowVersion;
  generation: number;
  revision: number;
  currentPosition: number;
  steps: MembershipExecutionStep[];
  objections: MembershipObjectionEvidence[];
  referenceLabels: Record<string, string>;
}

export async function getMembershipExecution(db: DatabaseLike, applicationId: string): Promise<MembershipExecution> {
  const application = await getMemberApplicationById(db, applicationId);
  if (!application) throw new AppError(404, "APPLICATION_NOT_FOUND", "Application not found");
  const execution = await first<{ generation: number; version_id: string; revision: number; current_position: number }>(
    db,
    `SELECT generation, version_id, revision, current_position FROM membership_application_workflows WHERE application_id = ? AND superseded_at IS NULL`,
    [applicationId],
  );
  if (!execution)
    throw new AppError(
      409,
      "MEMBERSHIP_WORKFLOW_MISSING",
      "This application is missing its required pinned workflow. Contact staff before continuing.",
    );
  const version = await getMembershipWorkflowVersion(db, execution.version_id);
  const steps = await all<MembershipExecutionStep>(
    db,
    `SELECT step.position, step.step_id, step.state, step.notice_outbox_id,
    step.opened_at, step.deadline_at, step.completed_at, step.completed_by_user_id, step.completion_reason,
    notice.sent_at AS notice_sent_at, notice.status AS notice_status,
    fee.id AS fee_id, fee.status AS fee_status, fee.paid_at AS fee_paid_at, fee.deadline_at AS fee_deadline_at,
    fee.handling_required AS fee_handling_required, fee.checkout_url, checkout.expires_at AS checkout_expires_at
    FROM membership_application_steps step
    LEFT JOIN email_outbox notice ON notice.id = step.notice_outbox_id
    LEFT JOIN membership_fee_intents fee ON fee.application_id = step.application_id AND fee.generation = step.generation AND fee.step_position = step.position
      AND fee.version_id = ? AND fee.category_code = ?
    LEFT JOIN membership_fee_checkouts checkout ON checkout.provider_session_id = fee.checkout_session_id
    WHERE step.application_id = ? AND step.generation = ? ORDER BY step.position LIMIT 8`,
    [version.id, application.membership_category, applicationId, execution.generation],
  );
  if (
    steps.length !== version.definition.steps.length ||
    steps.some((step, index) => step.step_id !== version.definition.steps[index].id || step.position !== index)
  ) {
    throw new AppError(
      409,
      "MEMBERSHIP_WORKFLOW_EVIDENCE_INCOMPLETE",
      "The application's required step records are incomplete",
    );
  }
  const objections = await all<{ position: number; unresolved: number }>(
    db,
    `SELECT step_position AS position, 1 AS unresolved
    FROM membership_application_objections WHERE application_id = ? AND state IN ('unresolved', 'upheld')
    GROUP BY step_position ORDER BY step_position LIMIT 8`,
    [applicationId],
  );
  const referenceIds = version.definition.steps.flatMap((step) =>
    step.kind === "staff_review"
      ? step.reviewerGroupId
        ? [step.reviewerGroupId]
        : []
      : step.kind === "consensus"
        ? [
            ...(step.audience.kind === "group" ? [step.audience.groupId] : []),
            ...(step.destination.kind === "mailing_list" ? [step.destination.mailingListId] : []),
          ]
        : [],
  );
  const references = referenceIds.length
    ? await all<{ id: string; label: string }>(
        db,
        `SELECT id, name AS label FROM groups WHERE id IN (${referenceIds.map(() => "?").join(",")})
     UNION ALL SELECT id, label || ' (' || email || ')' AS label FROM mailing_lists WHERE id IN (${referenceIds.map(() => "?").join(",")})`,
        [...referenceIds, ...referenceIds],
      )
    : [];
  return {
    referenceLabels: Object.fromEntries(references.map((reference) => [reference.id, reference.label])),
    application,
    version,
    generation: execution.generation,
    revision: execution.revision,
    currentPosition: execution.current_position,
    steps,
    objections: objections.map((item) => ({ position: item.position, unresolved: true })),
  };
}
export function membershipStepEvidence(execution: MembershipExecution): MembershipStepEvidence[] {
  return execution.steps.map((step) => ({
    completedAt: step.completed_at,
    reviewAccepted: step.completed_at !== null,
    noticeSentAt: step.notice_sent_at,
    noticeStatus: step.notice_status,
    paidAt: step.fee_status === "paid" && step.fee_handling_required === 0 ? step.fee_paid_at : null,
  }));
}
