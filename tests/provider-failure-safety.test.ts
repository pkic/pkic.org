import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../functions/_lib/errors";
import { handleError } from "../functions/_lib/http";
import { sendViaSendgrid } from "../functions/_lib/email/sendgrid";
import { createStripeCheckoutSession } from "../functions/_lib/integrations/stripe/checkout";
import {
  fetchStripeCheckoutSession,
  fetchStripePaymentDetails,
} from "../functions/_lib/integrations/stripe/payment-details";
import { providerFailureDetails } from "../functions/_lib/integrations/provider-failure";
import type { Env } from "../functions/_lib/types";

const PROVIDER_BODY_SENTINEL = "SECRET_PROVIDER_BODY alice@example.test";

const sendgridEnv = {
  SENDGRID_API_KEY: "sendgrid-test-key",
  SENDGRID_API_BASE: "https://sendgrid.test/mail/send",
  SENDGRID_FROM_EMAIL: "noreply@example.test",
  SENDGRID_FROM_NAME: "Example",
} as Env;

const sendgridMessage = {
  to: "recipient@example.test",
  subject: "Subject",
  html: "<p>Body</p>",
  text: "Body",
};

function logOutput(spy: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(spy.mock.calls);
}

describe("bounded provider failure handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps SendGrid rejection details bounded and does not read its response body", async () => {
    const response = new Response(PROVIDER_BODY_SENTINEL, { status: 503 });
    const cancel = vi.spyOn(response.body!, "cancel");
    const fetcher = vi.fn().mockResolvedValue(response);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetcher);

    const error = await sendViaSendgrid(sendgridEnv, sendgridMessage).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).details).toEqual({
      kind: "provider_failure",
      provider: "sendgrid",
      operation: "send_email",
      status: 503,
    });
    expect(JSON.stringify((error as AppError).details)).not.toContain(PROVIDER_BODY_SENTINEL);
    expect(logOutput(errorLog)).not.toContain(PROVIDER_BODY_SENTINEL);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("normalizes a SendGrid network failure without persisting the thrown message", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error(`request URL ${PROVIDER_BODY_SENTINEL}`)));

    const error = await sendViaSendgrid(sendgridEnv, sendgridMessage).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).details).toEqual({
      kind: "provider_failure",
      provider: "sendgrid",
      operation: "send_email",
      status: null,
    });
    expect((error as AppError).message).toBe("SendGrid could not be reached");
    expect(logOutput(errorLog)).not.toContain(PROVIDER_BODY_SENTINEL);
  });

  it("keeps a normalized SendGrid failure when response-body cancellation fails", async () => {
    const response = new Response(PROVIDER_BODY_SENTINEL, { status: 503 });
    const cancel = vi.spyOn(response.body!, "cancel").mockRejectedValue(new Error(PROVIDER_BODY_SENTINEL));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const error = await sendViaSendgrid(sendgridEnv, sendgridMessage).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).details).toMatchObject({
      kind: "provider_failure",
      provider: "sendgrid",
      status: 503,
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(logOutput(errorLog)).not.toContain(PROVIDER_BODY_SENTINEL);
  });

  it("uses structured bounded metadata for Stripe checkout failures", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = new Response(PROVIDER_BODY_SENTINEL, { status: 402 });
    const cancel = vi.spyOn(response.body!, "cancel");
    const fetcher = vi.fn().mockResolvedValue(response);

    const error = await createStripeCheckoutSession("stripe-test-key", new URLSearchParams(), {
      idempotencyKey: "attempt-1",
      fetcher,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).details).toEqual({
      kind: "provider_failure",
      provider: "stripe",
      operation: "create_checkout_session",
      status: 402,
    });
    expect(logOutput(errorLog)).not.toContain(PROVIDER_BODY_SENTINEL);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("normalizes Stripe network failures and does not expose the thrown message", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetcher = vi.fn().mockRejectedValue(new Error(`request URL ${PROVIDER_BODY_SENTINEL}`));

    const result = await fetchStripePaymentDetails("stripe-test-key", "pi_test", fetcher);

    expect(result).toEqual({
      ok: false,
      error: providerFailureDetails("stripe", "fetch_payment_details", null),
    });
    expect(logOutput(errorLog)).not.toContain(PROVIDER_BODY_SENTINEL);
  });

  it("distinguishes Stripe payment-detail failure from legitimate empty details", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = new Response(PROVIDER_BODY_SENTINEL, { status: 429 });
    const cancel = vi.spyOn(response.body!, "cancel");
    const failure = await fetchStripePaymentDetails("stripe-test-key", "pi_test", vi.fn().mockResolvedValue(response));
    const empty = await fetchStripePaymentDetails(
      "stripe-test-key",
      "pi_test",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: "pi_test", status: "processing", latest_charge: null }), { status: 200 }),
        ),
    );

    expect(failure.ok).toBe(false);
    expect(empty).toEqual({
      ok: true,
      value: {
        netAmount: null,
        settledAmount: null,
        settledCurrency: null,
        paymentMethodType: null,
        paymentFailed: false,
      },
    });
    expect(logOutput(errorLog)).not.toContain(PROVIDER_BODY_SENTINEL);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("serializes only safe provider metadata through the canonical HTTP error envelope", async () => {
    const response = handleError(
      new AppError(
        502,
        "SENDGRID_SEND_FAILED",
        "SendGrid rejected email",
        providerFailureDetails("sendgrid", "send_email", 400),
      ),
    );
    const body = await response.json();

    expect(body).toEqual({
      error: {
        code: "SENDGRID_SEND_FAILED",
        message: "SendGrid rejected email",
        details: {
          kind: "provider_failure",
          provider: "sendgrid",
          operation: "send_email",
          status: 400,
        },
      },
    });
    expect(JSON.stringify(body)).not.toContain(PROVIDER_BODY_SENTINEL);
  });

  it("rejects a successful Stripe response without the required checkout session shape safely", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await fetchStripeCheckoutSession(
      "stripe-test-key",
      "cs_test",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "cs_test" }), { status: 200 })),
    );

    expect(result).toEqual({
      ok: false,
      error: providerFailureDetails("stripe", "fetch_checkout_session", 200),
    });
    expect(logOutput(errorLog)).not.toContain(PROVIDER_BODY_SENTINEL);
  });

  it("rejects a successful Stripe payment response without the required shape safely", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await fetchStripePaymentDetails(
      "stripe-test-key",
      "pi_test",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(null), { status: 200 })),
    );

    expect(result).toEqual({
      ok: false,
      error: providerFailureDetails("stripe", "fetch_payment_details", 200),
    });
    expect(logOutput(errorLog)).not.toContain(PROVIDER_BODY_SENTINEL);
  });
});
