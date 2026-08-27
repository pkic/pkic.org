/**
 * Scheduled membership-workflow jobs. Two run on
 * dedicated Mon/Wed cron triggers (see functions/router.ts). On-hold
 * reminders/auto-close, EC-window auto-approve, and Google Groups queue
 * processing each have a separate 15-minute cron invocation so one lane
 * cannot consume another lane's D1 statement budget.
 */
import { all } from "../../db/queries";
import { hasD1QueryCapacity, type D1QueryBudget } from "../../db/query-budget";
import { isAppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { getConfig } from "../../config";
import {
  prepareQueueEmailStatement,
  prepareQueueEmailStatementWhen,
  processOutboxByIdBackground,
} from "../../email/outbox";
import { getMembershipSettings } from "../membership-settings";
import { prepareApplicationStageTransition } from "./applications/transition";
import { runOnHoldReminders } from "./on-hold-reminders";
import type { MemberApplicationRow } from "./applications/queries";
import { approveApplication } from "./applications/approve";
import { drainGoogleGroupsEnrollmentNotificationIntents, processGoogleGroupsSyncQueue } from "../google-groups";
import { buildConsultationBatchEmail, buildEcReviewBatchEmail } from "./notifications";
import { logInfo } from "../../logging";
import type { DatabaseLike, Env } from "../../types";
import { isAuditOneChangeGuardFailure, prepareAuditLogAfterOneChange } from "../audit";
import { buildManagementLink } from "../management-links";

// ── Consultation batch (Mon/Wed 07:15 UTC) ─────────────────────

type ConsultationApplicationRow = Pick<
  MemberApplicationRow,
  "id" | "applicant_email" | "applicant_name" | "organization_name" | "membership_category" | "transition_revision"
>;

type EcReviewCandidateRow = Pick<
  MemberApplicationRow,
  | "id"
  | "applicant_email"
  | "applicant_name"
  | "organization_name"
  | "membership_category"
  | "stage"
  | "stage_entered_at"
  | "transition_revision"
  | "on_hold_reminder_sent_at"
>;

export const CONSULTATION_BATCH_DUE_QUERY = `
  SELECT id, applicant_email, applicant_name, organization_name, membership_category, transition_revision
  FROM member_applications
  WHERE stage = 'in_consultation' AND consultation_notified_at IS NULL
  ORDER BY stage_entered_at ASC, id ASC
  LIMIT ?`;

export async function runConsultationBatch(
  db: DatabaseLike,
  env: Env,
  limit = getConfig(env).scheduledConsultationBatchLimit,
): Promise<{ applicationsNotified: number }> {
  const settings = await getMembershipSettings(db);
  const applications = await all<ConsultationApplicationRow>(db, CONSULTATION_BATCH_DUE_QUERY, [limit]);
  if (applications.length === 0) {
    return { applicationsNotified: 0 };
  }

  const now = nowIso();
  // Claim precisely the snapshot that supplied the email content. An admin
  // edit increments transition_revision; without this predicate a queued
  // batch could mark an edited application notified while emailing stale
  // applicant, organization, or category details. One JSON binding avoids
  // D1's 100-parameter limit while preserving the all-or-nothing changes()
  // guard below.
  const applicationIds = applications.map((application) => application.id);
  const selectedApplications = JSON.stringify(
    applications.map(({ id, transition_revision }) => ({ id, transitionRevision: transition_revision })),
  );
  const markNotified = db
    .prepare(
      `UPDATE member_applications
       SET consultation_notified_at = ?, updated_at = ?
       WHERE stage = 'in_consultation'
         AND consultation_notified_at IS NULL
         AND EXISTS (
           SELECT 1
           FROM json_each(?) AS selected
           WHERE json_extract(selected.value, '$.id') = member_applications.id
             AND json_extract(selected.value, '$.transitionRevision') = member_applications.transition_revision
         )`,
    )
    .bind(now, now, selectedApplications);
  const queued = prepareQueueEmailStatementWhen(
    db,
    buildConsultationBatchEmail({
      recipientEmail: settings.consultation_email_recipients,
      applications: applications.map((a) => ({
        applicantEmail: a.applicant_email,
        organizationName: a.organization_name ?? a.applicant_name,
        membershipCategory: a.membership_category,
      })),
    }),
    { sql: "SELECT 1 WHERE changes() = ?", bindings: [applications.length] },
    now,
  );

  try {
    await db.batch([
      markNotified,
      queued.statement,
      prepareAuditLogAfterOneChange(
        db,
        "system",
        null,
        "consultation_batch_queued",
        "member_application_batch",
        null,
        { applicationIds },
        now,
      ),
    ]);
  } catch (error) {
    // Another scheduled/manual invocation claimed at least one of the same
    // stage entries. The guard rolls the partial marker update back, so the
    // next bounded pass can safely retry the remaining entries.
    if (isAuditOneChangeGuardFailure(error)) {
      return { applicationsNotified: 0 };
    }
    throw error;
  }
  await processOutboxByIdBackground(db, env, queued.id);

  return { applicationsNotified: applications.length };
}

// ── EC review batch (Mon/Wed 08:15 UTC) ────────────────────────
// Collects applications that have been in_consultation for 7+ days
// (configurable), transitions them to ec_review, and notifies the EC.

export async function runEcReviewBatch(db: DatabaseLike, env: Env, limit = 100): Promise<{ transitioned: number }> {
  const settings = await getMembershipSettings(db);
  const cutoff = new Date(Date.now() - settings.consultation_window_days * 86_400_000).toISOString();
  const candidates = await all<EcReviewCandidateRow>(
    db,
    `SELECT id, applicant_email, applicant_name, organization_name, membership_category,
            stage, stage_entered_at, transition_revision, on_hold_reminder_sent_at
     FROM member_applications
     WHERE stage = 'in_consultation' AND stage_entered_at <= ?
     ORDER BY stage_entered_at ASC, id ASC
     LIMIT ?`,
    [cutoff, limit],
  );
  if (candidates.length === 0) {
    return { transitioned: 0 };
  }

  const preparedTransitions = candidates.map((application) =>
    prepareApplicationStageTransition(db, application, {
      applicationId: application.id,
      toStage: "ec_review",
      actor: null,
      note: "Consultation window elapsed",
    }),
  );

  const config = getConfig(env);
  const preparedEmail = prepareQueueEmailStatement(
    db,
    buildEcReviewBatchEmail({
      recipientEmail: settings.ec_email_recipients,
      ecReviewWindowDays: settings.ec_review_window_days,
      applications: candidates.map((a) => ({
        organizationName: a.organization_name ?? a.applicant_name,
        membershipCategory: a.membership_category,
        reviewUrl: buildManagementLink(config.appBaseUrl, { kind: "membership-application", id: a.id }),
      })),
    }),
  );
  // Every stage transition, event, audit entry, and the aggregate EC email
  // intent commits together. If any compare-and-set or outbox write fails,
  // D1 rolls back the complete batch and the cron can retry safely.
  await db.batch([...preparedTransitions.flatMap((transition) => transition.statements), preparedEmail.statement]);
  await processOutboxByIdBackground(db, env, preparedEmail.id);

  return { transitioned: candidates.length };
}

export { ON_HOLD_CLOSURE_DUE_QUERY, ON_HOLD_REMINDER_DUE_QUERY } from "./on-hold-reminders";
export { runOnHoldReminders };

// ── EC window auto-approve (dedicated 15-min cron) ────────────────
// "If the EC window expires with no portal action from any EC member, the
// system auto-approves and logs the reason as auto_approved_no_ec_objection."
// A decline from any EC member halts this — the application stays in
// ec_review, surfaced for staff resolution via the admin endpoints.

interface EcAutoApproveCandidate {
  id: string;
  has_ec_decline: number;
}

export const EC_AUTO_APPROVE_DUE_QUERY = `
  SELECT application.id,
         EXISTS (
           SELECT 1
           FROM ec_decisions decision
           WHERE decision.application_id = application.id
             AND decision.decision = 'decline'
         ) AS has_ec_decline
  FROM member_applications application INDEXED BY idx_member_applications_stage_entered_at
  WHERE application.stage = 'ec_review' AND application.stage_entered_at <= ?
  ORDER BY application.stage_entered_at ASC, application.id ASC
  LIMIT ?`;

const MAX_EC_AUTO_APPROVE_PER_PASS = 25;
const EC_AUTO_APPROVE_SELECTION_STATEMENTS = 2;
/*
 * One approval reads the application/form/provisioning inputs and writes the
 * resulting membership, queue, event, and outbox command. The application
 * pipeline caps and deduplicates requested groups, making 160 a
 * conservative whole-operation reserve. Do not start an approval unless the
 * reserve is available: deferral leaves the application untouched for this
 * lane's next independent cron invocation.
 */
const EC_AUTO_APPROVE_RESERVE_STATEMENTS = 160;

export async function runEcWindowAutoApprove(
  db: DatabaseLike,
  env: Env,
  limit = 100,
  d1QueryBudget?: D1QueryBudget,
): Promise<{ autoApproved: number; heldForDecline: number; deferredForBudget: boolean }> {
  const emptyResult = { autoApproved: 0, heldForDecline: 0, deferredForBudget: false };
  const boundedLimit = Math.max(0, Math.min(MAX_EC_AUTO_APPROVE_PER_PASS, Math.floor(limit)));
  if (boundedLimit === 0) return emptyResult;
  if (!hasD1QueryCapacity(d1QueryBudget, EC_AUTO_APPROVE_SELECTION_STATEMENTS)) {
    return { ...emptyResult, deferredForBudget: true };
  }
  const settings = await getMembershipSettings(db);
  const cutoff = new Date(Date.now() - settings.ec_review_window_days * 86_400_000).toISOString();
  // The correlated EXISTS is served by idx_ec_decisions_application_decision,
  // avoiding one Worker-to-D1 query per overdue application.
  const overdue = await all<EcAutoApproveCandidate>(db, EC_AUTO_APPROVE_DUE_QUERY, [cutoff, boundedLimit]);
  if (overdue.length === 0) {
    return emptyResult;
  }

  let autoApproved = 0;
  let heldForDecline = 0;
  let deferredForBudget = false;
  const config = getConfig(env);

  for (const application of overdue) {
    if (application.has_ec_decline === 1) {
      heldForDecline++;
      continue;
    }

    if (!hasD1QueryCapacity(d1QueryBudget, EC_AUTO_APPROVE_RESERVE_STATEMENTS)) {
      deferredForBudget = true;
      break;
    }

    const loginUrl = `${config.appBaseUrl}/portal/`;
    // approveApplication already commits its outbox rows atomically inside
    // its own db.batch() (P5-02) — enqueue only here, no per-recipient
    // synchronous send loop (PR #1 review §9.1); the shared bounded outbox
    // processor delivers them.
    try {
      await approveApplication(db, {
        applicationId: application.id,
        actor: null,
        approvalMode: "automatic_no_ec_objection",
        eventNote: "auto_approved_no_ec_objection",
        loginUrl,
      });
    } catch (error) {
      // A staff edit or EC decision after the due-row read increments
      // transition_revision. The approval command rolls back fully; a
      // decline is held now, while other changes are re-evaluated next run.
      if (isAppError(error) && error.code === "APPLICATION_EC_DECLINED") {
        heldForDecline++;
        continue;
      }
      if (isAppError(error) && error.code === "APPLICATION_ALREADY_APPROVED") continue;
      throw error;
    }

    autoApproved++;
  }

  return { autoApproved, heldForDecline, deferredForBudget };
}

// ── Google Groups queue processing + mailing-list-enrolled ─

const MAX_GOOGLE_GROUPS_SYNC_PER_PASS = 25;
const GOOGLE_GROUPS_SYNC_RESERVE_HEADROOM_STATEMENTS = 20;

/**
 * The queue processor plus durable notification drain has a conservative
 * upper bound of 3 + 13N D1 statements for N claimed rows: due-list,
 * re-list-and-claim batch, actionable-claim load, recipient/calendar reads,
 * five-statement completion batches, and a bounded three-statement-per-user
 * enrollment drain. The missing-user/failure paths use fewer statements, and
 * the durable desired-state queue admits at most one completed add per row.
 */
function googleGroupsSyncReserveStatements(limit: number): number {
  return 3 + 13 * limit + GOOGLE_GROUPS_SYNC_RESERVE_HEADROOM_STATEMENTS;
}

export async function runGoogleGroupsSyncPass(
  db: DatabaseLike,
  env: Env,
  limit = MAX_GOOGLE_GROUPS_SYNC_PER_PASS,
  d1QueryBudget?: D1QueryBudget,
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  skippedUnconfigured: boolean;
  deferredForBudget: boolean;
}> {
  const boundedLimit = Math.max(0, Math.min(MAX_GOOGLE_GROUPS_SYNC_PER_PASS, Math.floor(limit)));
  const reserveStatements = googleGroupsSyncReserveStatements(boundedLimit);
  if (boundedLimit === 0 || !hasD1QueryCapacity(d1QueryBudget, reserveStatements)) {
    return { processed: 0, succeeded: 0, failed: 0, skippedUnconfigured: false, deferredForBudget: boundedLimit > 0 };
  }
  const result = await processGoogleGroupsSyncQueue(db, env, boundedLimit);
  await drainGoogleGroupsEnrollmentNotificationIntents(db, boundedLimit);

  if (result.skippedUnconfigured) {
    logInfo("membership_scheduled_jobs_google_groups_unconfigured", {});
  }

  return {
    processed: result.processed,
    succeeded: result.succeeded,
    failed: result.failed,
    skippedUnconfigured: result.skippedUnconfigured,
    deferredForBudget: false,
  };
}
