import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { sponsorshipCheckoutResponseSchema, type SponsorshipCheckoutInput } from "../assets/shared/schemas/sponsorship";
import { handleError } from "../functions/_lib/http";
import { handleSponsorshipCheckout } from "../functions/api/v1/sponsorship/checkout";
import { createContext, createTestRateLimiter, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

const originalFetch = globalThis.fetch;
const validBody: SponsorshipCheckoutInput = {
  checkoutAttemptId: "123e4567-e89b-42d3-a456-426614174000",
  contactName: "Casey Sponsor",
  contactEmail: "casey@example.test",
  organizationName: "Example Sponsor Org",
  tier: "Innovator",
  eventId: "pqc-2026",
  successPath: "/events/2026/pqc-2026/sponsors/complete/",
  cancelPath: "/events/2026/pqc-2026/sponsors/",
};

function request(headers: HeadersInit = {}): Request {
  return new Request("https://app.test/api/v1/sponsorship/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.test", ...headers },
    body: JSON.stringify(validBody),
  });
}

async function call(body = validBody, rawRequest = request(), limiter = createTestRateLimiter(10)): Promise<Response> {
  const context = createContext(
    { ...env, STRIPE_SECRET_KEY: "sk_test_sponsorship", IP_RATE_LIMITER: limiter },
    rawRequest,
    {},
  );
  try {
    return await handleSponsorshipCheckout(context, { body });
  } catch (error) {
    return handleError(error);
  }
}

describe("POST /api/v1/sponsorship/checkout", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "cs_test_sponsorship", url: "https://checkout.stripe.test/session" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("forwards the stable checkout attempt as Stripe's idempotency key and immutable metadata", async () => {
    const response = await call();

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = new Headers(init?.headers);
    const form = new URLSearchParams(String(init?.body));
    expect(headers.get("Idempotency-Key")).toBe(`sponsorship:${validBody.checkoutAttemptId}`);
    expect(form.get("metadata[checkout_attempt_id]")).toBe(validBody.checkoutAttemptId);
    expect(form.get("metadata[price_amount_cents]")).toBe("1000000");
    expect(form.get("metadata[price_currency]")).toBe("usd");
    expect(form.get("metadata[event_slug]")).toBe("pqc-2026");
  });

  it("rejects cross-origin browser requests before contacting Stripe", async () => {
    const response = await call(validBody, request({ origin: "https://attacker.test" }));

    expect(response.status).toBe(403);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("enforces the shared public checkout rate limiter", async () => {
    const response = await call(validBody, request(), createTestRateLimiter(0));

    expect(response.status).toBe(429);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps the checkout redirect response absolute like Stripe's session URL", () => {
    expect(sponsorshipCheckoutResponseSchema.parse({ url: "https://checkout.stripe.test/session" })).toEqual({
      url: "https://checkout.stripe.test/session",
    });
    expect(sponsorshipCheckoutResponseSchema.safeParse({ url: "/events/example/sponsors/complete/" }).success).toBe(
      false,
    );
  });
});
