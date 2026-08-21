import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createTestRateLimiter, seedEventAndAdmin } from "./helpers/context";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";

describe("public resend rate limits", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rate-limits repeated speaker manage-link resends for the same email", async () => {
    await seedEventAndAdmin(env.DB);
    const limitedEnv = {
      ...env,
      EMAIL_RATE_LIMITER: createTestRateLimiter(3),
      IP_RATE_LIMITER: createTestRateLimiter(20),
    };
    const email = `speaker-rate-limit-${crypto.randomUUID()}@example.test`;

    const makeRequest = () =>
      callApi(limitedEnv, "/api/v1/events/pqc-2026/proposals/resend-speaker-manage-link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.40",
        },
        body: JSON.stringify({ email }),
      });

    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(429);
  });

  it("rate-limits repeated registration confirmation recovery for the same email", async () => {
    await seedEventAndAdmin(env.DB);
    const limitedEnv = {
      ...env,
      EMAIL_RATE_LIMITER: createTestRateLimiter(3),
      IP_RATE_LIMITER: createTestRateLimiter(20),
    };
    const email = `registration-rate-limit-${crypto.randomUUID()}@example.test`;

    const makeRequest = () =>
      callApi(limitedEnv, "/api/v1/events/pqc-2026/registrations/resend-confirmation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.41",
        },
        body: JSON.stringify({ email }),
      });

    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(429);
  });
});
