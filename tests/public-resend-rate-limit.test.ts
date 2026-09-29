import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createTestRateLimiter, seedEventAndAdmin } from "./helpers/context";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { createRegistration } from "../functions/_lib/services/registrations";
import { findOrCreateUser } from "../functions/_lib/services/users";

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

  it("rate-limits token-only confirmation recovery by registration resource", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const limitedEnv = {
      ...env,
      EMAIL_RATE_LIMITER: createTestRateLimiter(3),
      IP_RATE_LIMITER: createTestRateLimiter(20),
    };
    const user = await findOrCreateUser(env.DB, {
      firstName: "Token",
      lastName: "Limited",
      email: `token-resend-${crypto.randomUUID()}@example.test`,
    });
    const submitted = await createRegistration(env.DB, {
      event: { id: eventId },
      userId: user.id,
      attendanceType: "virtual",
      sourceType: "direct",
      signingSecret: "test-signing-secret",
      confirmationTtlHours: 24,
    });
    const makeRequest = () =>
      callApi(limitedEnv, "/api/v1/events/pqc-2026/registrations/resend-confirmation", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.45" },
        body: JSON.stringify({ token: submitted.confirmationToken, id: submitted.registration.id }),
      });

    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(429);
  });

  it("rate-limits public registration emails before they can become a spam trigger", async () => {
    await seedEventAndAdmin(env.DB);
    const limitedEnv = {
      ...env,
      EMAIL_RATE_LIMITER: createTestRateLimiter(3),
      IP_RATE_LIMITER: createTestRateLimiter(20),
    };
    const email = `registration-create-rate-${crypto.randomUUID()}@example.test`;
    const makeRequest = () =>
      callApi(limitedEnv, "/api/v1/events/pqc-2026/registrations", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.42" },
        body: JSON.stringify({
          firstName: "Rate",
          lastName: "Limited",
          email,
          attendanceType: "virtual",
          sourceType: "direct",
          consents: [
            { termKey: "privacy-policy", version: "v1" },
            { termKey: "code-of-conduct", version: "v1" },
          ],
        }),
      });

    expect((await makeRequest()).status).toBe(200);
    // The domain workflow rejects a duplicate pending registration, but the
    // attempted email triggers still consume the abuse-control budget.
    expect((await makeRequest()).status).toBe(409);
    expect((await makeRequest()).status).toBe(409);
    expect((await makeRequest()).status).toBe(429);
  });

  it("rate-limits repeated bootstrap email corrections to an unverified target", async () => {
    await seedEventAndAdmin(env.DB);
    const limitedEnv = {
      ...env,
      EMAIL_RATE_LIMITER: createTestRateLimiter(3),
      IP_RATE_LIMITER: createTestRateLimiter(20),
    };
    const create = await callApi(limitedEnv, "/api/v1/events/pqc-2026/registrations", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.43" },
      body: JSON.stringify({
        firstName: "Typo",
        lastName: "Correction",
        email: `wrong-${crypto.randomUUID()}@example.test`,
        attendanceType: "virtual",
        sourceType: "direct",
        consents: [
          { termKey: "privacy-policy", version: "v1" },
          { termKey: "code-of-conduct", version: "v1" },
        ],
      }),
    });
    expect(create.status).toBe(200);
    const { manageToken } = (await create.json()) as { manageToken: string };
    const targetEmail = `correction-target-${crypto.randomUUID()}@example.test`;
    const makeRequest = () =>
      callApi(limitedEnv, `/api/v1/registrations/access/${encodeURIComponent(manageToken)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.43" },
        body: JSON.stringify({ action: "update", email: targetEmail }),
      });

    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(200);
    expect((await makeRequest()).status).toBe(429);
  });
});
