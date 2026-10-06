import type { MembershipWorkflowStep } from "../../../../../assets/shared/schemas/membership-workflows";
import {
  MEMBERSHIP_REVIEW_DIGEST_BODY,
  membershipReviewDigestSendAt,
} from "../../../../../assets/shared/membership-review-notifications";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import { directEmailBodyPayload } from "../../../email/direct-body";
import { escapeMarkdownText } from "../../../email/markdown";
import { prepareQueueEmailStatement } from "../../../email/outbox";
import { emailPlainText } from "../../../email/plain-text";
import type { DatabaseLike } from "../../../types";
import { sha256Hex } from "../../../utils/crypto";
import { stringifyJson } from "../../../utils/json";
import type { MembershipExecution } from "./execution";

/** Append inside the same atomic command that opens the application requirement. */
export async function prepareMembershipReviewDigest(
  db: DatabaseLike,
  execution: MembershipExecution,
  step: Extract<MembershipWorkflowStep, { kind: "consensus" }>,
  recipientEmail: string,
  appBaseUrl: string,
  now: string,
  objections: Array<{ body: string; author: string | null }>,
) {
  const sendAt = membershipReviewDigestSendAt(now);
  // Categories and versions with identical review policy can share a digest.
  // Different audiences, windows, destinations, or instructions cannot.
  const { id: _stepId, ...policy } = step;
  const hash = await sha256Hex(JSON.stringify({ policy, recipientEmail, appBaseUrl, sendAt }));
  const id = hash.slice(0, 32);
  const application = execution.application;
  const name = escapeMarkdownText(application.organization_name ?? application.applicant_name);
  const reviewUrl = `${appBaseUrl}/portal/#/membership/applications/${encodeURIComponent(application.id)}/review`;
  const summary = `- [${name}](${reviewUrl})\n`;
  const objectionDetails = objections.map((objection) => {
    const body =
      objection.body.length > 500
        ? `${objection.body.slice(0, 500)}… Read the full objection on the review page.`
        : objection.body;
    return `> **${escapeMarkdownText(objection.author ?? "Recorded reviewer")}:** ${escapeMarkdownText(body).replace(/\r?\n/g, "\n> ")}`;
  });
  const details = [
    `### ${name}`,
    `Submitted by ${escapeMarkdownText(application.applicant_name)}. Membership category: ${escapeMarkdownText(application.membership_category)}.`,
    ...objectionDetails,
    `[Read the application form and respond](${reviewUrl})`,
    "---",
    "",
  ].join("\n\n");
  const queued = prepareQueueEmailStatement(
    db,
    {
      outboxId: id,
      idempotencyKey: `membership-review-digest:${hash}`,
      templateKey: "membership-workflow-review",
      recipientEmail,
      subject: `${step.label}: membership applications — ${now.slice(0, 10)} UTC`,
      messageType: "transactional",
      sendAt,
      data: {
        ...directEmailBodyPayload(MEMBERSHIP_REVIEW_DIGEST_BODY),
        stepLabel: emailPlainText(step.label),
        instructions: emailPlainText(step.instructions),
        durationDays: step.durationDays,
        applicationSummary: "",
        applicationDetails: "",
        reviewApplications: {},
      },
    },
    now,
  );
  return {
    id,
    statements: [
      queued.statement,
      // A delayed command crossing midnight must retry in the new day's digest.
      // It cannot modify mail already selected by the delivery runner.
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM email_outbox WHERE id = ? AND status = 'queued' AND send_after > strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        bindings: [id],
      }),
      db
        .prepare(
          `WITH updated AS (
            SELECT json_set(payload_json, ?, json(?)) AS payload_json FROM email_outbox WHERE id = ?
          )
          UPDATE email_outbox SET payload_json = (
            SELECT json_set(updated.payload_json,
              '$.applicationSummary', (SELECT group_concat(json_extract(entry.value, '$.summary'), '') FROM json_each(updated.payload_json, '$.reviewApplications') entry),
              '$.applicationDetails', (SELECT group_concat(json_extract(entry.value, '$.details'), '') FROM json_each(updated.payload_json, '$.reviewApplications') entry))
            FROM updated
          ), updated_at = ? WHERE id = ?`,
        )
        // A restart before dispatch replaces this application's old snapshot.
        .bind(`$.reviewApplications."${application.id}"`, stringifyJson({ summary, details }), id, now, id),
    ],
  };
}
