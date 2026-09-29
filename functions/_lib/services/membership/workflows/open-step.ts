import type { MembershipWorkflowStep } from "../../../../../assets/shared/schemas/membership-workflows";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import { all, first } from "../../../db/queries";
import { prepareQueueEmailStatement } from "../../../email/outbox";
import { emailPlainText } from "../../../email/plain-text";
import { AppError } from "../../../errors";
import type { DatabaseLike, StatementLike } from "../../../types";
import { uuid } from "../../../utils/ids";
import type { MembershipExecution } from "./execution";

/** Create exactly one next-step requirement inside the application's command boundary. */
export async function prepareOpenMembershipStep(
  db: DatabaseLike,
  execution: MembershipExecution,
  position: number,
  appBaseUrl: string,
  now: string,
): Promise<StatementLike[]> {
  const step = execution.version.definition.steps[position];
  if (!step || execution.steps[position]?.state !== "waiting") return [];
  const statements: StatementLike[] = [];
  let noticeId: string | null = null;
  let deadline: string | null = null;
  if (step.kind === "consensus") {
    const destination = await consensusNoticeDestination(db, step);
    if (destination.guard) statements.push(destination.guard);
    const objections = await all<{ body: string; author: string | null }>(
      db,
      `SELECT objection.body, COALESCE(NULLIF(TRIM(COALESCE(author.first_name, '') || ' ' || COALESCE(author.last_name, '')), ''), author.email) AS author
      FROM membership_application_objections objection LEFT JOIN users author ON author.id = objection.author_user_id
      WHERE objection.application_id = ? AND objection.state IN ('unresolved', 'upheld') ORDER BY objection.created_at, objection.id LIMIT 100`,
      [execution.application.id],
    );
    const notice = prepareQueueEmailStatement(
      db,
      {
        outboxId: uuid(),
        idempotencyKey: `membership-review:${execution.application.id}:${execution.generation}:${position}`,
        templateKey: "membership-workflow-review",
        recipientEmail: destination.email,
        subject: `${step.label}: ${execution.application.organization_name ?? execution.application.applicant_name}`,
        messageType: "transactional",
        data: {
          applicationName: emailPlainText(
            execution.application.organization_name ?? execution.application.applicant_name,
          ),
          applicantName: emailPlainText(execution.application.applicant_name),
          stepLabel: emailPlainText(step.label),
          instructions: emailPlainText(step.instructions),
          durationDays: step.durationDays,
          reviewUrl: `${appBaseUrl}/portal/#/membership/applications/${encodeURIComponent(execution.application.id)}/review`,
          objections: objections.map((objection) => ({
            body: emailPlainText(
              objection.body.length > 500
                ? `${objection.body.slice(0, 500)}… Read the full objection on the review page.`
                : objection.body,
            ),
            author: emailPlainText(objection.author ?? "Recorded reviewer"),
          })),
        },
      },
      now,
    );
    noticeId = notice.id;
    statements.push(notice.statement);
  }
  if (step.kind === "payment") {
    const feeId = uuid();
    deadline = new Date(Date.parse(now) + step.deadlineDays * 86400_000).toISOString();
    statements.push(
      db
        .prepare(
          `INSERT INTO membership_fee_intents (id, application_id, generation, step_position, category_code, version_id, fee_reference, amount, currency, deadline_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          feeId,
          execution.application.id,
          execution.generation,
          position,
          execution.application.membership_category,
          execution.version.id,
          step.feeReference,
          step.amount,
          step.currency,
          deadline,
          now,
          now,
        ),
      db.prepare("INSERT INTO membership_fee_checkout_outbox (fee_id, next_attempt_at) VALUES (?, ?)").bind(feeId, now),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE membership_application_steps SET state = 'active', notice_outbox_id = ?, opened_at = ?, deadline_at = ?
    WHERE application_id = ? AND generation = ? AND position = ? AND state = 'waiting'`,
      )
      .bind(
        noticeId,
        step.kind === "consensus" ? null : now,
        deadline,
        execution.application.id,
        execution.generation,
        position,
      ),
  );
  return statements;
}

async function consensusNoticeDestination(
  db: DatabaseLike,
  step: Extract<MembershipWorkflowStep, { kind: "consensus" }>,
) {
  if (step.destination.kind === "external") return { email: step.destination.email, guard: null };
  const listId = step.destination.mailingListId;
  const list = await first<{ email: string }>(
    db,
    "SELECT email FROM mailing_lists WHERE id = ? AND active = 1 AND archived_at IS NULL",
    [listId],
  );
  if (!list)
    throw new AppError(
      409,
      "MEMBERSHIP_NOTICE_LIST_UNAVAILABLE",
      "The workflow's notification list is no longer active. Review its configuration before proceeding.",
    );
  return {
    email: list.email,
    guard: prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM mailing_lists WHERE id = ? AND email = ? AND active = 1 AND archived_at IS NULL",
      bindings: [listId, list.email],
    }),
  };
}
