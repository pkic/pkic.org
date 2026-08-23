/**
 * donation-session-promoter-webhook.test.ts
 *
 * Covers:
 *  - GET  /api/v1/donations/session?session_id=...    (positive, negative)
 *  - POST /api/v1/donations/promoter                  (positive, negative)
 *  - POST /api/v1/webhooks/stripe                     (various event types)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { createContext } from "./helpers/context";
import { onRequestGet as donationSession } from "../functions/api/v1/donations/session";
import { onRequestPost as stripeWebhook } from "../functions/api/v1/webhooks/stripe";
import { handleDonationStripeEvent } from "../functions/_lib/services/donations/stripe-webhook";
import app from "../functions/router";

const PROVIDER_BODY_SENTINEL = "SECRET_PROVIDER_BODY webhook@example.test";

function mountedDonationPromoter(request: Request): Promise<Response> {
  return app.fetch(request, env as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any);
}

async function insertDonation(opts: {
  sessionId: string;
  status: string;
  name?: string;
  grossAmount?: number;
  email?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO donations (id, checkout_session_id, status, name, email, currency, gross_amount, completed_at, created_at)
     VALUES (?, ?, ?, ?, ?, 'usd', ?, ${opts.status === "completed" ? "datetime('now')" : "NULL"}, datetime('now'))`,
  )
    .bind(
      id,
      opts.sessionId,
      opts.status,
      opts.name ?? "Alice Donor",
      opts.email ?? "alice@example.test",
      opts.grossAmount ?? 5000,
    )
    .run();
  return id;
}

describe("GET /api/v1/donations/session", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns badge data for a completed donation", async () => {
    await insertDonation({
      sessionId: "cs_test_completed",
      status: "completed",
      name: "Bob Smith",
      grossAmount: 10000,
    });

    const response = await donationSession(
      createContext(env, new Request("https://app.test/api/v1/donations/session?session_id=cs_test_completed"), {}),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      grossAmount: number;
      currency: string;
      donorFirstName: string;
    };
    expect(body.grossAmount).toBe(10000);
    expect(body.currency).toBe("usd");
    expect(body.donorFirstName).toBe("Bob");
  });

  it("returns 202 pending for an incomplete donation", async () => {
    await insertDonation({ sessionId: "cs_test_pending", status: "pending" });

    const response = await donationSession(
      createContext(env, new Request("https://app.test/api/v1/donations/session?session_id=cs_test_pending"), {}),
    );

    expect(response.status).toBe(202);
    const body = (await response.json()) as { pending: boolean };
    expect(body.pending).toBe(true);
  });

  it("returns 400 for an invalid session_id", async () => {
    const response = await donationSession(
      createContext(env, new Request("https://app.test/api/v1/donations/session?session_id=invalid"), {}),
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 for missing session_id", async () => {
    const response = await donationSession(
      createContext(env, new Request("https://app.test/api/v1/donations/session"), {}),
    );

    expect(response.status).toBe(400);
  });

  it("returns 202 for non-existent session_id", async () => {
    const response = await donationSession(
      createContext(env, new Request("https://app.test/api/v1/donations/session?session_id=cs_nonexistent"), {}),
    );

    expect(response.status).toBe(202);
  });
});

describe("POST /api/v1/donations/promoter", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a share code for a completed donation", async () => {
    await insertDonation({ sessionId: "cs_test_promo", status: "completed" });

    const response = await mountedDonationPromoter(
      new Request("https://app.test/api/v1/donations/promoter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: "cs_test_promo" }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { code: string; shareUrl: string; ogImageUrl: string };
    expect(body.code).toBeTruthy();
    expect(body.shareUrl).toContain("/donate/");
    expect(body.ogImageUrl).toContain("cs_test_promo");
  });

  it("returns the same code on subsequent calls (idempotent)", async () => {
    await insertDonation({ sessionId: "cs_test_idempotent", status: "completed" });

    const request = () =>
      new Request("https://app.test/api/v1/donations/promoter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: "cs_test_idempotent" }),
      });
    const response1 = await mountedDonationPromoter(request());
    const body1 = (await response1.json()) as { code: string };

    const response2 = await mountedDonationPromoter(request());
    const body2 = (await response2.json()) as { code: string };

    expect(body1.code).toBe(body2.code);
  });

  it("creates one promoter when concurrent requests race", async () => {
    const donationId = await insertDonation({ sessionId: "cs_test_concurrent_promoter", status: "completed" });
    const requestPromoter = () =>
      mountedDonationPromoter(
        new Request("https://app.test/api/v1/donations/promoter", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session_id: "cs_test_concurrent_promoter" }),
        }),
      );

    const responses = await Promise.all([requestPromoter(), requestPromoter(), requestPromoter()]);
    const codes = await Promise.all(
      responses.map(async (response) => ((await response.json()) as { code: string }).code),
    );
    expect(new Set(codes).size).toBe(1);
    const rows = await env.DB.prepare("SELECT code FROM donation_promoters WHERE donation_id = ?")
      .bind(donationId)
      .all();
    expect(rows.results).toHaveLength(1);
  });

  it("rejects for a pending (uncompleted) donation", async () => {
    await insertDonation({ sessionId: "cs_test_uncompleted", status: "pending" });

    const response = await mountedDonationPromoter(
      new Request("https://app.test/api/v1/donations/promoter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: "cs_test_uncompleted" }),
      }),
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects for an invalid session_id format", async () => {
    const response = await mountedDonationPromoter(
      new Request("https://app.test/api/v1/donations/promoter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: "not-valid" }),
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid JSON body", async () => {
    const response = await mountedDonationPromoter(
      new Request("https://app.test/api/v1/donations/promoter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe("POST /api/v1/webhooks/stripe", () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 503 when STRIPE_WEBHOOK_SECRET is not configured", async () => {
    const envWithoutSecret = { ...env, STRIPE_WEBHOOK_SECRET: "" } as typeof env;

    const response = await stripeWebhook(
      createContext(
        envWithoutSecret,
        new Request("https://app.test/api/v1/webhooks/stripe", {
          method: "POST",
          body: "{}",
        }),
        {},
      ),
    );

    expect(response.status).toBe(503);
  });

  it("returns 400 when stripe-signature header is missing", async () => {
    const response = await stripeWebhook(
      createContext(
        env,
        new Request("https://app.test/api/v1/webhooks/stripe", {
          method: "POST",
          body: "{}",
        }),
        {},
      ),
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 for an invalid/tampered signature", async () => {
    const response = await stripeWebhook(
      createContext(
        env,
        new Request("https://app.test/api/v1/webhooks/stripe", {
          method: "POST",
          headers: { "stripe-signature": "t=12345,v1=fakesignature" },
          body: JSON.stringify({ type: "checkout.session.completed", data: { object: {} } }),
        }),
        {},
      ),
    );

    expect(response.status).toBe(400);
  });

  it("enqueues one failure notification when Stripe retries the same transition", async () => {
    await insertDonation({ sessionId: "cs_test_failed_retry", status: "pending" });
    const event = {
      id: "evt_failed_retry",
      type: "checkout.session.async_payment_failed",
      data: {
        object: {
          id: "cs_test_failed_retry",
          object: "checkout.session" as const,
          status: "complete" as const,
          payment_status: "unpaid",
          payment_intent: "pi_test_failed_retry",
          payment_method_types: ["sepa_debit"],
          amount_total: 5000,
          currency: "usd",
          customer_email: "alice@example.test",
        },
      },
    };

    await handleDonationStripeEvent(env.DB, env, event, "https://app.test");
    await handleDonationStripeEvent(env.DB, env, event, "https://app.test");

    const outbox = await env.DB.prepare(
      "SELECT id, idempotency_key FROM email_outbox WHERE idempotency_key LIKE 'donation:%:payment_failed'",
    ).all();
    expect(outbox.results).toHaveLength(1);
    const donation = await env.DB.prepare("SELECT status FROM donations WHERE checkout_session_id = ?")
      .bind("cs_test_failed_retry")
      .first<{ status: string }>();
    expect(donation?.status).toBe("failed");
  });

  it("keeps a paid webhook authoritative when supplemental Stripe details fail", async () => {
    await insertDonation({ sessionId: "cs_paid_details_unavailable", status: "pending", email: "" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(PROVIDER_BODY_SENTINEL, { status: 503 })));

    await handleDonationStripeEvent(
      env.DB,
      { ...env, STRIPE_SECRET_KEY: "stripe-test-key" },
      {
        id: "evt_paid_details_unavailable",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_paid_details_unavailable",
            object: "checkout.session" as const,
            status: "complete" as const,
            payment_status: "paid",
            payment_intent: "pi_paid_details_unavailable",
            payment_method_types: ["card"],
            amount_total: 5000,
            currency: "usd",
            customer_email: "",
          },
        },
      },
      "https://app.test",
    );

    const donation = await env.DB.prepare("SELECT status, net_amount FROM donations WHERE checkout_session_id = ?")
      .bind("cs_paid_details_unavailable")
      .first<{ status: string; net_amount: number | null }>();
    expect(donation).toEqual({ status: "completed", net_amount: null });
  });
});
