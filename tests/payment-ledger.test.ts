import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { recordStripePaymentEvent } from "../functions/_lib/services/payments/ledger";
import { dispatchStripePaymentEvent } from "../functions/_lib/services/payments/stripe-webhook";
import type { Env } from "../functions/_lib/types";
import { resetDb } from "./helpers/reset-db";

async function ledgerEntry(sessionId: string) {
  return env.DB.prepare(
    "SELECT id, purpose, resource_type, resource_id, status, amount, currency, " +
      "provider_checkout_session_id, provider_payment_intent_id, latest_provider_event_created " +
      "FROM payment_ledger_entries WHERE provider_checkout_session_id = ?",
  )
    .bind(sessionId)
    .first<Record<string, unknown>>();
}

describe("shared payment ledger", () => {
  beforeEach(resetDb);

  it("records a pending Stripe session and advances it when the provider settles", async () => {
    const pending = {
      id: "evt_pending",
      created: 100,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_sponsor_pending",
          payment_status: "unpaid",
          amount_total: 125_00,
          currency: "usd",
          metadata: { pkic_payment_type: "sponsorship" },
        },
      },
    };
    await recordStripePaymentEvent(env.DB, "sponsorship", pending);

    expect(await ledgerEntry("cs_sponsor_pending")).toMatchObject({
      purpose: "sponsorship",
      resource_type: "sponsorship",
      resource_id: null,
      status: "processing",
      amount: 125_00,
      currency: "usd",
    });

    await recordStripePaymentEvent(env.DB, "sponsorship", {
      ...pending,
      id: "evt_paid",
      created: 101,
      type: "checkout.session.async_payment_succeeded",
      data: { object: { ...pending.data.object, payment_status: "paid", payment_intent: "pi_sponsor" } },
    });

    expect(await ledgerEntry("cs_sponsor_pending")).toMatchObject({
      status: "paid",
      provider_payment_intent_id: "pi_sponsor",
      latest_provider_event_created: 101,
    });
    const events = await env.DB.prepare("SELECT COUNT(*) AS count FROM payment_ledger_events WHERE payment_id = ?")
      .bind("payment:stripe:checkout:cs_sponsor_pending")
      .first<{ count: number }>();
    expect(events?.count).toBe(2);
  });

  it("does not let an older webhook replay roll a settled payment backward", async () => {
    const baseObject = {
      id: "cs_ordered",
      amount_total: 50_00,
      currency: "eur",
      metadata: { pkic_payment_type: "donation" },
    };
    await recordStripePaymentEvent(env.DB, "donation", {
      id: "evt_paid_newer",
      created: 200,
      type: "checkout.session.async_payment_succeeded",
      data: { object: { ...baseObject, payment_status: "paid" } },
    });
    await recordStripePaymentEvent(env.DB, "donation", {
      id: "evt_pending_older",
      created: 100,
      type: "checkout.session.completed",
      data: { object: { ...baseObject, payment_status: "unpaid" } },
    });

    expect(await ledgerEntry("cs_ordered")).toMatchObject({ status: "paid", latest_provider_event_created: 200 });
    const events = await env.DB.prepare("SELECT COUNT(*) AS count FROM payment_ledger_events WHERE payment_id = ?")
      .bind("payment:stripe:checkout:cs_ordered")
      .first<{ count: number }>();
    expect(events?.count).toBe(2);
  });

  it("does not let a pending event from the same provider second replace a settled status", async () => {
    const baseObject = {
      id: "cs_same_second",
      amount_total: 75_00,
      currency: "usd",
      metadata: { pkic_payment_type: "sponsorship" },
    };
    await recordStripePaymentEvent(env.DB, "sponsorship", {
      id: "evt_same_second_paid",
      created: 250,
      type: "checkout.session.async_payment_succeeded",
      data: { object: { ...baseObject, payment_status: "paid" } },
    });
    await recordStripePaymentEvent(env.DB, "sponsorship", {
      id: "evt_same_second_pending",
      created: 250,
      type: "checkout.session.completed",
      data: { object: { ...baseObject, payment_status: "unpaid" } },
    });

    expect(await ledgerEntry("cs_same_second")).toMatchObject({
      status: "paid",
      latest_provider_event_created: 250,
    });
  });

  it("keeps a completed domain payment paid when Stripe replays an older pending event", async () => {
    await env.DB.prepare(
      "INSERT INTO donations " +
        "(id, checkout_session_id, payment_intent_id, name, email, currency, gross_amount, completed_at, status) " +
        "VALUES ('donation-paid', 'cs_domain_paid', 'pi_domain_paid', 'Test', 'test@example.test', " +
        "'usd', 2500, '2026-09-20T08:00:00.000Z', 'completed')",
    ).run();

    await recordStripePaymentEvent(env.DB, "donation", {
      id: "evt_domain_pending_replay",
      created: 50,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_domain_paid",
          payment_intent: "pi_domain_paid",
          payment_status: "unpaid",
          amount_total: 2500,
          currency: "usd",
        },
      },
    });

    expect(await ledgerEntry("cs_domain_paid")).toMatchObject({
      resource_id: "donation-paid",
      status: "paid",
      amount: 2500,
    });
  });

  it("uses the ledger to route a sponsorship refund received after checkout", async () => {
    await recordStripePaymentEvent(env.DB, "sponsorship", {
      id: "evt_sponsorship_paid",
      created: 400,
      type: "checkout.session.async_payment_succeeded",
      data: {
        object: {
          id: "cs_sponsorship_refund",
          payment_intent: "pi_sponsorship_refund",
          payment_status: "paid",
          amount_total: 75000,
          currency: "usd",
        },
      },
    });

    await dispatchStripePaymentEvent(
      env.DB,
      env as Env,
      {
        id: "evt_sponsorship_refunded",
        created: 500,
        type: "charge.refunded",
        data: {
          object: {
            id: "ch_sponsorship_refund",
            payment_intent: "pi_sponsorship_refund",
            amount: 75000,
            currency: "usd",
          },
        },
      },
      "https://app.test",
      () => undefined,
    );

    expect(await ledgerEntry("cs_sponsorship_refund")).toMatchObject({
      purpose: "sponsorship",
      status: "refunded",
    });
  });

  it("records a rejected membership amount as requiring reconciliation", async () => {
    await recordStripePaymentEvent(
      env.DB,
      "membership",
      {
        id: "evt_membership_mismatch",
        created: 300,
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_membership_mismatch",
            payment_status: "paid",
            amount_total: 1,
            currency: "usd",
            metadata: { pkic_payment_type: "membership" },
          },
        },
      },
      "rejected_mismatch",
    );

    expect(await ledgerEntry("cs_membership_mismatch")).toMatchObject({
      purpose: "membership",
      status: "requires_review",
    });
  });
});
