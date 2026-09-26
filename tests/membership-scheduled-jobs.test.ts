import { pinReviewedStaffWorkflow } from "./helpers/membership-workflows";
/**
 * membership-scheduled-jobs.test.ts
 *
 * consultation batch, EC review batch, on-hold reminders/
 * auto-close, and EC-window auto-approve
 * (functions/_lib/services/membership/scheduled-jobs.ts). Called directly
 * as service functions rather than through HTTP, matching how these run —
 * cron-triggered, not endpoint-triggered (see functions/router.ts).
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll } from "./helpers/context";
import { runGoogleGroupsSyncPass } from "../functions/_lib/services/membership/scheduled-jobs";
import { runOnHoldReminders } from "../functions/_lib/services/membership/on-hold-reminders";
import { getMembershipSettings, updateMembershipSettings } from "../functions/_lib/services/membership-settings";
import { seedMemberApplication } from "./helpers/member-applications";
import { gateBatchGroup, gateNextBatch } from "./helpers/d1-batch-gate";
import { transitionApplicationStage } from "../functions/_lib/services/membership/applications/transition";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";

async function createApplication(overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const stageAgeDays = /'-(\d+) days'/.exec(String(overrides.stage_entered_at ?? ""))?.[1];
  const id = await seedMemberApplication({
    applicantEmail: (overrides.applicant_email as string) ?? "applicant@example.test",
    applicantName: (overrides.applicant_name as string) ?? "Applicant Name",
    organizationName: null,
    organizationDomain: null,
    membershipCategory: (overrides.membership_category as string) ?? "H6",
    formSubmissionId: (overrides.form_submission_id as string) ?? null,
    stage: (overrides.stage as string) ?? "processing",
    stageEnteredAt: stageAgeDays
      ? new Date(Date.now() - Number(stageAgeDays) * 86_400_000).toISOString()
      : new Date().toISOString(),
  });
  if (overrides.on_hold_subtype) {
    await env.DB.prepare("UPDATE member_applications SET on_hold_subtype = ? WHERE id = ?")
      .bind(overrides.on_hold_subtype, id)
      .run();
  }
  await pinReviewedStaffWorkflow(env.DB, id, (overrides.membership_category as string) ?? "H6", false);
  return { id };
}

describe("Membership scheduled jobs", () => {
  beforeEach(async () => {
    await resetDb();
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

  it("claims one on-hold reminder atomically under concurrent runners", async () => {
    await updateMembershipSettings(env.DB, { onHoldResponseDeadlineDays: 7, autoReminderOnHolds: true }, null);
    const { id } = await createApplication({
      stage: "on_hold",
      on_hold_subtype: "request_org_email",
      stage_entered_at: "datetime('now', '-5 days')",
    });
    const concurrentDb = gateBatchGroup(env.DB, 2);

    const results = await Promise.all([
      runOnHoldReminders(concurrentDb, env as any),
      runOnHoldReminders(concurrentDb, env as any),
    ]);

    expect(results.reduce((total, result) => total + result.remindersSent, 0)).toBe(1);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'application-hold-org-email'"),
    ).toHaveLength(1);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM member_application_events WHERE application_id = ? AND note = 'Hold reminder sent'",
        id,
      ),
    ).toHaveLength(1);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE entity_id = ? AND action = 'application_on_hold_reminder_queued'",
        id,
      ),
    ).toHaveLength(1);
  });

  it("allows a new reminder after leaving and re-entering on-hold", async () => {
    await updateMembershipSettings(env.DB, { onHoldResponseDeadlineDays: 7, autoReminderOnHolds: true }, null);
    const { id } = await createApplication({
      stage: "on_hold",
      on_hold_subtype: "request_org_email",
      stage_entered_at: "datetime('now', '-5 days')",
    });
    expect((await runOnHoldReminders(env.DB, env as any)).remindersSent).toBe(1);

    await transitionApplicationStage(env.DB, { applicationId: id, toStage: "processing", actor: null });
    await transitionApplicationStage(env.DB, {
      applicationId: id,
      toStage: "on_hold",
      onHoldSubtype: "request_information",
      actor: null,
    });
    await env.DB.prepare("UPDATE member_applications SET stage_entered_at = datetime('now', '-5 days') WHERE id = ?")
      .bind(id)
      .run();

    expect((await runOnHoldReminders(env.DB, env as any)).remindersSent).toBe(1);
    expect(
      await queryAll(
        env.DB,
        `SELECT template_key FROM email_outbox
         WHERE idempotency_key LIKE 'application-on-hold-reminder:%'
         ORDER BY template_key`,
      ),
    ).toEqual([{ template_key: "application-hold-information" }, { template_key: "application-hold-org-email" }]);
  });

  it("does not let a stale auto-close withdraw a newly re-entered hold", async () => {
    await updateMembershipSettings(env.DB, { onHoldResponseDeadlineDays: 7 }, null);
    const { id } = await createApplication({
      stage: "on_hold",
      on_hold_subtype: "request_information",
      stage_entered_at: "datetime('now', '-8 days')",
    });
    const gate = gateNextBatch(env.DB);
    const staleRun = runOnHoldReminders(gate.db, env as any);
    await gate.reached;

    await transitionApplicationStage(env.DB, { applicationId: id, toStage: "processing", actor: null });
    await transitionApplicationStage(env.DB, {
      applicationId: id,
      toStage: "on_hold",
      onHoldSubtype: "request_org_application",
      actor: null,
    });
    gate.release();

    expect((await staleRun).autoClosed).toBe(0);
    expect(await queryAll(env.DB, "SELECT stage, on_hold_subtype FROM member_applications WHERE id = ?", id)).toEqual([
      { stage: "on_hold", on_hold_subtype: "request_org_application" },
    ]);
  });

  it("rejects a stale hold-cycle candidate even when the stage timestamp is reused", async () => {
    await updateMembershipSettings(env.DB, { onHoldResponseDeadlineDays: 7 }, null);
    const { id } = await createApplication({
      stage: "on_hold",
      on_hold_subtype: "request_information",
      stage_entered_at: "datetime('now', '-8 days')",
    });
    const [{ stage_entered_at: originalStageEnteredAt }] = await queryAll<{ stage_entered_at: string }>(
      env.DB,
      "SELECT stage_entered_at FROM member_applications WHERE id = ?",
      id,
    );
    const gate = gateNextBatch(env.DB);
    const staleRun = runOnHoldReminders(gate.db, env as any);
    await gate.reached;

    await transitionApplicationStage(env.DB, { applicationId: id, toStage: "processing", actor: null });
    await transitionApplicationStage(env.DB, {
      applicationId: id,
      toStage: "on_hold",
      onHoldSubtype: "request_org_application",
      actor: null,
    });
    await env.DB.prepare("UPDATE member_applications SET stage_entered_at = ? WHERE id = ?")
      .bind(originalStageEnteredAt, id)
      .run();
    gate.release();

    expect((await staleRun).autoClosed).toBe(0);
    expect(
      await queryAll(
        env.DB,
        "SELECT stage, on_hold_subtype, transition_revision FROM member_applications WHERE id = ?",
        id,
      ),
    ).toEqual([{ stage: "on_hold", on_hold_subtype: "request_org_application", transition_revision: 2 }]);
  });

  it("rejects a stale reminder candidate when a new hold cycle reuses the timestamp", async () => {
    await updateMembershipSettings(env.DB, { onHoldResponseDeadlineDays: 7, autoReminderOnHolds: true }, null);
    const { id } = await createApplication({
      stage: "on_hold",
      on_hold_subtype: "request_org_email",
      stage_entered_at: "datetime('now', '-5 days')",
    });
    const [{ stage_entered_at: originalStageEnteredAt }] = await queryAll<{ stage_entered_at: string }>(
      env.DB,
      "SELECT stage_entered_at FROM member_applications WHERE id = ?",
      id,
    );
    const gate = gateNextBatch(env.DB);
    const staleRun = runOnHoldReminders(gate.db, env as any);
    await gate.reached;

    await transitionApplicationStage(env.DB, { applicationId: id, toStage: "processing", actor: null });
    await transitionApplicationStage(env.DB, {
      applicationId: id,
      toStage: "on_hold",
      onHoldSubtype: "request_org_email",
      actor: null,
    });
    await env.DB.prepare("UPDATE member_applications SET stage_entered_at = ? WHERE id = ?")
      .bind(originalStageEnteredAt, id)
      .run();
    gate.release();

    expect((await staleRun).remindersSent).toBe(0);
    expect(
      await queryAll(
        env.DB,
        "SELECT on_hold_reminder_sent_at, transition_revision FROM member_applications WHERE id = ?",
        id,
      ),
    ).toEqual([{ on_hold_reminder_sent_at: null, transition_revision: 2 }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE idempotency_key LIKE 'application-on-hold-reminder:%'"),
    ).toHaveLength(0);
  });

  it("rolls a failed reminder claim, audit, event, and outbox back together", async () => {
    await updateMembershipSettings(env.DB, { onHoldResponseDeadlineDays: 7, autoReminderOnHolds: true }, null);
    const { id } = await createApplication({
      stage: "on_hold",
      on_hold_subtype: "request_org_email",
      stage_entered_at: "datetime('now', '-5 days')",
    });
    await env.DB.prepare(
      `CREATE TRIGGER reject_on_hold_reminder_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'application_on_hold_reminder_queued'
       BEGIN
         SELECT RAISE(ABORT, 'forced reminder audit failure');
       END`,
    ).run();

    try {
      await expect(runOnHoldReminders(env.DB, env as any)).rejects.toThrow();
      expect(
        await queryAll(env.DB, "SELECT on_hold_reminder_sent_at FROM member_applications WHERE id = ?", id),
      ).toEqual([{ on_hold_reminder_sent_at: null }]);
      expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
      expect(
        await queryAll(env.DB, "SELECT id FROM member_application_events WHERE application_id = ?", id),
      ).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_on_hold_reminder_audit").run();
    }
  });

  it("shares one total work limit fairly between closure and reminder lanes", async () => {
    await updateMembershipSettings(env.DB, { onHoldResponseDeadlineDays: 7, autoReminderOnHolds: true }, null);
    await createApplication({
      stage: "on_hold",
      on_hold_subtype: "request_information",
      stage_entered_at: "datetime('now', '-8 days')",
    });
    await createApplication({
      stage: "on_hold",
      on_hold_subtype: "request_org_email",
      stage_entered_at: "datetime('now', '-5 days')",
      applicant_email: "reminder-lane@example.test",
    });

    const result = await runOnHoldReminders(env.DB, env as any, 2);
    expect(result).toEqual({ autoClosed: 1, remindersSent: 1 });
    expect(result.autoClosed + result.remindersSent).toBeLessThanOrEqual(2);
  });

  it("alternates both due lanes when the configured limit is one", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-21T12:00:00.000Z"));
      await updateMembershipSettings(env.DB, { onHoldResponseDeadlineDays: 7, autoReminderOnHolds: true }, null);
      await createApplication({
        stage: "on_hold",
        on_hold_subtype: "request_information",
        stage_entered_at: "datetime('now', '-8 days')",
      });
      await createApplication({
        stage: "on_hold",
        on_hold_subtype: "request_org_email",
        stage_entered_at: "datetime('now', '-5 days')",
        applicant_email: "limit-one-reminder@example.test",
      });

      const first = await runOnHoldReminders(env.DB, env as any, 1);
      vi.advanceTimersByTime(15 * 60_000);
      const second = await runOnHoldReminders(env.DB, env as any, 1);

      expect(first.autoClosed + second.autoClosed).toBe(1);
      expect(first.remindersSent + second.remindersSent).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops before the D1 statement budget and drains remaining holds on the next pass", async () => {
    await updateMembershipSettings(env.DB, { onHoldResponseDeadlineDays: 7, autoReminderOnHolds: true }, null);
    for (let index = 0; index < 2; index += 1) {
      await createApplication({
        stage: "on_hold",
        on_hold_subtype: "request_org_email",
        stage_entered_at: "datetime('now', '-5 days')",
        applicant_email: `budgeted-hold-${index}@example.test`,
      });
    }
    const budgeted = createD1QueryBudgetedDatabase(env.DB, 9);

    const first = await runOnHoldReminders(budgeted.db, env as any, 500, budgeted.budget);
    const second = await runOnHoldReminders(env.DB, env as any, 500);

    expect(first).toEqual({ autoClosed: 0, remindersSent: 1 });
    expect(first.remindersSent + second.remindersSent).toBe(2);
    expect(budgeted.budget.usedQueries()).toBeLessThanOrEqual(9);
  });

  it("treats a zero on-hold work limit as disabled", async () => {
    await updateMembershipSettings(env.DB, { onHoldResponseDeadlineDays: 7 }, null);
    await createApplication({
      stage: "on_hold",
      on_hold_subtype: "request_information",
      stage_entered_at: "datetime('now', '-8 days')",
    });

    expect(await runOnHoldReminders(env.DB, env as any, 0)).toEqual({ autoClosed: 0, remindersSent: 0 });
    expect(await queryAll(env.DB, "SELECT id FROM member_applications WHERE stage = 'on_hold'")).toHaveLength(1);
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

  it("defers Google Groups work before a low-budget pass can claim a queue row", async () => {
    const budgeted = createD1QueryBudgetedDatabase(env.DB, 29);

    expect(await runGoogleGroupsSyncPass(budgeted.db, env as any, 1, budgeted.budget)).toEqual({
      processed: 0,
      succeeded: 0,
      failed: 0,
      skippedUnconfigured: false,
      deferredForBudget: true,
    });
    expect(budgeted.budget.usedQueries()).toBe(0);
  });

  it("getMembershipSettings returns the seeded defaults directly (service-level check)", async () => {
    const settings = await getMembershipSettings(env.DB);
    expect(settings.on_hold_response_deadline_days).toBeGreaterThan(0);
  });
});
