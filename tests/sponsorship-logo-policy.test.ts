import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { buildPublicSponsorReadModel } from "../functions/_lib/services/public-sponsors";
import { getSponsorship } from "../functions/_lib/services/sponsorship/read-model";
import { prepareSponsorshipStageTransition } from "../functions/_lib/services/sponsorship/stage-transition";
import { updateSponsorship } from "../functions/_lib/services/sponsorship/pipeline";
import { runSponsorLogoDueWork } from "../functions/_lib/services/sponsorship/logo-due-work";
import { dispatchStripePaymentEvent } from "../functions/_lib/services/payments/stripe-webhook";
import { findActiveSponsorCapacityForUser } from "../functions/_lib/auth/sponsor-capacity";
import type { SponsorshipEndReason } from "../assets/shared/sponsorship-logo-policy";

const AT = "2026-10-17T12:00:00.000Z";
const EXPIRES = "2026-10-01T00:00:00.000Z";
const GRACE_END = "2026-12-30T00:00:00.000Z";
let userId: string;
async function sponsor({
  tier = "Gold",
  type = "consortium",
  organizationId = null,
  eventId = null,
}: {
  tier?: string;
  type?: string;
  organizationId?: string | null;
  eventId?: string | null;
} = {}) {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sponsorships(id,sponsor_type,organization_id,event_id,non_member_name,
      contact_email,tier,pipeline_stage,start_date,renewal_date,created_at,updated_at)
      VALUES(?,?,?,?,?,'admin@pkic.org',?,'active','2026-01-01T00:00:00.000Z','2026-10-01',?,?)`).bind(
      id,
      type,
      organizationId,
      eventId,
      organizationId ? null : `Sponsor ${id}`,
      tier,
      AT,
      AT,
    ),
    env.DB.prepare(`INSERT INTO sponsorship_periods(id,sponsorship_id,tier,started_at,scheduled_end_at,recorded_at)
      VALUES(?,?,?,'2026-01-01T00:00:00.000Z',?,?)`).bind(crypto.randomUUID(), id, tier, EXPIRES, AT),
  ]);
  return id;
}
async function event(starts = "2026-09-01T09:00:00.000Z", ends = "2026-09-03T18:00:00.000Z") {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO events(id,slug,name,timezone,starts_at,ends_at,created_at,updated_at)
    VALUES(?,?,'Sponsor policy event','UTC',?,?,?,?)`)
    .bind(id, `policy-${id}`, starts, ends, AT, AT)
    .run();
  return id;
}
async function transition(id: string, reason: SponsorshipEndReason = "ordinary_expiry", at = AT) {
  const subject = (await getSponsorship(env.DB, id))!;
  const prepared = prepareSponsorshipStageTransition(env.DB, subject, {
    toStage: "lapsed",
    endReason: reason,
    actor: null,
    note: null,
    auditAction: "test_sponsor_expiry",
    now: at,
  });
  await env.DB.batch(prepared.statements);
}
async function wall(at = AT, eventId?: string) {
  const model = buildPublicSponsorReadModel({ eventId });
  return (
    await env.DB.prepare(
      model.sql.replace("strftime('%Y-%m-%dT%H:%M:%fZ','now')", "?") +
        " SELECT id,tier,event_tier FROM enriched_sponsors WHERE effective_weight>0 ORDER BY id",
    )
      .bind(at, ...model.bindings)
      .all<{ id: string; tier: string | null; event_tier: string | null }>()
  ).results;
}
async function requests() {
  return (await env.DB.prepare("SELECT id FROM site_publication_requests").all()).results;
}

beforeEach(async () => {
  await resetDb();
  await seedEventAndAdmin(env.DB);
  userId = (await env.DB.prepare("SELECT id FROM users WHERE email='admin@pkic.org'").first<{ id: string }>())!.id;
});

describe("consortium logo courtesy and event history", () => {
  it.each(["Silver", "Gold", "Platinum", "Titanium", "Diamond"])(
    "retains %s until the exclusive 90-day UTC deadline",
    async (tier) => {
      const id = await sponsor({ tier });
      await transition(id);
      expect((await wall()).map((row) => row.id)).toContain(id);
      expect((await wall("2026-12-29T23:59:59.999Z")).map((row) => row.id)).toContain(id);
      expect((await wall(GRACE_END)).map((row) => row.id)).not.toContain(id);
      expect((await getSponsorship(env.DB, id))!.pipeline_stage).toBe("lapsed");
      expect(await env.DB.prepare("SELECT logo_action_due_at FROM sponsorships WHERE id=?").bind(id).first()).toEqual({
        logo_action_due_at: GRACE_END,
      });
    },
  );
  it.each(["Bronze", "Supporting"])("does not extend %s display", async (tier) => {
    const id = await sponsor({ tier });
    await transition(id);
    expect(await wall()).toEqual([]);
  });
  it.each(["withdrawal", "termination", "refund", "dispute"] as const)(
    "removes %s immediately, including during grace and on archived events",
    async (reason) => {
      const eventId = await event();
      const id = await sponsor();
      await transition(id);
      expect((await wall(AT, eventId)).map((row) => row.id)).toContain(id);
      await transition(id, reason);
      expect(await wall()).toEqual([]);
      expect(await wall(AT, eventId)).toEqual([]);
    },
  );
  it("keeps the logo during delayed auto-lapse but never adds grace on a live event page", async () => {
    const id = await sponsor();
    const eventId = await event("2026-10-17T09:00:00.000Z", "2026-10-18T18:00:00.000Z");
    expect((await wall()).map((row) => row.id)).toContain(id);
    expect(await wall(AT, eventId)).toEqual([]);
  });
  it("retains past support outside grace and excludes sponsorship begun after the event", async () => {
    const past = await event();
    const id = await sponsor();
    await transition(id);
    expect((await wall("2027-06-01T00:00:00.000Z", past)).map((row) => row.id)).toContain(id);
    const earlier = await event("2025-01-01T00:00:00.000Z", "2025-01-02T00:00:00.000Z");
    expect(await wall(AT, earlier)).toEqual([]);
  });
  it("shows a new active agreement's tier once per organization", async () => {
    const orgId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO organizations(id,name,normalized_name,created_at,updated_at)
      VALUES(?,'Sponsor Org','sponsor org',?,?)`)
      .bind(orgId, AT, AT)
      .run();
    const old = await sponsor({ organizationId: orgId, tier: "Diamond" });
    await transition(old);
    const renewed = await sponsor({ organizationId: orgId, tier: "Silver" });
    await env.DB.prepare("UPDATE sponsorships SET renewal_date='2027-10-01' WHERE id=?").bind(renewed).run();
    expect(await wall()).toEqual([{ id: orgId, tier: "Silver", event_tier: null }]);
  });
  it("ends old grace permanently when a replacement agreement activates", async () => {
    const orgId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO organizations(id,name,normalized_name,created_at,updated_at)
      VALUES(?,'Renewed Org','renewed org',?,?)`)
      .bind(orgId, AT, AT)
      .run();
    const old = await sponsor({ organizationId: orgId, tier: "Diamond" });
    await transition(old);
    const replacement = await sponsor({ organizationId: orgId, tier: "Silver" });
    await env.DB.prepare("DELETE FROM sponsorship_periods WHERE sponsorship_id=?").bind(replacement).run();
    await env.DB.prepare(
      "UPDATE sponsorships SET pipeline_stage='payment_pending',renewal_date='2027-10-01' WHERE id=?",
    )
      .bind(replacement)
      .run();
    const prepared = prepareSponsorshipStageTransition(env.DB, (await getSponsorship(env.DB, replacement))!, {
      toStage: "active",
      actor: null,
      note: null,
      auditAction: "test_renewal",
      now: AT,
    });
    await env.DB.batch(prepared.statements);
    await transition(replacement, "withdrawal");
    expect(await wall()).toEqual([]);
  });

  it("keeps the tier during the event when a later active tier changes", async () => {
    const eventId = await event();
    const id = await sponsor({ tier: "Gold" });
    await env.DB.prepare("UPDATE sponsorships SET renewal_date='2027-10-01' WHERE id=?").bind(id).run();
    await updateSponsorship(env.DB, userId, id, { tier: "Silver" });
    expect((await wall(AT, eventId))[0]?.tier).toBe("Gold");
    expect((await wall("2027-01-01T00:00:00.000Z"))[0]?.tier).toBe("Silver");
  });
  it("does not move an ended period's grace by editing the inactive renewal date", async () => {
    const id = await sponsor();
    await transition(id);
    await updateSponsorship(env.DB, userId, id, { renewalDate: "2028-01-01" });
    expect(await wall(GRACE_END)).toEqual([]);
  });
  it("keeps the event's own previously active sponsors on that event only", async () => {
    const eventId = await event();
    const id = await sponsor({ type: "event", tier: "Leader", eventId });
    await transition(id);
    expect(await wall()).toEqual([]);
    expect((await wall("2027-06-01T00:00:00.000Z", eventId)).map((row) => row.id)).toContain(id);
  });
  it("does not extend live sponsor capacity while the expiry job is late", async () => {
    const eventId = await event();
    const id = await sponsor({ type: "event", eventId });
    await env.DB.prepare("UPDATE sponsorships SET renewal_date=? WHERE id=?")
      .bind(new Date(Date.now() - 86400000).toISOString().slice(0, 10), id)
      .run();
    expect(await findActiveSponsorCapacityForUser(env.DB, userId, id, eventId)).toBeNull();
  });
});

describe("durable logo publication deadlines", () => {
  it("queues expiry once and archive publication once per event end", async () => {
    const eventId = await event();
    const id = await sponsor();
    await transition(id);
    await env.DB.prepare("DELETE FROM site_publication_requests").run();
    expect(await runSponsorLogoDueWork(env.DB, GRACE_END)).toEqual({ expired: 1, archived: expect.any(Number) });
    const first = (await requests()).length;
    expect(first).toBeGreaterThanOrEqual(2);
    expect(await runSponsorLogoDueWork(env.DB, GRACE_END)).toEqual({ expired: 0, archived: 0 });
    expect((await requests()).length).toBe(first);
    await env.DB.prepare("UPDATE events SET ends_at='2026-09-04T18:00:00.000Z' WHERE id=?").bind(eventId).run();
    expect((await runSponsorLogoDueWork(env.DB, GRACE_END)).archived).toBe(1);
  });
  it("rolls back an obsolete expiry marker when renewal wins the race", async () => {
    const id = await sponsor();
    await transition(id);
    await env.DB.prepare("DELETE FROM site_publication_requests").run();
    // Avoid unrelated seeded events in this deadline race.
    await runSponsorLogoDueWork(env.DB, GRACE_END, 0);
    await env.DB.prepare(
      `INSERT INTO sponsor_event_archives(event_id,ended_at,published_at) SELECT id,ends_at,? FROM events WHERE ends_at IS NOT NULL`,
    )
      .bind(AT)
      .run();
    await env.DB.prepare("DELETE FROM site_publication_requests").run();
    const gate = gateNextBatch(env.DB);
    const running = runSponsorLogoDueWork(gate.db, GRACE_END);
    await gate.reached;
    await env.DB.prepare(`UPDATE sponsorships SET pipeline_stage='active',logo_action_due_at=NULL,
      transition_revision=transition_revision+1 WHERE id=?`)
      .bind(id)
      .run();
    gate.release();
    expect((await running).expired).toBe(0);
    expect(await requests()).toEqual([]);
  });
});

describe("verified payment withdrawals", () => {
  it("requires a provider event identity before changing an agreement", async () => {
    await expect(
      dispatchStripePaymentEvent(
        env.DB,
        env,
        {
          type: "charge.refunded",
          data: { object: { payment_intent: "pi_unidentified", metadata: { pkic_payment_type: "sponsorship" } } },
        },
        "https://app.test",
        () => {},
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(await env.DB.prepare("SELECT id FROM payment_ledger_events").all()).toMatchObject({ results: [] });
  });
  it("rolls back payment evidence and period effects when the agreement changes before the batch", async () => {
    const id = await sponsor();
    await env.DB.prepare(`INSERT INTO payment_ledger_entries(id,purpose,resource_type,resource_id,provider,status,
      provider_payment_intent_id,created_at,updated_at) VALUES(?,'sponsorship','sponsorship',?,'stripe','paid','pi_race',?,?)`)
      .bind(`payment:${id}`, id, AT, AT)
      .run();
    const gate = gateNextBatch(env.DB);
    const pending = dispatchStripePaymentEvent(
      gate.db,
      env,
      { id: "evt_race", type: "charge.refunded", data: { object: { id: "ch_race", payment_intent: "pi_race" } } },
      "https://app.test",
      () => {},
    );
    await gate.reached;
    await env.DB.prepare("UPDATE sponsorships SET transition_revision=transition_revision+1 WHERE id=?").bind(id).run();
    gate.release();
    await expect(pending).rejects.toThrow();
    expect((await getSponsorship(env.DB, id))!.pipeline_stage).toBe("active");
    expect(
      await env.DB.prepare("SELECT ended_at FROM sponsorship_periods WHERE sponsorship_id=?").bind(id).first(),
    ).toEqual({ ended_at: null });
    expect(
      await env.DB.prepare("SELECT status FROM payment_ledger_entries WHERE resource_id=?").bind(id).first(),
    ).toEqual({ status: "paid" });
    expect(await requests()).toEqual([]);
  });
  it.each(["charge.refunded", "charge.dispute.created"])(
    "commits %s with stage, periods and ledger; retries do not repeat history",
    async (type) => {
      const id = await sponsor();
      await env.DB.prepare(`INSERT INTO payment_ledger_entries(id,purpose,resource_type,resource_id,provider,status,
      provider_payment_intent_id,created_at,updated_at) VALUES(?,'sponsorship','sponsorship',?,'stripe','paid','pi_logo',?,?)`)
        .bind(`payment:${id}`, id, AT, AT)
        .run();
      const evidence = {
        id: "evt_logo_adjustment",
        type,
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: "ch_logo", payment_intent: "pi_logo", amount: 100, currency: "usd" } },
      };
      await dispatchStripePaymentEvent(env.DB, env, evidence, "https://app.test", () => {});
      const changed = await getSponsorship(env.DB, id);
      expect(changed!.pipeline_stage).toBe("lapsed");
      expect(changed!.ended_reason).toBe(type === "charge.refunded" ? "refund" : "dispute");
      expect(await wall()).toEqual([]);
      const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM sponsorship_events WHERE sponsorship_id=?")
        .bind(id)
        .first();
      await dispatchStripePaymentEvent(env.DB, env, evidence, "https://app.test", () => {});
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS n FROM sponsorship_events WHERE sponsorship_id=?").bind(id).first(),
      ).toEqual(count);
      expect(
        await env.DB.prepare("SELECT status FROM payment_ledger_entries WHERE resource_id=?").bind(id).first(),
      ).toEqual({ status: type === "charge.refunded" ? "refunded" : "disputed" });
    },
  );
});
