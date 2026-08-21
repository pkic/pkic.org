import { describe, expect, it } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import app from "../functions/router";
import { SENDGRID_WEBHOOK_MAX_BYTES, STRIPE_WEBHOOK_MAX_BYTES, readBoundedBody } from "../functions/_lib/http-body";
import type { Env } from "../functions/_lib/types";
import { OPENAPI_JSON_MAX_BYTES } from "../functions/_lib/openapi/route";

function executionContext(): ExecutionContext {
  return { passThroughOnException: () => {}, waitUntil: () => {} } as unknown as ExecutionContext;
}

const env = {
  ...(workerEnv as unknown as Env),
  APP_BASE_URL: "https://pkic.org",
  SENDGRID_WEBHOOK_VERIFICATION_KEY: "configured",
  STRIPE_WEBHOOK_SECRET: "whsec_test",
} as Env;

async function call(path: string, size: number): Promise<Response> {
  return app.fetch(
    new Request("https://pkic.org" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new Uint8Array(size),
    }),
    env as any,
    executionContext(),
  );
}

describe("webhook request body limits", () => {
  it("enforces the streaming limit even without a Content-Length header", async () => {
    const request = new Request("https://pkic.org/test", { method: "POST", body: new Uint8Array(6) });
    expect(request.headers.get("content-length")).toBeNull();
    await expect(readBoundedBody(request, 5)).rejects.toMatchObject({
      status: 413,
      code: "REQUEST_BODY_TOO_LARGE",
    });
  });

  it("rejects oversized SendGrid webhook bodies before signature work", async () => {
    expect(await call("/api/v1/webhooks/sendgrid", SENDGRID_WEBHOOK_MAX_BYTES + 1)).toMatchObject({ status: 413 });
  });

  it("rejects oversized donation Stripe webhook bodies before HMAC work", async () => {
    expect(await call("/api/v1/webhooks/stripe", STRIPE_WEBHOOK_MAX_BYTES + 1)).toMatchObject({ status: 413 });
  });

  it("rejects oversized sponsorship Stripe webhook bodies before HMAC work", async () => {
    expect(await call("/api/v1/sponsorship/checkout/webhook", STRIPE_WEBHOOK_MAX_BYTES + 1)).toMatchObject({
      status: 413,
    });
  });

  it("rejects oversized JSON bodies through the shared OpenAPI route boundary", async () => {
    expect(await call("/api/v1/donations/checkout", OPENAPI_JSON_MAX_BYTES + 1)).toMatchObject({ status: 413 });
  });
});
