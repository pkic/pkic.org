/**
 * sponsorship-scheduled-jobs.test.ts — "Renewal Reminders",
 * Direct unit tests of runSponsorshipDueWork against env.DB,
 * mirroring membership-scheduled-jobs.test.ts's style for the sibling
 * on-hold-reminders job.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { runSponsorshipDueWork } from "../functions/_lib/services/sponsorship-scheduled-jobs";
import { nowIso } from "../functions/_lib/utils/time";
import { initialRenewalActionDueAt } from "../functions/_lib/services/sponsorship/renewal-policy";
import { gateBatchGroup, gateNextBatch } from "./helpers/d1-batch-gate";
import { advanceSponsorshipStage, updateAdminSponsorship } from "../functions/_lib/services/sponsorship/admin-pipeline";
import { createD1QueryBudgetedDatabase } from "../functions/_lib/db/query-budget";
import type { AuthAdmin } from "../functions/_lib/types";
import { renderEmail } from "../functions/_lib/email/render";

const NOTIFICATIONS = { appBaseUrl: "https://app.test", magicLinkTtlMinutes: 30 };

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function seedActiveConsortiumSponsorship(params: {
  organizationId: string;
  assignedToUserId: string | null;
  renewalDate: string | null;
  pipelineStage?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const pipelineStage = params.pipelineStage ?? "active";
  const renewalActionDueAt = initialRenewalActionDueAt({
    pipelineStage,
    renewalDate: params.renewalDate,
    assignedToUserId: params.assignedToUserId,
  });
  await env.DB.prepare(
    `INSERT INTO sponsorships
       (id, sponsor_type, organization_id, tier, pipeline_stage, start_date, renewal_date,
        assigned_to_user_id, renewal_action_due_at, created_at, updated_at)
     VALUES (?, 'consortium', ?, 'Gold', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      params.organizationId,
      pipelineStage,
      nowIso(),
      params.renewalDate,
      params.assignedToUserId,
      renewalActionDueAt,
      nowIso(),
      nowIso(),
    )
    .run();
  return id;
}

describe("Sponsorship renewal reminders & auto-lapse", () => {
  let staffUserId: string;
  let staffActor: AuthAdmin;
  let organizationId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    staffUserId = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0].id;
    staffActor = {
      id: staffUserId,
      identityType: "user",
      email: "admin@pkic.org",
      role: "admin",
    };

    organizationId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO organizations (id, name, normalized_name, sponsor_tier, sponsor_start_date, created_at, updated_at)
       VALUES (?, 'Renewal Org', 'renewal org', 'Gold', datetime('now'), datetime('now'), datetime('now'))`,
    )
      .bind(organizationId)
      .run();
  });

  it("sends the 60-day reminder once, and does not resend it on a second pass", async () => {
    await seedActiveConsortiumSponsorship({
      organizationId,
      assignedToUserId: staffUserId,
      renewalDate: isoDaysFromNow(45),
    });

    const first = await runSponsorshipDueWork(env.DB, env as any);
    expect(first.reminders60Sent).toBe(1);

    const second = await runSponsorshipDueWork(env.DB, env as any);
    expect(second.reminders60Sent).toBe(0);

    const outboxRows = await queryAll<{ template_key: string }>(
      env.DB,
      "SELECT template_key FROM email_outbox WHERE template_key = 'sponsorship-renewal-reminder-60'",
    );
    expect(outboxRows).toHaveLength(1);
  });

  it("claims one renewal reminder atomically under concurrent runners", async () => {
    const sponsorshipId = await seedActiveConsortiumSponsorship({
      organizationId,
      assignedToUserId: staffUserId,
      renewalDate: isoDaysFromNow(45),
    });
    const concurrentDb = gateBatchGroup(env.DB, 2);

    const results = await Promise.all([
      runSponsorshipDueWork(concurrentDb, env as any),
      runSponsorshipDueWork(concurrentDb, env as any),
    ]);

    expect(results.reduce((total, result) => total + result.reminders60Sent, 0)).toBe(1);
    expect(
      await queryAll(
        env.DB,
        "SELECT effect_key FROM sponsorship_automation_effects WHERE sponsorship_id = ?",
        sponsorshipId,
      ),
    ).toHaveLength(1);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'sponsorship-renewal-reminder-60'"),
    ).toHaveLength(1);
  });

  it("sends the 30-day reminder when within the 30-day window", async () => {
    await seedActiveConsortiumSponsorship({
      organizationId,
      assignedToUserId: staffUserId,
      renewalDate: isoDaysFromNow(20),
    });

    const result = await runSponsorshipDueWork(env.DB, env as any);
    expect(result.reminders30Sent).toBe(1);
    expect(result.reminders60Sent).toBe(0);
  });

  it("uses inclusive UTC calendar-day boundaries at 60, 30, and 0 days", async () => {
    for (const days of [60, 30, 0]) {
      await seedActiveConsortiumSponsorship({
        organizationId,
        assignedToUserId: staffUserId,
        renewalDate: isoDaysFromNow(days),
      });
    }

    expect(await runSponsorshipDueWork(env.DB, env as any)).toEqual({
      reminders60Sent: 1,
      reminders30Sent: 1,
      autoLapsed: 1,
    });
  });

  it("auto-lapses a sponsorship whose renewal date has passed, clearing organizations.sponsor_tier, regardless of staff assignment", async () => {
    await seedActiveConsortiumSponsorship({ organizationId, assignedToUserId: null, renewalDate: isoDaysFromNow(-1) });

    const result = await runSponsorshipDueWork(env.DB, env as any);
    expect(result.autoLapsed).toBe(1);

    const orgRows = await queryAll<{ sponsor_tier: string | null }>(
      env.DB,
      "SELECT sponsor_tier FROM organizations WHERE id = ?",
      [organizationId],
    );
    expect(orgRows[0].sponsor_tier).toBeNull();

    const sponsorshipRows = await queryAll<{ pipeline_stage: string }>(
      env.DB,
      "SELECT pipeline_stage FROM sponsorships WHERE organization_id = ?",
      [organizationId],
    );
    expect(sponsorshipRows[0].pipeline_stage).toBe("lapsed");
  });

  it("sends sponsorship-lapsed-staff to the assigned staff member when auto-lapsing", async () => {
    await env.DB.prepare("UPDATE organizations SET name = ? WHERE id = ?")
      .bind("[Renewal Org](https://attacker.invalid/renewal)", organizationId)
      .run();
    await seedActiveConsortiumSponsorship({
      organizationId,
      assignedToUserId: staffUserId,
      renewalDate: isoDaysFromNow(-2),
    });

    await runSponsorshipDueWork(env.DB, env as any);

    const outboxRows = await queryAll<{ recipient_email: string; payload_json: string }>(
      env.DB,
      "SELECT recipient_email, payload_json FROM email_outbox WHERE template_key = 'sponsorship-lapsed-staff'",
    );
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].recipient_email).toBe("admin@pkic.org");
    const rendered = await renderEmail(
      "{{organizationNameText}}",
      JSON.parse(outboxRows[0].payload_json) as Record<string, unknown>,
      "<!doctype html><html><body>{{{body_html}}}</body></html>",
    );
    expect(rendered.text).toContain("attacker.invalid/renewal");
    expect(rendered.html).not.toContain('href="https://attacker.invalid/renewal"');
  });

  it("rolls the lapse, organization projection, event, email, effect marker, and audit back together", async () => {
    const sponsorshipId = await seedActiveConsortiumSponsorship({
      organizationId,
      assignedToUserId: staffUserId,
      renewalDate: isoDaysFromNow(-2),
    });
    await env.DB.prepare(
      `CREATE TRIGGER fail_sponsorship_auto_lapse_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'sponsorship_auto_lapsed'
       BEGIN
         SELECT RAISE(ABORT, 'forced sponsorship auto-lapse audit failure');
       END`,
    ).run();

    try {
      await expect(runSponsorshipDueWork(env.DB, env as any)).rejects.toThrow();
      expect(
        await queryAll<{ pipeline_stage: string }>(env.DB, "SELECT pipeline_stage FROM sponsorships WHERE id = ?", [
          sponsorshipId,
        ]),
      ).toEqual([{ pipeline_stage: "active" }]);
      expect(
        await queryAll<{ sponsor_tier: string | null }>(env.DB, "SELECT sponsor_tier FROM organizations WHERE id = ?", [
          organizationId,
        ]),
      ).toEqual([{ sponsor_tier: "Gold" }]);
      expect(await queryAll(env.DB, "SELECT sponsorship_id FROM sponsorship_automation_effects")).toHaveLength(0);
      expect(
        await queryAll(env.DB, "SELECT id FROM sponsorship_events WHERE sponsorship_id = ?", [sponsorshipId]),
      ).toHaveLength(0);
      expect(
        await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'sponsorship-lapsed-staff'"),
      ).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_sponsorship_auto_lapse_audit").run();
    }
  });

  it("drops stale auto-lapse fallout when staff changes the stage first", async () => {
    const sponsorshipId = await seedActiveConsortiumSponsorship({
      organizationId,
      assignedToUserId: staffUserId,
      renewalDate: isoDaysFromNow(-1),
    });
    const gate = gateNextBatch(env.DB);
    const staleRun = runSponsorshipDueWork(gate.db, env as any);
    await gate.reached;

    await advanceSponsorshipStage(env.DB, {
      id: sponsorshipId,
      toStage: "negotiating",
      actor: staffActor,
      note: "Renewal discussion reopened",
      notifications: NOTIFICATIONS,
    });
    gate.release();

    expect((await staleRun).autoLapsed).toBe(0);
    expect(await queryAll(env.DB, "SELECT pipeline_stage FROM sponsorships WHERE id = ?", sponsorshipId)).toEqual([
      { pipeline_stage: "negotiating" },
    ]);
    expect(
      await queryAll(
        env.DB,
        "SELECT effect_key FROM sponsorship_automation_effects WHERE sponsorship_id = ?",
        sponsorshipId,
      ),
    ).toHaveLength(0);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM sponsorship_events WHERE sponsorship_id = ? AND to_stage = 'lapsed'",
        sponsorshipId,
      ),
    ).toHaveLength(0);
  });

  it("drops stale reminder fallout when staff changes the renewal cycle first", async () => {
    const sponsorshipId = await seedActiveConsortiumSponsorship({
      organizationId,
      assignedToUserId: staffUserId,
      renewalDate: isoDaysFromNow(45),
    });
    const replacementRenewalDate = isoDaysFromNow(90);
    const gate = gateNextBatch(env.DB);
    const staleRun = runSponsorshipDueWork(gate.db, env as any);
    await gate.reached;

    await updateAdminSponsorship(env.DB, staffUserId, sponsorshipId, { renewalDate: replacementRenewalDate });
    gate.release();

    expect((await staleRun).reminders60Sent).toBe(0);
    expect(
      await queryAll(env.DB, "SELECT renewal_date, transition_revision FROM sponsorships WHERE id = ?", sponsorshipId),
    ).toEqual([{ renewal_date: replacementRenewalDate, transition_revision: 1 }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT effect_key FROM sponsorship_automation_effects WHERE sponsorship_id = ?",
        sponsorshipId,
      ),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM sponsorship_events WHERE sponsorship_id = ?", sponsorshipId),
    ).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'sponsorship-renewal-reminder-60'"),
    ).toHaveLength(0);
  });

  it("rolls a failed reminder queue claim and all fallout back together", async () => {
    const sponsorshipId = await seedActiveConsortiumSponsorship({
      organizationId,
      assignedToUserId: staffUserId,
      renewalDate: isoDaysFromNow(45),
    });
    const [before] = await queryAll<{ renewal_action_due_at: string; transition_revision: number }>(
      env.DB,
      "SELECT renewal_action_due_at, transition_revision FROM sponsorships WHERE id = ?",
      sponsorshipId,
    );
    await env.DB.prepare(
      `CREATE TRIGGER fail_sponsorship_reminder_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'sponsorship_renewal_reminder_queued'
       BEGIN
         SELECT RAISE(ABORT, 'forced sponsorship reminder audit failure');
       END`,
    ).run();

    try {
      await expect(runSponsorshipDueWork(env.DB, env as any)).rejects.toThrow();
      expect(
        await queryAll(
          env.DB,
          "SELECT renewal_action_due_at, transition_revision FROM sponsorships WHERE id = ?",
          sponsorshipId,
        ),
      ).toEqual([before]);
      expect(
        await queryAll(
          env.DB,
          "SELECT effect_key FROM sponsorship_automation_effects WHERE sponsorship_id = ?",
          sponsorshipId,
        ),
      ).toHaveLength(0);
      expect(
        await queryAll(env.DB, "SELECT id FROM sponsorship_events WHERE sponsorship_id = ?", sponsorshipId),
      ).toHaveLength(0);
      expect(
        await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'sponsorship-renewal-reminder-60'"),
      ).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_sponsorship_reminder_audit").run();
    }
  });

  it("requires a future renewal date for every transition into active", async () => {
    for (const pipelineStage of ["new_inquiry", "payment_pending", "negotiating", "lapsed"]) {
      const sponsorshipId = await seedActiveConsortiumSponsorship({
        organizationId,
        assignedToUserId: staffUserId,
        renewalDate: pipelineStage === "payment_pending" ? null : isoDaysFromNow(-1),
        pipelineStage,
      });

      await expect(
        advanceSponsorshipStage(env.DB, {
          id: sponsorshipId,
          toStage: "active",
          actor: staffActor,
          note: "Invalid activation attempt",
          notifications: NOTIFICATIONS,
        }),
      ).rejects.toMatchObject({ code: "FUTURE_RENEWAL_DATE_REQUIRED" });
      expect(await queryAll(env.DB, "SELECT pipeline_stage FROM sponsorships WHERE id = ?", sponsorshipId)).toEqual([
        { pipeline_stage: pipelineStage },
      ]);
      expect(
        await queryAll(env.DB, "SELECT id FROM sponsorship_events WHERE sponsorship_id = ?", sponsorshipId),
      ).toHaveLength(0);
    }
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'sponsorship-active-confirmation'"),
    ).toHaveLength(0);
  });

  it("stops before the D1 statement budget and drains remaining renewals on the next pass", async () => {
    for (let index = 0; index < 2; index += 1) {
      const orgId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      )
        .bind(orgId, `Budget Org ${index}`, `budget org ${index}`)
        .run();
      await seedActiveConsortiumSponsorship({
        organizationId: orgId,
        assignedToUserId: staffUserId,
        renewalDate: isoDaysFromNow(45 + index),
      });
    }
    const budgeted = createD1QueryBudgetedDatabase(env.DB, 7);

    const first = await runSponsorshipDueWork(budgeted.db, env as any, 500, budgeted.budget);
    const second = await runSponsorshipDueWork(env.DB, env as any, 500);

    expect(first.reminders60Sent).toBe(1);
    expect(first.reminders60Sent + second.reminders60Sent).toBe(2);
    expect(budgeted.budget.usedQueries()).toBeLessThanOrEqual(7);
  });

  it("treats a zero sponsorship work limit as disabled", async () => {
    await seedActiveConsortiumSponsorship({
      organizationId,
      assignedToUserId: staffUserId,
      renewalDate: isoDaysFromNow(45),
    });

    expect(await runSponsorshipDueWork(env.DB, env as any, 0)).toEqual({
      reminders60Sent: 0,
      reminders30Sent: 0,
      autoLapsed: 0,
    });
    expect(
      await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'sponsorship-renewal-reminder-60'"),
    ).toHaveLength(0);
  });

  it("keeps immutable, date-scoped automation history across renewal cycles", async () => {
    const firstRenewalDate = isoDaysFromNow(45);
    const sponsorshipId = await seedActiveConsortiumSponsorship({
      organizationId,
      assignedToUserId: staffUserId,
      renewalDate: firstRenewalDate,
    });
    expect((await runSponsorshipDueWork(env.DB, env as any)).reminders60Sent).toBe(1);

    const firstLapseDate = isoDaysFromNow(-1);
    await updateAdminSponsorship(env.DB, staffUserId, sponsorshipId, { renewalDate: firstLapseDate });
    expect((await runSponsorshipDueWork(env.DB, env as any)).autoLapsed).toBe(1);

    const secondRenewalDate = isoDaysFromNow(46);
    await updateAdminSponsorship(env.DB, staffUserId, sponsorshipId, { renewalDate: secondRenewalDate });
    await env.DB.prepare("UPDATE sponsorships SET start_date = '2025-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(sponsorshipId)
      .run();
    await advanceSponsorshipStage(env.DB, {
      id: sponsorshipId,
      toStage: "active",
      actor: staffActor,
      note: "Renewed",
      notifications: NOTIFICATIONS,
    });
    expect(await queryAll(env.DB, "SELECT start_date FROM sponsorships WHERE id = ?", sponsorshipId)).toEqual([
      { start_date: "2025-01-01T00:00:00.000Z" },
    ]);
    expect((await runSponsorshipDueWork(env.DB, env as any)).reminders60Sent).toBe(1);

    const secondLapseDate = isoDaysFromNow(-2);
    await updateAdminSponsorship(env.DB, staffUserId, sponsorshipId, { renewalDate: secondLapseDate });
    expect((await runSponsorshipDueWork(env.DB, env as any)).autoLapsed).toBe(1);
    const effectKeys = (
      await queryAll<{ effect_key: string }>(
        env.DB,
        "SELECT effect_key FROM sponsorship_automation_effects WHERE sponsorship_id = ?",
        sponsorshipId,
      )
    ).map((row) => row.effect_key);
    expect(effectKeys).toHaveLength(4);
    expect(effectKeys).toEqual(
      expect.arrayContaining([
        `auto-lapse:${firstLapseDate}`,
        `auto-lapse:${secondLapseDate}`,
        `renewal-reminder-60:${firstRenewalDate}`,
        `renewal-reminder-60:${secondRenewalDate}`,
      ]),
    );
  });

  it("ignores sponsorships with no renewal_date set", async () => {
    await seedActiveConsortiumSponsorship({ organizationId, assignedToUserId: staffUserId, renewalDate: null });

    const result = await runSponsorshipDueWork(env.DB, env as any);
    expect(result.reminders60Sent).toBe(0);
    expect(result.reminders30Sent).toBe(0);
    expect(result.autoLapsed).toBe(0);
  });

  it("PR #1 review §9.1: enqueues without sending synchronously — outbox rows stay 'queued'", async () => {
    await seedActiveConsortiumSponsorship({
      organizationId,
      assignedToUserId: staffUserId,
      renewalDate: isoDaysFromNow(45),
    });

    await runSponsorshipDueWork(env.DB, env as any);

    const outboxRows = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM email_outbox WHERE template_key = 'sponsorship-renewal-reminder-60'",
    );
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].status).toBe("queued");
  });

  it("PR #1 review §9.1: is bounded by a LIMIT instead of scanning every active-with-renewal-date sponsorship", async () => {
    for (let i = 0; i < 3; i++) {
      const orgId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO organizations (id, name, normalized_name, sponsor_tier, sponsor_start_date, created_at, updated_at)
         VALUES (?, ?, ?, 'Gold', datetime('now'), datetime('now'), datetime('now'))`,
      )
        .bind(orgId, `Limit Org ${i}`, `limit org ${i}`)
        .run();
      // Renewal dates ascending, so the LIMIT-bounded (ORDER BY renewal_date
      // ASC) query deterministically keeps only the most urgent ones.
      await seedActiveConsortiumSponsorship({
        organizationId: orgId,
        assignedToUserId: staffUserId,
        renewalDate: isoDaysFromNow(20 + i),
      });
    }

    const result = await runSponsorshipDueWork(env.DB, env as any, 2);
    expect(result.reminders30Sent).toBe(2);
  });

  it("PR #1 review §9.1: resolves the assigned staff member's email from the bulk query's own join — no per-row users lookup", async () => {
    await seedActiveConsortiumSponsorship({
      organizationId,
      assignedToUserId: staffUserId,
      renewalDate: isoDaysFromNow(-2),
    });

    const preparedStatements: string[] = [];
    const countingDb = new Proxy(env.DB, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop === "prepare") {
          return (sql: string) => {
            preparedStatements.push(sql);
            return value.call(target, sql);
          };
        }
        return value;
      },
    });

    const result = await runSponsorshipDueWork(countingDb as typeof env.DB, env as any);
    expect(result.autoLapsed).toBe(1);

    const outboxRows = await queryAll<{ recipient_email: string }>(
      env.DB,
      "SELECT recipient_email FROM email_outbox WHERE template_key = 'sponsorship-lapsed-staff'",
    );
    expect(outboxRows[0].recipient_email).toBe("admin@pkic.org");

    // The N+1 finding's exact literal query — `SELECT email FROM users
    // WHERE id = ?`, issued once per row — must never appear: the assigned
    // user's email now comes from the bulk query's own LEFT JOIN.
    const userLookups = preparedStatements.filter((sql) => /FROM users WHERE id/i.test(sql));
    expect(userLookups).toHaveLength(0);
  });
});
