/**
 * Scheduled membership-workflow jobs (PRD §4.3, §4.5, §4.6). Two run on
 * dedicated Mon/Wed cron triggers (see functions/router.ts); the rest
 * (on-hold reminders/auto-close, EC-window auto-approve, Google Groups
 * queue processing) are folded into the existing 15-minute due-work cron
 * (scheduled-due-work.ts) since they're not time-window-sensitive the way
 * the twice-weekly batches are.
 */
import { all, run } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { getConfig } from "../config";
import { queueEmail, processOutboxByIdBackground } from "../email/outbox";
import { getMembershipSettings } from "./membership-settings";
import {
  transitionApplicationStage,
  ON_HOLD_SUBTYPE_EMAIL_TEMPLATES,
  type MemberApplicationRow,
} from "./member-applications";
import { hasEcDecline } from "./ec-review";
import { approveApplication } from "./membership-onboarding";
import { processGoogleGroupsSyncQueue } from "./google-groups";
import { logInfo } from "../logging";
import type { DatabaseLike, Env } from "../types";

function maskEmail(email: string): string {
  const [, domain] = email.split("@");
  return domain ? `***@${domain}` : "***";
}

function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

// ── Consultation batch (Mon/Wed 07:15 UTC, PRD §4.5) ─────────────────────

export async function runConsultationBatch(db: DatabaseLike, env: Env): Promise<{ applicationsNotified: number }> {
  const settings = await getMembershipSettings(db);
  const applications = await all<MemberApplicationRow>(
    db,
    `SELECT * FROM member_applications WHERE stage = 'in_consultation' ORDER BY stage_entered_at ASC`,
  );
  if (applications.length === 0) {
    return { applicationsNotified: 0 };
  }

  const outboxId = await queueEmail(db, {
    templateKey: "consultation-batch",
    recipientEmail: settings.consultation_email_recipients,
    messageType: "transactional",
    subject: `PKI Consortium member consultation — ${applications.length} application(s)`,
    data: {
      applicationCount: applications.length,
      applications: applications.map((a) => ({
        maskedEmail: maskEmail(a.applicant_email),
        organizationName: a.organization_name ?? a.applicant_name,
        membershipCategory: a.membership_category,
      })),
    },
  });
  await processOutboxByIdBackground(db, env, outboxId);

  return { applicationsNotified: applications.length };
}

// ── EC review batch (Mon/Wed 08:15 UTC, PRD §4.6) ────────────────────────
// Collects applications that have been in_consultation for 7+ days
// (configurable), transitions them to ec_review, and notifies the EC.

export async function runEcReviewBatch(db: DatabaseLike, env: Env): Promise<{ transitioned: number }> {
  const settings = await getMembershipSettings(db);
  const cutoff = new Date(Date.now() - settings.consultation_window_days * 86_400_000).toISOString();
  const candidates = await all<MemberApplicationRow>(
    db,
    `SELECT * FROM member_applications WHERE stage = 'in_consultation' AND stage_entered_at <= ? ORDER BY stage_entered_at ASC`,
    [cutoff],
  );
  if (candidates.length === 0) {
    return { transitioned: 0 };
  }

  const transitioned: MemberApplicationRow[] = [];
  for (const application of candidates) {
    const result = await transitionApplicationStage(db, {
      applicationId: application.id,
      toStage: "ec_review",
      actorUserId: null,
      note: "Consultation window elapsed",
    });
    transitioned.push(result.application);
  }

  const config = getConfig(env);
  const outboxId = await queueEmail(db, {
    templateKey: "ec-review-batch",
    recipientEmail: settings.ec_email_recipients,
    messageType: "transactional",
    subject: `PKI Consortium EC review — ${transitioned.length} application(s)`,
    data: {
      applicationCount: transitioned.length,
      ecReviewWindowDays: settings.ec_review_window_days,
      applications: transitioned.map((a) => ({
        organizationName: a.organization_name ?? a.applicant_name,
        membershipCategory: a.membership_category,
        reviewUrl: `${config.appBaseUrl}/admin/#/applications/${a.id}`,
      })),
    },
  });
  await processOutboxByIdBackground(db, env, outboxId);

  return { transitioned: transitioned.length };
}

// ── On-hold reminders & auto-close (folded into the 15-min due-work cron) ─

export async function runOnHoldReminders(
  db: DatabaseLike,
  env: Env,
): Promise<{ remindersSent: number; autoClosed: number }> {
  const settings = await getMembershipSettings(db);
  const onHold = await all<MemberApplicationRow>(db, `SELECT * FROM member_applications WHERE stage = 'on_hold'`);
  if (onHold.length === 0) {
    return { remindersSent: 0, autoClosed: 0 };
  }

  let remindersSent = 0;
  let autoClosed = 0;
  const deadlineDays = settings.on_hold_response_deadline_days;

  for (const application of onHold) {
    const elapsed = daysSince(application.stage_entered_at);

    if (elapsed >= deadlineDays) {
      const result = await transitionApplicationStage(db, {
        applicationId: application.id,
        toStage: "withdrawn",
        actorUserId: null,
        note: "Auto-closed — no response within the on-hold deadline",
      });
      const outboxId = await queueEmail(db, {
        templateKey: "application-closed-no-response",
        recipientEmail: result.application.applicant_email,
        messageType: "transactional",
        subject: "Your PKI Consortium membership application has been closed",
        data: { applicantName: result.application.applicant_name, deadlineDays },
      });
      await processOutboxByIdBackground(db, env, outboxId);
      autoClosed++;
      continue;
    }

    if (!settings.auto_reminder_on_holds) continue;
    if (elapsed < deadlineDays - 3) continue;
    if (!application.on_hold_subtype) continue;

    const alreadyReminded = await all<{ id: string }>(
      db,
      `SELECT id FROM member_application_events WHERE application_id = ? AND note = 'Hold reminder sent' LIMIT 1`,
      [application.id],
    );
    if (alreadyReminded.length > 0) continue;

    const templateKey =
      ON_HOLD_SUBTYPE_EMAIL_TEMPLATES[application.on_hold_subtype as keyof typeof ON_HOLD_SUBTYPE_EMAIL_TEMPLATES];
    if (!templateKey) continue;

    const outboxId = await queueEmail(db, {
      templateKey,
      recipientEmail: application.applicant_email,
      messageType: "transactional",
      subject: "Reminder: action needed on your PKI Consortium membership application",
      data: { applicantName: application.applicant_name, deadlineDays },
    });
    await processOutboxByIdBackground(db, env, outboxId);

    await run(
      db,
      `INSERT INTO member_application_events (id, application_id, from_stage, to_stage, actor_user_id, note, created_at) VALUES (?, ?, ?, ?, NULL, 'Hold reminder sent', ?)`,
      [uuid(), application.id, application.stage, application.stage, nowIso()],
    );
    remindersSent++;
  }

  return { remindersSent, autoClosed };
}

// ── EC window auto-approve (folded into the 15-min due-work cron, §4.6) ──
// "If the EC window expires with no portal action from any EC member, the
// system auto-approves and logs the reason as auto_approved_no_ec_objection."
// A decline from any EC member halts this — the application stays in
// ec_review, surfaced for staff resolution via the admin endpoints.

export async function runEcWindowAutoApprove(
  db: DatabaseLike,
  env: Env,
): Promise<{ autoApproved: number; heldForDecline: number }> {
  const settings = await getMembershipSettings(db);
  const cutoff = new Date(Date.now() - settings.ec_review_window_days * 86_400_000).toISOString();
  const overdue = await all<MemberApplicationRow>(
    db,
    `SELECT * FROM member_applications WHERE stage = 'ec_review' AND stage_entered_at <= ?`,
    [cutoff],
  );
  if (overdue.length === 0) {
    return { autoApproved: 0, heldForDecline: 0 };
  }

  let autoApproved = 0;
  let heldForDecline = 0;
  const config = getConfig(env);

  for (const application of overdue) {
    if (await hasEcDecline(db, application.id)) {
      heldForDecline++;
      continue;
    }

    const result = await approveApplication(db, {
      applicationId: application.id,
      actorUserId: null,
      eventNote: "auto_approved_no_ec_objection",
    });

    const loginUrl = `${config.appBaseUrl}/portal/`;
    const claimOutboxId = await queueEmail(db, {
      templateKey: "member-account-claim",
      recipientEmail: result.email,
      messageType: "transactional",
      subject: "Set up your PKI Consortium member account",
      data: { memberName: result.name, loginUrl },
    });
    await processOutboxByIdBackground(db, env, claimOutboxId);

    const welcomeOutboxId = await queueEmail(db, {
      templateKey: "application-approved-welcome",
      recipientEmail: result.email,
      messageType: "transactional",
      subject: "Welcome to the PKI Consortium!",
      data: { applicantName: result.name, loginUrl, workingGroups: result.workingGroupNames.join(", ") },
    });
    await processOutboxByIdBackground(db, env, welcomeOutboxId);

    autoApproved++;
  }

  return { autoApproved, heldForDecline };
}

// ── Google Groups queue processing + mailing-list-enrolled (§4.7 item 7) ─

export async function runGoogleGroupsSyncPass(
  db: DatabaseLike,
  env: Env,
): Promise<{ succeeded: number; failed: number }> {
  const result = await processGoogleGroupsSyncQueue(db, env);

  for (const [userId, groupEmails] of Object.entries(result.completedAddsByUser)) {
    const user = await all<{ email: string; first_name: string | null; last_name: string | null }>(
      db,
      `SELECT email, first_name, last_name FROM users WHERE id = ?`,
      [userId],
    );
    const row = user[0];
    if (!row) continue;

    const outboxId = await queueEmail(db, {
      templateKey: "mailing-list-enrolled",
      recipientEmail: row.email,
      messageType: "transactional",
      subject: "You have been added to PKI Consortium mailing lists",
      data: {
        memberName: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
        lists: groupEmails,
      },
    });
    await processOutboxByIdBackground(db, env, outboxId);
  }

  if (result.skippedUnconfigured) {
    logInfo("membership_scheduled_jobs_google_groups_unconfigured", {});
  }

  return { succeeded: result.succeeded, failed: result.failed };
}

// ── Combined 15-minute due-work pass ──────────────────────────────────────
//
// Called as a sibling to runScheduledDueWork (scheduled-due-work.ts) from
// the same REMINDER_CRON trigger, rather than woven into that function's
// own multi-pass time/subrequest-budgeted loop — that loop's budgeting
// logic is intricate and already covers a lot of surface area (registration
// reminders, waitlist promotion, RSVP enforcement); adding membership work
// as a second, independent top-level call keeps this phase's additions
// isolated from that existing logic instead of risking it. See
// functions/router.ts.
export interface MembershipDueWorkResult {
  onHoldReminders: Awaited<ReturnType<typeof runOnHoldReminders>>;
  ecAutoApprove: Awaited<ReturnType<typeof runEcWindowAutoApprove>>;
  googleGroupsSync: Awaited<ReturnType<typeof runGoogleGroupsSyncPass>>;
}

export async function runMembershipDueWork(db: DatabaseLike, env: Env): Promise<MembershipDueWorkResult> {
  const onHoldReminders = await runOnHoldReminders(db, env);
  const ecAutoApprove = await runEcWindowAutoApprove(db, env);
  const googleGroupsSync = await runGoogleGroupsSyncPass(db, env);
  return { onHoldReminders, ecAutoApprove, googleGroupsSync };
}
