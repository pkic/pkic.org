import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventDetailResponseSchema } from "../assets/shared/schemas/event-management";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { enforceD1RoundTripBudget } from "./helpers/d1-round-trip-budget";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";

const f = createEventScannerFixture();
beforeEach(() => f.setup());
const path = "/api/v1/events/scan-test";
const strict = { maxRoundTrips: 1 };

describe("one D1 round trip includes JWT context and event data", () => {
  it.each(["anonymous", "attendee", "management"] as const)(
    "serves %s fields in one read-only batch",
    async (capacity) => {
      await env.DB.prepare("UPDATE events SET visibility='public', settings_json=? WHERE id=?")
        .bind(JSON.stringify({ internal: "never-audience", virtualUrl: "https://private.test" }), f.eventId)
        .run();
      const token =
        capacity === "anonymous"
          ? null
          : capacity === "management"
            ? f.token
            : await createAdminSession(env.DB, f.userId, crypto.randomUUID());
      const profile = profileD1Flow(env.DB);
      const response = await callApi(
        { ...env, DB: profile.db },
        path,
        { headers: token ? { authorization: `Bearer ${token}` } : {} },
        strict,
      );
      expect(response.status).toBe(200);
      const event = eventDetailResponseSchema.parse(await response.json()).event;
      expect("capabilities" in event).toBe(capacity === "management");
      if (capacity !== "management") expect(JSON.stringify(event)).not.toMatch(/never-audience|private.test/);
      expect(profile.summary().roundTrips).toBe(1);
      expect(profile.summary().queries.every((query) => query.operation === "batch")).toBe(true);
      expect(profile.summary().queries.some((query) => /INSERT|UPDATE|DELETE/.test(query.sql))).toBe(false);
    },
  );

  it("refuses an invalid JWT before any D1 request", async () => {
    const response = await callApi(env, path, { headers: { authorization: "Bearer invalid" } }, { maxRoundTrips: 0 });
    expect(response.status).toBe(401);
  });

  it("refuses a revoked session in the same single resource snapshot", async () => {
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), f.operatorId)
      .run();
    const response = await callApi(env, path, { headers: { authorization: `Bearer ${f.token}` } }, strict);
    expect(response.status).toBe(401);
  });

  it("does not release management fields if authority is revoked just before the combined batch", async () => {
    await env.DB.prepare("UPDATE events SET visibility='invitation_only' WHERE id=?").bind(f.eventId).run();
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("LEFT JOIN retention_policies"),
      async () => {
        const at = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(at, f.operatorId),
          env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE user_id=?").bind(at, f.operatorId),
        ]);
      },
    );
    const response = await callApi(
      { ...env, DB: db },
      path,
      { headers: { authorization: `Bearer ${f.token}` } },
      strict,
    );
    expect(response.status).toBe(404);
  });
});

describe("D1 budget instrumentation uses real binding calls", () => {
  it("counts a multi-statement batch once and catches additional calls through the Sessions API", async () => {
    const profile = profileD1Flow(env.DB);
    const session = profile.db.withSession?.("first-unconstrained") ?? profile.db;
    await session.batch([session.prepare("SELECT 1 AS value"), session.prepare("SELECT 2 AS value")]);
    expect(() => enforceD1RoundTripBudget(profile.summary(), strict, "batch")).not.toThrow();
    await Promise.all([session.prepare("SELECT 3 AS value").first(), session.prepare("SELECT 4 AS value").all()]);
    expect(profile.summary()).toMatchObject({ roundTrips: 3, statements: 4 });
    expect(() => enforceD1RoundTripBudget(profile.summary(), strict, "parallel reads")).toThrow(
      /D1 round-trip budget exceeded/,
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => enforceD1RoundTripBudget(profile.summary(), { ...strict, mode: "warn" }, "audit")).not.toThrow();
      expect(warning).toHaveBeenCalledOnce();
    } finally {
      warning.mockRestore();
    }
  });

  it("counts failures and keeps bound values out of diagnostics", async () => {
    const profile = profileD1Flow(env.DB);
    await profile.db.prepare("SELECT ? AS value").bind("private-parameter-never-in-report").first();
    await expect(profile.db.prepare("SELECT missing_column FROM events").all()).rejects.toThrow();
    expect(profile.summary().roundTrips).toBe(2);
    let error: unknown;
    try {
      enforceD1RoundTripBudget(profile.summary(), strict, "failed read");
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).toContain("SELECT missing_column FROM events");
    expect(String(error)).not.toContain("private-parameter-never-in-report");
  });
});
