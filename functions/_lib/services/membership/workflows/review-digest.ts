import type { MembershipWorkflowStep } from "../../../../../assets/shared/schemas/membership-workflows";
import { membershipReviewDigestSendAt } from "../../../../../assets/shared/membership-review-notifications";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import { prepareQueueEmailStatement } from "../../../email/outbox";
import { emailPlainText } from "../../../email/plain-text";
import type { DatabaseLike } from "../../../types";
import { sha256Hex } from "../../../utils/crypto";
import { stringifyJson } from "../../../utils/json";
import type { MembershipExecution } from "./execution";
import { membershipReviewDigestSnapshot } from "./review-digest-snapshot";
import { MEMBERSHIP_REVIEW_DIGEST_CONTENT_SQL } from "./review-digest-content";

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
  const reviewUrl = `${appBaseUrl}/portal/#/membership/applications/${encodeURIComponent(application.id)}/review`;
  const snapshot = await membershipReviewDigestSnapshot(db, application, reviewUrl, objections);
  const queued = prepareQueueEmailStatement(
    db,
    {
      outboxId: id,
      idempotencyKey: `membership-review-digest:${hash}`,
      templateKey: "membership-workflow-review-digest",
      recipientEmail,
      subject: `${step.label}: membership applications — ${now.slice(0, 10)} UTC`,
      messageType: "transactional",
      sendAt,
      data: {
        reviewDate: now.slice(0, 10),
        isMemberConsultation: step.audience.kind === "active_voting_members",
        isExecutiveCouncil: step.audience.kind === "executive_council",
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
      // An empty digest cancelled by a restart can collect new reviews again.
      db
        .prepare(
          `UPDATE email_outbox SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'cancelled'
          AND send_after > strftime('%Y-%m-%dT%H:%M:%fZ','now')
          AND json_type(payload_json, '$.reviewApplications') = 'object'
          AND NOT EXISTS (SELECT 1 FROM json_each(payload_json, '$.reviewApplications'))`,
        )
        .bind(now, id),
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
            SELECT ${MEMBERSHIP_REVIEW_DIGEST_CONTENT_SQL}
            FROM updated
          ), updated_at = ? WHERE id = ?`,
        )
        // A restart before dispatch replaces this application's old snapshot.
        .bind(`$.reviewApplications."${application.id}"`, stringifyJson(snapshot), id, now, id),
    ],
  };
}
