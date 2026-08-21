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

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

async function seedActiveConsortiumSponsorship(params: {
  organizationId: string;
  assignedToUserId: string | null;
  renewalDate: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO sponsorships
       (id, sponsor_type, organization_id, tier, pipeline_stage, start_date, renewal_date, assigned_to_user_id, created_at, updated_at)
     VALUES (?, 'consortium', ?, 'Gold', 'active', ?, ?, ?, ?, ?)`,
  )
    .bind(id, params.organizationId, nowIso(), params.renewalDate, params.assignedToUserId, nowIso(), nowIso())
    .run();
  return id;
}

describe("Sponsorship renewal reminders & auto-lapse", () => {
  let staffUserId: string;
  let organizationId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    staffUserId = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0].id;

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
    await seedActiveConsortiumSponsorship({
      organizationId,
      assignedToUserId: staffUserId,
      renewalDate: isoDaysFromNow(-2),
    });

    await runSponsorshipDueWork(env.DB, env as any);

    const outboxRows = await queryAll<{ recipient_email: string }>(
      env.DB,
      "SELECT recipient_email FROM email_outbox WHERE template_key = 'sponsorship-lapsed-staff'",
    );
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].recipient_email).toBe("admin@pkic.org");
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
