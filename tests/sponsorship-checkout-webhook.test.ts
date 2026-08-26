import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { handleError } from "../functions/_lib/http";
import { onRequestPost } from "../functions/api/v1/sponsorship/checkout/webhook";
import { createContext, queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { renderEmail } from "../functions/_lib/email/render";

const WEBHOOK_SECRET = "whsec_sponsorship_test";

async function stripeSignature(body: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  const digest = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${digest}`;
}

async function callWebhook(event: unknown): Promise<Response> {
  const body = JSON.stringify(event);
  const request = new Request("https://pkic.org/api/v1/sponsorship/checkout/webhook", {
    method: "POST",
    headers: { "stripe-signature": await stripeSignature(body) },
    body,
  });
  try {
    return await onRequestPost(
      createContext(
        {
          ...env,
          STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
          SPONSORSHIP_NOTIFICATION_EMAIL: "sponsorships-team@pkic.org",
        },
        request,
        {},
      ),
    );
  } catch (error) {
    return handleError(error);
  }
}

function paidEvent(eventId: string, sessionId: string, eventDatabaseId: string, type = "checkout.session.completed") {
  return {
    id: eventId,
    type,
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 1_000_000,
        currency: "usd",
        metadata: {
          checkout_attempt_id: "123e4567-e89b-42d3-a456-426614174000",
          tier: "Innovator",
          contact_name: "Casey Sponsor",
          contact_email: "casey@example.test",
          organization_name: "Example Sponsor Org",
          event_id: eventDatabaseId,
          event_slug: "pqc-2026",
          price_amount_cents: "1000000",
          price_currency: "usd",
        },
      },
    },
  };
}

describe("POST /api/v1/sponsorship/checkout/webhook", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("records the paid checkout, both emails, event, and audit exactly once across retries and event types", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const first = await callWebhook(paidEvent("evt_sponsor_1", "cs_sponsor_1", eventId));
    const retry = await callWebhook(paidEvent("evt_sponsor_1", "cs_sponsor_1", eventId));
    const secondPaidType = await callWebhook(
      paidEvent("evt_sponsor_2", "cs_sponsor_1", eventId, "checkout.session.async_payment_succeeded"),
    );

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true, duplicate: false });
    expect(await retry.json()).toEqual({ received: true, duplicate: true });
    expect(await secondPaidType.json()).toEqual({ received: true, duplicate: true });
    expect(
      await queryAll(env.DB, "SELECT id FROM sponsorships WHERE checkout_session_id = 'cs_sponsor_1'"),
    ).toHaveLength(1);
    expect(await queryAll(env.DB, "SELECT id FROM sponsorship_events")).toHaveLength(1);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM email_outbox WHERE template_key IN ('sponsorship-brochure', 'sponsorship-new-inquiry')",
      ),
    ).toHaveLength(2);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'sponsorship_checkout_paid'")).toHaveLength(
      1,
    );
  });

  it("allows an in-flight paid session to complete after its catalog tier is deactivated", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare(
      "UPDATE sponsorship_tier_catalog SET active = 0 WHERE sponsor_type = 'event' AND tier = 'Innovator'",
    ).run();

    try {
      const response = await callWebhook(paidEvent("evt_inactive_tier", "cs_inactive_tier", eventId));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true, duplicate: false });
    } finally {
      await env.DB.prepare(
        "UPDATE sponsorship_tier_catalog SET active = 1 WHERE sponsor_type = 'event' AND tier = 'Innovator'",
      ).run();
    }
  });

  it("renders checkout metadata literally in the staff notification", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const event = paidEvent("evt_untrusted_text", "cs_untrusted_text", eventId);
    event.data.object.metadata.contact_name = "Casey [Sponsor](https://attacker.invalid/name)";
    event.data.object.metadata.organization_name = '<img src="https://attacker.invalid/org.gif">';

    const response = await callWebhook(event);
    expect(response.status).toBe(200);

    const [outbox] = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'sponsorship-new-inquiry' LIMIT 1",
    );
    const rendered = await renderEmail(
      "{{contactNameText}}\n\n{{organizationNameText}}\n\n{{notesText}}",
      JSON.parse(outbox!.payload_json) as Record<string, unknown>,
      "<!doctype html><html><body>{{{body_html}}}</body></html>",
    );

    expect(rendered.text).toContain("attacker.invalid");
    expect(rendered.html).not.toMatch(/<(?:a|img)\b[^>]*(?:href|src)=["']?https:\/\/attacker\.invalid/i);
  });

  it("rejects incomplete signed payment data instead of acknowledging and losing it", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const event = paidEvent("evt_invalid_metadata", "cs_invalid_metadata", eventId);
    delete (event.data.object.metadata as Record<string, unknown>).event_slug;

    const response = await callWebhook(event);

    expect(response.status).toBe(400);
    expect(await queryAll(env.DB, "SELECT id FROM sponsorships")).toHaveLength(0);
  });

  it("rejects a payment whose Stripe amount differs from the immutable metadata snapshot", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const event = paidEvent("evt_price_mismatch", "cs_price_mismatch", eventId);
    event.data.object.amount_total = 999;

    const response = await callWebhook(event);

    expect(response.status).toBe(400);
    expect(await queryAll(env.DB, "SELECT id FROM sponsorships")).toHaveLength(0);
  });

  it("rolls every durable payment effect back if the audit insert fails", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare(
      `CREATE TRIGGER fail_sponsorship_checkout_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'sponsorship_checkout_paid'
       BEGIN
         SELECT RAISE(ABORT, 'forced sponsorship checkout audit failure');
       END`,
    ).run();

    try {
      const response = await callWebhook(paidEvent("evt_atomic_failure", "cs_atomic_failure", eventId));
      expect(response.status).toBe(500);
      expect(await queryAll(env.DB, "SELECT id FROM sponsorships")).toHaveLength(0);
      expect(await queryAll(env.DB, "SELECT id FROM sponsorship_events")).toHaveLength(0);
      expect(
        await queryAll(
          env.DB,
          "SELECT id FROM email_outbox WHERE template_key IN ('sponsorship-brochure', 'sponsorship-new-inquiry')",
        ),
      ).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_sponsorship_checkout_audit").run();
    }
  });
});
