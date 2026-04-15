import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";

function callApp(request: Request): Promise<Response> {
  return Promise.resolve(
    app.fetch(request, env as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any),
  );
}

describe("public and internal router smoke tests", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("serves the public geo endpoint and rejects cross-origin requests", async () => {
    const sameOriginResponse = await callApp(
      new Request("https://app.test/api/v1/geo", {
        headers: { "sec-fetch-site": "same-origin" },
      }),
    );

    expect(sameOriginResponse.status).toBe(200);

    const crossOriginResponse = await callApp(
      new Request("https://app.test/api/v1/geo", {
        headers: {
          "sec-fetch-site": "cross-site",
          origin: "https://evil.example.com",
        },
      }),
    );

    expect(crossOriginResponse.status).toBe(403);
  });

  it("serves event terms through the mounted router", async () => {
    await seedEventAndAdmin(env.DB);

    const response = await callApp(new Request("https://app.test/api/v1/events/pqc-2026/terms"));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { terms: unknown[] };
    expect(Array.isArray(payload.terms)).toBe(true);
  });

  it("rejects an unsigned internal calendar RSVP request", async () => {
    const response = await callApp(
      new Request("https://app.test/api/v1/internal/calendar/rsvp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "cloudflare_email_route",
          sourceMessageId: "msg-1",
          uid: "x",
          partstat: "DECLINED",
          attendeeEmail: "a@example.test",
        }),
      }),
    );

    expect(response.status).toBe(401);
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(payload.error?.code).toBe("INVALID_SIGNATURE");
  });
});
