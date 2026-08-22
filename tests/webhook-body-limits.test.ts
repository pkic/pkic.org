import { describe, expect, it } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import app from "../functions/router";
import {
  MCP_AUTHORIZE_MAX_BYTES,
  SENDGRID_WEBHOOK_MAX_BYTES,
  STRIPE_WEBHOOK_MAX_BYTES,
  readBoundedBody,
} from "../functions/_lib/http-body";
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

  it("accepts an exact-size body and rejects invalid or oversized declared lengths before reading", async () => {
    await expect(
      readBoundedBody(new Request("https://pkic.org/test", { method: "POST", body: new Uint8Array([1, 2, 3]) }), 3),
    ).resolves.toEqual(new Uint8Array([1, 2, 3]));

    await expect(
      readBoundedBody(
        new Request("https://pkic.org/test", {
          method: "POST",
          headers: { "content-length": "invalid" },
          body: new Uint8Array(),
        }),
        3,
      ),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_CONTENT_LENGTH" });

    const request = new Request("https://pkic.org/test", {
      method: "POST",
      headers: { "content-length": "4" },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    await expect(readBoundedBody(request, 3)).rejects.toMatchObject({
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

  it.each(["application/json", "application/x-www-form-urlencoded"])(
    "rejects oversized MCP OAuth %s bodies before authorization processing",
    async (contentType) => {
      const response = await app.fetch(
        new Request("https://pkic.org/api/v1/oauth/authorize", {
          method: "POST",
          headers: { "content-type": contentType },
          body: new Uint8Array(MCP_AUTHORIZE_MAX_BYTES + 1),
        }),
        env as any,
        executionContext(),
      );

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "REQUEST_BODY_TOO_LARGE" } });
    },
  );
});
