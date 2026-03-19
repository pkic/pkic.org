import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { onRequestPost } from "../functions/api/v1/donations/checkout";
import { createContext } from "./helpers/context";
import { handleError } from "../functions/_lib/http";
import type { Env, PagesContext } from "../functions/_lib/types";
import { SUPPORTED_CURRENCY_CODES, currencyForCountry, toSmallestUnit, toMajorUnit } from "../assets/shared/constants/currencies";
import { donationCheckoutSchema } from "../assets/shared/schemas/donation";

// ── Schema validation ──────────────────────────────────────────────────────

describe("donationCheckoutSchema", () => {
  it("accepts a valid minimal payload", () => {
    const result = donationCheckoutSchema.safeParse({
      amount: 5000,
      currency: "usd",
      name: "Alice Example",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a full payload with all optional fields", () => {
    const result = donationCheckoutSchema.safeParse({
      amount: 10000,
      currency: "eur",
      name: "Alice Example",
      email: "alice@example.com",
      organizationName: "Example Corp",
      successPath: "/events/2026/pqc/confirm/",
      cancelPath: "/events/2026/pqc/register/",
      metadata: { source: "/events/2026/pqc/" },
      embedded: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts embedded: false explicitly", () => {
    const result = donationCheckoutSchema.safeParse({
      amount: 5000,
      currency: "usd",
      name: "Alice",
      embedded: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects amount below minimum", () => {
    const result = donationCheckoutSchema.safeParse({ amount: 50, currency: "usd", name: "Alice" });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer amount", () => {
    const result = donationCheckoutSchema.safeParse({ amount: 50.5, currency: "usd", name: "Alice" });
    expect(result.success).toBe(false);
  });

  it("rejects negative amount", () => {
    const result = donationCheckoutSchema.safeParse({ amount: -100, currency: "usd", name: "Alice" });
    expect(result.success).toBe(false);
  });

  it("rejects amount above safety cap", () => {
    const result = donationCheckoutSchema.safeParse({ amount: 200_000_000, currency: "usd", name: "Alice" });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported currency", () => {
    const result = donationCheckoutSchema.safeParse({ amount: 5000, currency: "xyz", name: "Alice" });
    expect(result.success).toBe(false);
  });

  it("normalises currency to lowercase", () => {
    const result = donationCheckoutSchema.safeParse({ amount: 5000, currency: "EUR", name: "Alice" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe("eur");
    }
  });

  it("rejects missing name", () => {
    const result = donationCheckoutSchema.safeParse({ amount: 5000, currency: "usd" });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = donationCheckoutSchema.safeParse({ amount: 5000, currency: "usd", name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects successPath that doesn't start with /", () => {
    const result = donationCheckoutSchema.safeParse({
      amount: 5000,
      currency: "usd",
      name: "Alice",
      successPath: "https://evil.com/steal",
    });
    expect(result.success).toBe(false);
  });

  it("rejects successPath containing // (open redirect prevention)", () => {
    const result = donationCheckoutSchema.safeParse({
      amount: 5000,
      currency: "usd",
      name: "Alice",
      successPath: "//evil.com/steal",
    });
    expect(result.success).toBe(false);
  });

  it("rejects cancelPath with open redirect", () => {
    const result = donationCheckoutSchema.safeParse({
      amount: 5000,
      currency: "usd",
      name: "Alice",
      cancelPath: "/foo//bar",
    });
    expect(result.success).toBe(false);
  });
});

// ── Currency helpers ────────────────────────────────────────────────────────

describe("currencyForCountry", () => {
  it("returns usd for US", () => expect(currencyForCountry("US")).toBe("usd"));
  it("returns eur for NL", () => expect(currencyForCountry("NL")).toBe("eur"));
  it("returns gbp for GB", () => expect(currencyForCountry("GB")).toBe("gbp"));
  it("returns jpy for JP", () => expect(currencyForCountry("JP")).toBe("jpy"));
  it("returns usd for unknown country", () => expect(currencyForCountry("ZZ")).toBe("usd"));
  it("returns usd for null", () => expect(currencyForCountry(null)).toBe("usd"));
  it("returns usd for undefined", () => expect(currencyForCountry(undefined)).toBe("usd"));
  it("is case-insensitive", () => expect(currencyForCountry("nl")).toBe("eur"));
});

describe("toSmallestUnit / toMajorUnit", () => {
  it("converts USD dollars to cents", () => expect(toSmallestUnit(50, "usd")).toBe(5000));
  it("converts EUR to cents", () => expect(toSmallestUnit(100, "eur")).toBe(10000));
  it("keeps JPY unchanged (zero-decimal)", () => expect(toSmallestUnit(5000, "jpy")).toBe(5000));
  it("keeps KRW unchanged (zero-decimal)", () => expect(toSmallestUnit(50000, "krw")).toBe(50000));
  it("round-trips USD correctly", () => expect(toMajorUnit(toSmallestUnit(250, "usd"), "usd")).toBe(250));
  it("round-trips JPY correctly", () => expect(toMajorUnit(toSmallestUnit(1000, "jpy"), "jpy")).toBe(1000));
});

// ── Checkout endpoint ───────────────────────────────────────────────────────

describe("POST /api/v1/donations/checkout", () => {
  const originalFetch = globalThis.fetch;

  /** Returns a chainable DB stub: prepare().bind().run() / .first() */
  function makeDbStub(runResult: object = { success: true, meta: { changes: 1 } }) {
    const stmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue(runResult),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    return { prepare: vi.fn().mockReturnValue(stmt) } as unknown as Env["DB"];
  }

  function makeEnv(overrides: Partial<Env> = {}): Env {
    // Donation checkout doesn't use R2 — provide a minimal Env stub with DB mock
    return {
      DB: makeDbStub(),
      ASSETS_BUCKET: {} as Env["ASSETS_BUCKET"],
      CF_PAGES_URL: "https://pkic.org",
      DEFAULT_MIN_PROPOSAL_REVIEWS: "2",
      DEFAULT_REFERRAL_CODE_LENGTH: "7",
      DEFAULT_INVITE_LIMIT_PER_ATTENDEE: "5",
      WAITLIST_CLAIM_WINDOW_HOURS: "24",
      MAGIC_LINK_TTL_MINUTES: "15",
      MANAGE_TOKEN_TTL_HOURS: "48",
      SENDGRID_API_BASE: "https://api.sendgrid.com/v3/mail/send",
      SENDGRID_API_KEY: "test-key",
      SENDGRID_FROM_EMAIL: "noreply@pkic.org",
      SENDGRID_FROM_NAME: "PKI Consortium",
      EMAIL_LAYOUT_R2_KEY: "layouts/email/default.html",
      INTERNAL_SIGNING_SECRET: "test-signing-secret",
      FEEDBACK_IDENTITY_SECRET_V1: "feedback-secret",
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_PUBLISHABLE_KEY: "pk_test_fake",
      ...overrides,
    };
  }

  function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
    return new Request("https://pkic.org/api/v1/donations/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  function makeContext(env: Env, request: Request): PagesContext {
    return createContext(env, request, {});
  }

  /** Wraps onRequestPost with the same error handling as the API middleware */
  async function callEndpoint(ctx: PagesContext): Promise<Response> {
    try {
      return await onRequestPost(ctx);
    } catch (error) {
      return handleError(error);
    }
  }

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 503 when STRIPE_SECRET_KEY is not configured", async () => {
    const env = makeEnv({ STRIPE_SECRET_KEY: undefined });
    const ctx = makeContext(env, makeRequest({ amount: 5000, currency: "usd", name: "Test Donor" }));
    const response = await callEndpoint(ctx);
    expect(response.status).toBe(503);
    const body = await response.json() as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe("SERVICE_UNAVAILABLE");
  });

  it("returns 400 for invalid JSON body", async () => {
    const env = makeEnv();
    const request = new Request("https://pkic.org/api/v1/donations/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: "not json",
    });
    const ctx = makeContext(env, request);
    const response = await callEndpoint(ctx);
    expect(response.status).toBe(400);
  });

  it("returns 400 for missing required fields", async () => {
    const env = makeEnv();
    const ctx = makeContext(env, makeRequest({}));
    const response = await callEndpoint(ctx);
    expect(response.status).toBe(400);
    const body = await response.json() as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe("VALIDATION_ERROR");
  });

  it("returns 403 for cross-origin requests", async () => {
    const env = makeEnv();
    const request = makeRequest({ amount: 5000, currency: "usd", name: "Test Donor" }, {
      "sec-fetch-site": "cross-site",
    });
    const ctx = makeContext(env, request);
    const response = await callEndpoint(ctx);
    expect(response.status).toBe(403);
  });

  it("returns clientSecret and publishableKey for embedded checkout", async () => {
    const mockStripeResponse = {
      id: "cs_test_embedded123",
      client_secret: "cs_test_embedded123_secret_fake",
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(mockStripeResponse), { status: 200 }),
    );

    const env = makeEnv();
    const ctx = makeContext(env, makeRequest({
      amount: 10000,
      currency: "usd",
      name: "Alice Donor",
      embedded: true,
    }));
    const response = await callEndpoint(ctx);
    expect(response.status).toBe(200);

    const body = await response.json() as { clientSecret: string; publishableKey: string };
    expect(body.clientSecret).toBe("cs_test_embedded123_secret_fake");
    expect(body.publishableKey).toBe("pk_test_fake");

    const [, stripeInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const params = new URLSearchParams(stripeInit.body as string);
    expect(params.get("ui_mode")).toBe("embedded");
    expect(params.get("return_url")).toContain("/donate/complete/");
    expect(params.get("return_url")).toContain("{CHECKOUT_SESSION_ID}");
    expect(params.has("success_url")).toBe(false);
    expect(params.has("cancel_url")).toBe(false);
  });

  it("returns checkout URL on success", async () => {
    const mockStripeResponse = {
      id: "cs_test_fake123",
      url: "https://checkout.stripe.com/c/pay_fake123",
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(mockStripeResponse), { status: 200 }),
    );

    const env = makeEnv();
    const ctx = makeContext(env, makeRequest({
      amount: 10000,
      currency: "eur",
      name: "Alice Donor",
      email: "donor@example.com",
    }));
    const response = await callEndpoint(ctx);
    expect(response.status).toBe(200);

    const body = await response.json() as { url: string };
    expect(body.url).toBe("https://checkout.stripe.com/c/pay_fake123");

    // Verify Stripe was called correctly
    const [stripeUrl, stripeInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(stripeUrl).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(stripeInit.headers).toEqual(expect.objectContaining({
      "Authorization": "Bearer sk_test_fake",
    }));

    const params = new URLSearchParams(stripeInit.body as string);
    expect(params.get("mode")).toBe("payment");
    expect(params.get("submit_type")).toBe("donate");
    expect(params.get("line_items[0][price_data][currency]")).toBe("eur");
    expect(params.get("line_items[0][price_data][unit_amount]")).toBe("10000");
    expect(params.get("customer_email")).toBe("donor@example.com");
    expect(params.get("custom_text[submit][message]")).toContain("voluntary");
    expect(params.get("success_url")).toContain("/donate/complete/");
    expect(params.get("success_url")).toContain("{CHECKOUT_SESSION_ID}");
    expect(params.get("metadata[donor_name]")).toBe("Alice Donor");

    // Verify D1 insert was called with the session ID
    const db = env.DB as ReturnType<typeof makeDbStub>;
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("checkout_session_id"));
  });

  it("uses the Pages branch alias when CF_PAGES_BRANCH is set", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ id: "cs_test_branch", url: "https://checkout.stripe.com/c/pay_branch" }), { status: 200 }),
    );

    const env = makeEnv({
      CF_PAGES_URL: "https://39431008.pkic.pages.dev",
      CF_PAGES_BRANCH: "events",
    });
    const ctx = makeContext(env, makeRequest({
      amount: 10000,
      currency: "usd",
      name: "Branch Alias Donor",
    }, {
      origin: "https://events.pkic.pages.dev",
    }));

    const response = await callEndpoint(ctx);
    expect(response.status).toBe(200);

    const [, stripeInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const params = new URLSearchParams(stripeInit.body as string);
    expect(params.get("success_url")).toContain("https://events.pkic.pages.dev/donate/complete/");
    expect(params.get("cancel_url")).toContain("https://events.pkic.pages.dev/donate/");
  });

  it("passes custom success/cancel paths and metadata", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ id: "cs_test_fake", url: "https://checkout.stripe.com/c/pay_fake" }), { status: 200 }),
    );

    const env = makeEnv();
    const ctx = makeContext(env, makeRequest({
      amount: 25000,
      currency: "gbp",
      name: "Bob Donor",
      successPath: "/events/2026/pqc/confirm/",
      cancelPath: "/events/2026/pqc/register/",
      metadata: { source: "/events/2026/pqc/" },
    }));
    const response = await callEndpoint(ctx);
    expect(response.status).toBe(200);

    const [, stripeInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const params = new URLSearchParams(stripeInit.body as string);
    expect(params.get("success_url")).toContain("/events/2026/pqc/confirm/");
    expect(params.get("cancel_url")).toContain("/events/2026/pqc/register/");
    expect(params.get("metadata[source]")).toBe("/events/2026/pqc/");
  });

  it("returns 502 when Stripe API fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }),
    );

    const env = makeEnv();
    const ctx = makeContext(env, makeRequest({ amount: 5000, currency: "usd", name: "Test Donor" }));
    const response = await callEndpoint(ctx);
    expect(response.status).toBe(502);
  });

  it("does not include customer_email when not provided", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ id: "cs_test_no_email", url: "https://checkout.stripe.com/pay" }), { status: 200 }),
    );

    const env = makeEnv();
    const ctx = makeContext(env, makeRequest({ amount: 5000, currency: "usd", name: "Test Donor" }));
    await callEndpoint(ctx);

    const [, stripeInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const params = new URLSearchParams(stripeInit.body as string);
    expect(params.has("customer_email")).toBe(false);
  });

  it("includes organizationName in Stripe metadata when provided", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ id: "cs_test_org", url: "https://checkout.stripe.com/pay" }), { status: 200 }),
    );

    const env = makeEnv();
    const ctx = makeContext(env, makeRequest({
      amount: 5000,
      currency: "usd",
      name: "Carol Donor",
      organizationName: "ACME Corp",
    }));
    await callEndpoint(ctx);

    const [, stripeInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const params = new URLSearchParams(stripeInit.body as string);
    expect(params.get("metadata[donor_organization]")).toBe("ACME Corp");
  });
});

// ── Stripe webhook ──────────────────────────────────────────────────────────

describe("POST /api/v1/webhooks/stripe", () => {
  const originalFetch = globalThis.fetch;

  let webhookOnRequest: (ctx: PagesContext) => Promise<Response>;

  beforeAll(async () => {
    const mod = await import("../functions/api/v1/webhooks/stripe.js");
    webhookOnRequest = mod.onRequestPost;
  });

  function makeWebhookEnv(overrides: Partial<Env> = {}): Env {
    const stmt = {
      bind: vi.fn().mockReturnThis(),
      run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: [] }),
    };
    const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as Env["DB"];
    return {
      DB: db,
      ASSETS_BUCKET: {} as Env["ASSETS_BUCKET"],
      CF_PAGES_URL: "https://pkic.org",
      DEFAULT_MIN_PROPOSAL_REVIEWS: "2",
      DEFAULT_REFERRAL_CODE_LENGTH: "7",
      DEFAULT_INVITE_LIMIT_PER_ATTENDEE: "5",
      WAITLIST_CLAIM_WINDOW_HOURS: "24",
      MAGIC_LINK_TTL_MINUTES: "15",
      MANAGE_TOKEN_TTL_HOURS: "48",
      SENDGRID_API_BASE: "https://api.sendgrid.com/v3/mail/send",
      SENDGRID_API_KEY: "test-key",
      SENDGRID_FROM_EMAIL: "noreply@pkic.org",
      SENDGRID_FROM_NAME: "PKI Consortium",
      EMAIL_LAYOUT_R2_KEY: "layouts/email/default.html",
      INTERNAL_SIGNING_SECRET: "test-signing-secret",
      FEEDBACK_IDENTITY_SECRET_V1: "feedback-secret",
      STRIPE_SECRET_KEY: "sk_test_fake",
      STRIPE_WEBHOOK_SECRET: "whsec_test_fake",
      ...overrides,
    };
  }

  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("returns 503 when STRIPE_WEBHOOK_SECRET is not configured", async () => {
    const env = makeWebhookEnv({ STRIPE_WEBHOOK_SECRET: undefined });
    const request = new Request("https://pkic.org/api/v1/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": "t=123,v1=abc" },
      body: JSON.stringify({ type: "checkout.session.completed" }),
    });
    const ctx = createContext(env, request, {});
    const response = await webhookOnRequest(ctx);
    expect(response.status).toBe(503);
  });

  it("returns 400 when stripe-signature header is missing", async () => {
    const env = makeWebhookEnv();
    const request = new Request("https://pkic.org/api/v1/webhooks/stripe", {
      method: "POST",
      body: JSON.stringify({ type: "checkout.session.completed" }),
    });
    const ctx = createContext(env, request, {});
    const response = await webhookOnRequest(ctx);
    expect(response.status).toBe(400);
  });

  it("returns 400 for an invalid/tampered signature", async () => {
    const env = makeWebhookEnv();
    const request = new Request("https://pkic.org/api/v1/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=badhash` },
      body: '{"type":"checkout.session.completed"}',
    });
    const ctx = createContext(env, request, {});
    const response = await webhookOnRequest(ctx);
    expect(response.status).toBe(400);
  });
});

// ── Donation session endpoint ───────────────────────────────────────────────

describe("GET /api/v1/donations/session", () => {
  let sessionOnRequest: (ctx: PagesContext) => Promise<Response>;

  beforeAll(async () => {
    const mod = await import("../functions/api/v1/donations/session.js");
    sessionOnRequest = mod.onRequestGet;
  });

  function makeSessionEnv(firstResult: object | null = null): Env {
    const stmt = {
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(firstResult),
    };
    const db = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as Env["DB"];
    return {
      DB: db,
      ASSETS_BUCKET: {} as Env["ASSETS_BUCKET"],
      CF_PAGES_URL: "https://pkic.org",
      DEFAULT_MIN_PROPOSAL_REVIEWS: "2",
      DEFAULT_REFERRAL_CODE_LENGTH: "7",
      DEFAULT_INVITE_LIMIT_PER_ATTENDEE: "5",
      WAITLIST_CLAIM_WINDOW_HOURS: "24",
      MAGIC_LINK_TTL_MINUTES: "15",
      MANAGE_TOKEN_TTL_HOURS: "48",
      SENDGRID_API_BASE: "https://api.sendgrid.com/v3/mail/send",
      SENDGRID_API_KEY: "test-key",
      SENDGRID_FROM_EMAIL: "noreply@pkic.org",
      SENDGRID_FROM_NAME: "PKI Consortium",
      EMAIL_LAYOUT_R2_KEY: "layouts/email/default.html",
      INTERNAL_SIGNING_SECRET: "test-signing-secret",
      FEEDBACK_IDENTITY_SECRET_V1: "feedback-secret",
      STRIPE_SECRET_KEY: "sk_test_fake",
    };
  }

  it("returns 400 when session_id query param is missing", async () => {
    const env = makeSessionEnv();
    const request = new Request("https://pkic.org/api/v1/donations/session");
    const ctx = createContext(env, request, {});
    const response = await sessionOnRequest(ctx);
    expect(response.status).toBe(400);
  });

  it("returns 400 when session_id does not start with cs_", async () => {
    const env = makeSessionEnv();
    const request = new Request("https://pkic.org/api/v1/donations/session?session_id=pi_invalid");
    const ctx = createContext(env, request, {});
    const response = await sessionOnRequest(ctx);
    expect(response.status).toBe(400);
  });

  it("returns 202 with pending:true when session not yet completed", async () => {
    const env = makeSessionEnv(null);
    const request = new Request("https://pkic.org/api/v1/donations/session?session_id=cs_test_pending");
    const ctx = createContext(env, request, {});
    const response = await sessionOnRequest(ctx);
    expect(response.status).toBe(202);
    const body = await response.json() as { pending: boolean };
    expect(body.pending).toBe(true);
  });

  it("returns 200 with badge data for a completed session", async () => {
    const dbRow = {
      gross_amount: 5000,
      currency: "usd",
      name: "Alice Donor",
      source: "/events/2026/pqc/",
      completed_at: "2026-01-01T10:00:00Z",
    };
    const env = makeSessionEnv(dbRow);
    const request = new Request("https://pkic.org/api/v1/donations/session?session_id=cs_test_done");
    const ctx = createContext(env, request, {});
    const response = await sessionOnRequest(ctx);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.grossAmount).toBe(5000);
    expect(body.currency).toBe("usd");
    expect(body.donorFirstName).toBe("Alice");
    expect(body.source).toBe("/events/2026/pqc/");
  });
});
