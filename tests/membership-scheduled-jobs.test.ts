/**
 * membership-scheduled-jobs.test.ts
 *
 * consultation batch, EC review batch, on-hold reminders/
 * auto-close, and EC-window auto-approve
 * (functions/_lib/services/membership/scheduled-jobs.ts). Called directly
 * as service functions rather than through HTTP, matching how these run —
 * cron-triggered, not endpoint-triggered (see functions/router.ts).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import {
  runConsultationBatch,
  runEcReviewBatch,
  runOnHoldReminders,
  runEcWindowAutoApprove,
} from "../functions/_lib/services/membership/scheduled-jobs";
import { getMembershipSettings, updateMembershipSettings } from "../functions/_lib/services/membership-settings";
import { recordEcDecision } from "../functions/_lib/services/ec-review";
import { seedMemberApplication } from "./helpers/member-applications";

async function createApplication(overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const stageAgeDays = /'-(\d+) days'/.exec(String(overrides.stage_entered_at ?? ""))?.[1];
  const id = await seedMemberApplication({
    applicantEmail: (overrides.applicant_email as string) ?? "applicant@example.test",
    applicantName: (overrides.applicant_name as string) ?? "Applicant Name",
    organizationName: null,
    organizationDomain: null,
    membershipCategory: (overrides.membership_category as string) ?? "H6",
    formSubmissionId: (overrides.form_submission_id as string) ?? null,
    stage: (overrides.stage as string) ?? "in_consultation",
    stageEnteredAt: stageAgeDays
      ? new Date(Date.now() - Number(stageAgeDays) * 86_400_000).toISOString()
      : new Date().toISOString(),
  });
  if (overrides.on_hold_subtype) {
    await env.DB.prepare("UPDATE member_applications SET on_hold_subtype = ? WHERE id = ?")
      .bind(overrides.on_hold_subtype, id)
      .run();
  }
  return { id };
}

describe("Membership scheduled jobs", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("consultation batch notifies the configured recipient and does nothing when no applications are in consultation", async () => {
    const empty = await runConsultationBatch(env.DB, env as any);
    expect(empty.applicationsNotified).toBe(0);

    await createApplication({ stage: "in_consultation" });
    const result = await runConsultationBatch(env.DB, env as any);
    expect(result.applicationsNotified).toBe(1);

    const outbox = await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'consultation-batch'");
    expect(outbox).toHaveLength(1);
  });

  it("advances through bounded consultation batches without repeating or starving applications", async () => {
    for (let i = 0; i < 3; i++) {
      await createApplication({
        stage: "in_consultation",
        applicant_email: `consultation-${i}@example.test`,
      });
    }

    const configuredEnv = { ...env, SCHEDULED_CONSULTATION_BATCH_LIMIT: "2" } as any;
    const first = await runConsultationBatch(env.DB, configuredEnv);
    const second = await runConsultationBatch(env.DB, configuredEnv);
    const complete = await runConsultationBatch(env.DB, configuredEnv);

    expect(first.applicationsNotified).toBe(2);
    expect(second.applicationsNotified).toBe(1);
    expect(complete.applicationsNotified).toBe(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'consultation-batch'"),
    ).toHaveLength(2);
    expect(
      await queryAll(
        env.DB,
        `SELECT id FROM member_applications
         WHERE stage = 'in_consultation' AND consultation_notified_at IS NULL`,
      ),
    ).toHaveLength(0);
  });

  it("queues a consultation stage entry at most once under concurrent runners", async () => {
    await createApplication({ stage: "in_consultation" });

    const results = await Promise.all([
      runConsultationBatch(env.DB, env as any),
      runConsultationBatch(env.DB, env as any),
    ]);

    expect(results.reduce((total, result) => total + result.applicationsNotified, 0)).toBe(1);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'consultation-batch'"),
    ).toHaveLength(1);
  });

  it("EC review batch only transitions applications past the consultation window", async () => {
    await updateMembershipSettings(env.DB, { consultationWindowDays: 7 }, null);

    const { id: recentId } = await createApplication({
      stage: "in_consultation",
      stage_entered_at: "datetime('now', '-1 days')",
    });
    const { id: overdueId } = await createApplication({
      stage: "in_consultation",
      stage_entered_at: "datetime('now', '-10 days')",
      applicant_email: "overdue@example.test",
    });

    const result = await runEcReviewBatch(env.DB, env as any);
    expect(result.transitioned).toBe(1);

    const recentRows = await queryAll<{ stage: string }>(
      env.DB,
      "SELECT stage FROM member_applications WHERE id = ?",
      recentId,
    );
    expect(recentRows[0].stage).toBe("in_consultation");

    const overdueRows = await queryAll<{ stage: string }>(
      env.DB,
      "SELECT stage FROM member_applications WHERE id = ?",
      overdueId,
    );
    expect(overdueRows[0].stage).toBe("ec_review");

    const outbox = await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'ec-review-batch'");
    expect(outbox).toHaveLength(1);
  });

  it("rolls back every EC transition when the aggregate notification cannot be queued", async () => {
    const first = await createApplication({
      stage_entered_at: "datetime('now', '-10 days')",
      applicant_email: "first-overdue@example.test",
    });
    const second = await createApplication({
      stage_entered_at: "datetime('now', '-11 days')",
      applicant_email: "second-overdue@example.test",
    });
    await env.DB.prepare(
      `CREATE TRIGGER reject_ec_review_batch
       BEFORE INSERT ON email_outbox
       WHEN NEW.template_key = 'ec-review-batch'
       BEGIN
         SELECT RAISE(ABORT, 'forced EC outbox failure');
       END`,
    ).run();

    await expect(runEcReviewBatch(env.DB, env as any)).rejects.toThrow();

    const applications = await queryAll<{ id: string; stage: string }>(
      env.DB,
      "SELECT id, stage FROM member_applications WHERE id IN (?, ?) ORDER BY id",
      first.id,
      second.id,
    );
    expect(applications.map((application) => application.stage)).toEqual(["in_consultation", "in_consultation"]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM member_application_events WHERE application_id IN (?, ?)",
        first.id,
        second.id,
      ),
    ).toEqual([]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'application_stage_transitioned' AND entity_id IN (?, ?)",
        first.id,
        second.id,
      ),
    ).toEqual([]);
  });

  it("on-hold auto-close fires after the deadline and sends application-closed-no-response", async () => {
    await updateMembershipSettings(env.DB, { onHoldResponseDeadlineDays: 7 }, null);
    const { id } = await createApplication({
      stage: "on_hold",
      on_hold_subtype: "request_information",
      stage_entered_at: "datetime('now', '-8 days')",
    });

    const result = await runOnHoldReminders(env.DB, env as any);
    expect(result.autoClosed).toBe(1);

    const rows = await queryAll<{ stage: string }>(env.DB, "SELECT stage FROM member_applications WHERE id = ?", id);
    expect(rows[0].stage).toBe("withdrawn");

    const outbox = await queryAll<{ status: string }>(
      env.DB,
      "SELECT id, status FROM email_outbox WHERE template_key = 'application-closed-no-response'",
    );
    expect(outbox).toHaveLength(1);
    // PR #1 review §9.1: the job enqueues only — it must not send
    // synchronously per recipient. Delivery is the shared outbox
    // processor's job (scheduled-due-work.ts's processPendingOutbox).
    expect(outbox[0].status).toBe("queued");
  });

  it("PR #1 review §9.1: on-hold auto-close is bounded by a LIMIT instead of scanning every on_hold row", async () => {
    await updateMembershipSettings(env.DB, { onHoldResponseDeadlineDays: 7 }, null);
    for (let i = 0; i < 3; i++) {
      await createApplication({
        stage: "on_hold",
        on_hold_subtype: "request_information",
        stage_entered_at: "datetime('now', '-8 days')",
        applicant_email: `on-hold-${i}@example.test`,
      });
    }

    const result = await runOnHoldReminders(env.DB, env as any, 2);
    expect(result.autoClosed).toBe(2);

    const stillOnHold = await queryAll(env.DB, "SELECT id FROM member_applications WHERE stage = 'on_hold'");
    expect(stillOnHold).toHaveLength(1);
  });

  it("on-hold reminder fires within 3 days of the deadline, once", async () => {
    await updateMembershipSettings(env.DB, { onHoldResponseDeadlineDays: 7, autoReminderOnHolds: true }, null);
    await createApplication({
      stage: "on_hold",
      on_hold_subtype: "request_org_email",
      stage_entered_at: "datetime('now', '-5 days')",
    });

    const first = await runOnHoldReminders(env.DB, env as any);
    expect(first.remindersSent).toBe(1);

    const second = await runOnHoldReminders(env.DB, env as any);
    expect(second.remindersSent).toBe(0);

    const outbox = await queryAll(
      env.DB,
      "SELECT id FROM email_outbox WHERE template_key = 'application-hold-org-email'",
    );
    expect(outbox).toHaveLength(1);
  });

  it("does not send a reminder when auto_reminder_on_holds is disabled", async () => {
    await updateMembershipSettings(env.DB, { onHoldResponseDeadlineDays: 7, autoReminderOnHolds: false }, null);
    await createApplication({
      stage: "on_hold",
      on_hold_subtype: "request_org_email",
      stage_entered_at: "datetime('now', '-5 days')",
    });

    const result = await runOnHoldReminders(env.DB, env as any);
    expect(result.remindersSent).toBe(0);
  });

  it("EC-window auto-approve approves an overdue application with no EC decline", async () => {
    await updateMembershipSettings(env.DB, { ecReviewWindowDays: 7 }, null);
    const { id } = await createApplication({
      stage: "ec_review",
      stage_entered_at: "datetime('now', '-8 days')",
    });

    const result = await runEcWindowAutoApprove(env.DB, env as any);
    expect(result.autoApproved).toBe(1);
    expect(result.heldForDecline).toBe(0);

    const rows = await queryAll<{ stage: string }>(env.DB, "SELECT stage FROM member_applications WHERE id = ?", id);
    expect(rows[0].stage).toBe("approved");

    const events = await queryAll<{ note: string }>(
      env.DB,
      "SELECT note FROM member_application_events WHERE application_id = ? AND to_stage = 'approved'",
      id,
    );
    expect(events[0].note).toBe("auto_approved_no_ec_objection");

    // PR #1 review §9.1: enqueue-only — approveApplication's onboarding
    // emails must not be sent synchronously inside this job's loop.
    const outbox = await queryAll<{ status: string }>(env.DB, "SELECT status FROM email_outbox");
    expect(outbox.length).toBeGreaterThan(0);
    expect(outbox.every((row) => row.status === "queued")).toBe(true);
  });

  it("PR #1 review §9.1: EC-window auto-approve is bounded by a LIMIT instead of scanning every overdue application", async () => {
    await updateMembershipSettings(env.DB, { ecReviewWindowDays: 7 }, null);
    for (let i = 0; i < 3; i++) {
      await createApplication({
        stage: "ec_review",
        stage_entered_at: "datetime('now', '-8 days')",
        applicant_email: `ec-overdue-${i}@example.test`,
      });
    }

    const result = await runEcWindowAutoApprove(env.DB, env as any, 2);
    expect(result.autoApproved).toBe(2);

    const stillInReview = await queryAll(env.DB, "SELECT id FROM member_applications WHERE stage = 'ec_review'");
    expect(stillInReview).toHaveLength(1);
  });

  it("EC-window auto-approve holds an overdue application with an EC decline for staff resolution", async () => {
    await updateMembershipSettings(env.DB, { ecReviewWindowDays: 7 }, null);
    const { id } = await createApplication({
      stage: "ec_review",
      stage_entered_at: "datetime('now', '-8 days')",
    });

    const ecUserId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'decliner@example.test', 'decliner@example.test', 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(ecUserId)
      .run();
    await recordEcDecision(env.DB, {
      applicationId: id,
      ecMemberUserId: ecUserId,
      decision: "decline",
      reason: "Concerns",
    });

    const result = await runEcWindowAutoApprove(env.DB, env as any);
    expect(result.autoApproved).toBe(0);
    expect(result.heldForDecline).toBe(1);

    const rows = await queryAll<{ stage: string }>(env.DB, "SELECT stage FROM member_applications WHERE id = ?", id);
    expect(rows[0].stage).toBe("ec_review");
  });

  it("does not touch applications still within the EC review window", async () => {
    await updateMembershipSettings(env.DB, { ecReviewWindowDays: 7 }, null);
    await createApplication({
      stage: "ec_review",
      stage_entered_at: "datetime('now', '-1 days')",
    });

    const result = await runEcWindowAutoApprove(env.DB, env as any);
    expect(result.autoApproved).toBe(0);
    expect(result.heldForDecline).toBe(0);
  });

  it("getMembershipSettings returns the seeded defaults directly (service-level check)", async () => {
    const settings = await getMembershipSettings(env.DB);
    expect(settings.consultation_window_days).toBe(7);
    expect(settings.ec_review_window_days).toBe(7);
  });
});
