import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import app from "../functions/router";
import { callApi } from "./helpers/app";
import { getAvailability } from "../functions/_lib/availability";
import { apiStatusSchema } from "../assets/shared/schemas/availability";
import { processPendingOutbox } from "../functions/_lib/email/outbox";
import { dispatchScheduledJobs } from "../functions/_lib/services/scheduled-jobs/dispatcher";
import type { Env } from "../functions/_lib/types";

function paused(mode = "maintenance"): Env {
  return {
    ...env,
    SERVICE_MODE: mode,
    DB: {
      prepare: () => {
        throw new Error("Database must not be accessed");
      },
      batch: async () => {
        throw new Error("Database must not be accessed");
      },
    },
  };
}
describe("availability across Worker entry points", () => {
  it.each(["maintenance", "emergency"])("blocks REST, auth, MCP and webhooks before D1 in %s", async (mode) => {
    const environment = paused(mode);
    for (const path of [
      "/api/v1/users/current",
      "/api/v1/auth/request-link",
      "/api/v1/mcp",
      "/api/v1/donations/webhook",
      "/api/v1/auth/oauth/token",
    ]) {
      const response = await callApi(environment, path, { method: "POST", body: "{}" });
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("retry-after")).toBe("60");
      expect(await response.json()).toMatchObject({ error: { code: "SERVICE_UNAVAILABLE", details: { mode } } });
    }
    const status = await callApi(environment, "/api/v1/");
    expect(status.status).toBe(200);
    expect(apiStatusSchema.parse(await status.json()).availability.mode).toBe(mode);
  });
  it("serves public pages and assets from the static binding while paused", async () => {
    const fetch = vi.fn(async () => new Response("Static page"));
    const environment = { ...paused(), ASSETS_PUBLIC: { fetch } };
    expect(await (await callApi(environment, "/news/")).text()).toBe("Static page");
    expect((await callApi(environment, "/portal/")).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await callApi(environment, "/api/v1/users/current")).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("serves a friendly HTML holding page for browser entry links", async () => {
    const environment = {
      ...paused(),
      ASSETS_PUBLIC: {
        fetch: async () =>
          new Response("<h1>Online services paused</h1>", { headers: { "content-type": "text/html" } }),
      },
    };
    const response = await callApi(environment, "/r/private-link", { headers: { accept: "text/html" } });
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
  it("pauses cron and direct outbox processing without touching the database", async () => {
    const environment = paused("emergency");
    const context = createExecutionContext();
    app.scheduled({ cron: "* * * * *", scheduledTime: Date.now(), noRetry() {} }, environment, context);
    expect(await dispatchScheduledJobs(environment, [], { maxJobsPerPass: 5, d1QueryBudget: 100 })).toEqual({
      reaped: 0,
      ran: 0,
      failed: 0,
    });
    expect(await processPendingOutbox(environment.DB, environment)).toEqual({ processed: 0, failed: 0 });
  });
  it.each(["maintenance", "emergency"])(
    "defers inbound mail during %s without permanent rejection or forwarding",
    async (mode) => {
      const message = { setReject: vi.fn(), forward: vi.fn() } as unknown as ForwardableEmailMessage;
      await expect(app.email(message, paused(mode), createExecutionContext())).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
      });
      expect(message.setReject).not.toHaveBeenCalled();
      expect(message.forward).not.toHaveBeenCalled();
    },
  );
  it("defers email-only scheduled maintenance while HTTP remains available", async () => {
    const environment = {
      ...paused("normal"),
      MAINTENANCE_SCHEDULE: JSON.stringify({
        version: 1,
        windows: [
          {
            id: "email-upgrade",
            message: "Email maintenance",
            policy: "pause",
            channels: ["email"],
            startsAt: new Date(Date.now() - 60_000).toISOString(),
            endsAt: new Date(Date.now() + 60_000).toISOString(),
          },
        ],
      }),
    };
    expect(getAvailability(environment).mode).toBe("normal");
    const message = { setReject: vi.fn() } as unknown as ForwardableEmailMessage;
    await expect(app.email(message, environment, createExecutionContext())).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(message.setReject).not.toHaveBeenCalled();
  });
  it("uses exact UTC window boundaries and never expires emergency mode", () => {
    const environment = {
      ...env,
      SERVICE_MODE: "normal",
      MAINTENANCE_STARTS_AT: "2026-10-01T10:00:00.000Z",
      MAINTENANCE_ENDS_AT: "2026-10-01T11:00:00.000Z",
    };
    expect(getAvailability(environment, Date.parse("2026-10-01T09:59:59Z")).mode).toBe("normal");
    expect(getAvailability(environment, Date.parse(environment.MAINTENANCE_STARTS_AT)).mode).toBe("maintenance");
    expect(getAvailability(environment, Date.parse(environment.MAINTENANCE_ENDS_AT)).mode).toBe("normal");
    environment.SERVICE_MODE = "emergency";
    expect(getAvailability(environment, Date.parse("2027-01-01T00:00:00Z")).mode).toBe("emergency");
    environment.SERVICE_MODE = "mistake";
    expect(getAvailability(environment).mode).toBe("emergency");
  });
});
