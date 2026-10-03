import { sourceApplicationRequirement } from "../../../../../assets/shared/membership-application-import";
import type {
  ApplicationImportMapping,
  GithubApplicationEvidence,
} from "../../../../../assets/shared/schemas/membership-application-import";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import { AppError } from "../../../errors";
import type { DatabaseLike, StatementLike } from "../../../types";
import { uuid } from "../../../utils/ids";
import { requireMembershipCategory } from "../categories";
import { getMembershipWorkflowVersion } from "../workflows/catalog";
import { prepareMembershipWorkflowPin } from "../workflows/pinning";

export async function prepareImportedWorkflow(
  db: DatabaseLike,
  applicationId: string,
  mapping: ApplicationImportMapping,
  source: GithubApplicationEvidence,
  now: string,
): Promise<StatementLike[]> {
  if (!mapping.categoryCode || !mapping.workflow)
    throw new AppError(
      422,
      "IMPORT_WORKFLOW_REQUIRED",
      "Reconcile the active application's category and workflow before import",
    );
  const category = await requireMembershipCategory(db, mapping.categoryCode);
  const version = await getMembershipWorkflowVersion(db, mapping.workflow.versionId);
  const current = version.definition.steps[mapping.workflow.currentPosition];
  if (!current || version.status !== "published")
    throw new AppError(422, "IMPORT_WORKFLOW_INVALID", "Choose a requirement in a published workflow");
  const requirement = sourceApplicationRequirement(source.issue.labels.map((label) => label.name));
  if (
    requirement &&
    (requirement === "staff_review"
      ? current.kind !== "staff_review"
      : current.kind !== "consensus" || current.audience.kind !== requirement)
  )
    throw new AppError(
      422,
      "IMPORT_REQUIREMENT_MISMATCH",
      "The mapped requirement does not match the current source labels",
    );
  const ids = new Set([...source.comments, ...source.timeline].map((event) => String(event.id)));
  const positions = new Set<number>();
  const statements = prepareMembershipWorkflowPin(db, applicationId, category, version, 0, now, true);
  for (const evidence of mapping.workflow.steps) {
    const step = version.definition.steps[evidence.position];
    if (!step || positions.has(evidence.position) || evidence.evidenceEventIds.some((id) => !ids.has(id)))
      throw new AppError(422, "IMPORT_EVIDENCE_INVALID", "Each mapped requirement needs unique source-backed evidence");
    positions.add(evidence.position);
    if (
      evidence.completedAt &&
      (evidence.completedAt > source.issue.updated_at || evidence.position >= mapping.workflow.currentPosition)
    )
      throw new AppError(
        422,
        "IMPORT_COMPLETION_INVALID",
        "Completed requirements must precede the pending requirement and be backed by existing source evidence",
      );
    if (step.kind === "payment")
      throw new AppError(
        422,
        "IMPORT_PAYMENT_REVIEW_REQUIRED",
        "Reconcile payment through the payment workflow; source text is not verified payment",
      );
    if (
      (evidence.openedAt === null) !== (evidence.deadlineAt === null) ||
      (evidence.openedAt && evidence.deadlineAt! <= evidence.openedAt)
    )
      throw new AppError(
        422,
        "IMPORT_REVIEW_TIMING_INVALID",
        "A source notice needs both its opening time and its later deadline",
      );
    statements.push(
      db
        .prepare(
          `UPDATE membership_application_steps SET state = ?, completed_at = ?, completion_reason = ?, opened_at = ?, deadline_at = ?, source_notice_opened_at = ?, source_notice_deadline_at = ?, source_evidence_json = ? WHERE application_id = ? AND generation = 0 AND position = ?`,
        )
        .bind(
          evidence.completedAt
            ? "complete"
            : evidence.position === mapping.workflow.currentPosition
              ? "active"
              : "waiting",
          evidence.completedAt,
          evidence.completedAt ? mapping.mappingReason : null,
          evidence.openedAt,
          evidence.deadlineAt,
          evidence.openedAt,
          evidence.deadlineAt,
          JSON.stringify(evidence.evidenceEventIds),
          applicationId,
          evidence.position,
        ),
    );
  }
  for (const objection of mapping.workflow.objections) {
    if (!ids.has(objection.evidenceEventId) || !version.definition.steps[objection.position])
      throw new AppError(
        422,
        "IMPORT_OBJECTION_INVALID",
        "An objection needs its source evidence and workflow requirement",
      );
    statements.push(
      db
        .prepare(
          `INSERT INTO membership_application_objections (id, application_id, generation, step_position, body, state, created_at) VALUES (?, ?, 0, ?, ?, 'unresolved', ?)`,
        )
        .bind(uuid(), applicationId, objection.position, objection.body, objection.createdAt),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE membership_application_workflows SET current_position = ?, next_evaluation_at = NULL WHERE application_id = ? AND generation = 0`,
      )
      .bind(mapping.workflow.currentPosition, applicationId),
  );
  statements.push(
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM membership_workflow_versions WHERE id = ? AND published_at IS NOT NULL",
      bindings: [version.id],
    }),
  );
  return statements;
}
