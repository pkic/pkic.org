import { eventTermsResponseSchema } from "../assets/shared/schemas/forms";
import { eventDaysManagementResponseSchema } from "../assets/shared/schemas/event-configuration";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventDetailResponseSchema, eventsListResponseSchema } from "../assets/shared/schemas/event-management";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { readEventAdminContext } from "../functions/_lib/services/events/authorized-context";
import { buildRegistrationManageView } from "../functions/_lib/services/registrations/manage-view";
import { getRegistrationById } from "../functions/_lib/services/registrations/queries";
import { createAdminSession, createMcpSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { enforceD1RoundTripBudget } from "./helpers/d1-round-trip-budget";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";

const f = createEventScannerFixture();
beforeEach(() => f.setup());
const path = "/api/v1/events/scan-test";
const strict = { maxRoundTrips: 1 };

describe("one D1 round trip for event configuration endpoints", () => {
  it("resolves the event and audience-specific terms in the same public batch", async () => {
    await env.DB.batch(
      ["attendee", "speaker"].map((audience) =>
        env.DB.prepare(
          `INSERT INTO event_terms(id,event_id,audience_type,term_key,version,required,content_ref,active,created_at)
       VALUES(?,?,?,?,'v1',1,'/policy/',1,?)`,
        ).bind(crypto.randomUUID(), f.eventId, audience, `${audience}-policy`, new Date().toISOString()),
      ),
    );
    for (const audience of ["attendee", "speaker"]) {
      const response = await callApi(env, `${path}/terms?audience=${audience}`, undefined, strict);
      expect(response.status).toBe(200);
      const result = eventTermsResponseSchema.parse(await response.json());
      expect(result.event.id).toBe(f.eventId);
      expect(result.terms.map((term) => term.termKey)).toEqual([`${audience}-policy`]);
    }
    expect((await callApi(env, "/api/v1/events/missing-event/terms", undefined, strict)).status).toBe(404);
    expect((await callApi(env, `${path}/terms?audience=invalid`, undefined, { maxRoundTrips: 0 })).status).toBe(400);
  });

  it("includes live authorization, the event, days, and registered counts in one read", async () => {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO event_days(id,event_id,day_date,label,in_person_capacity,sort_order,created_at,updated_at)
        VALUES('budget-day',?,'2026-12-01','First day',2,0,?,?)`).bind(
        f.eventId,
        new Date().toISOString(),
        new Date().toISOString(),
      ),
      env.DB.prepare(`INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at)
        SELECT ?,id,'budget-day','in_person',?,? FROM registrations WHERE event_id=? AND user_id=?`).bind(
        crypto.randomUUID(),
        new Date().toISOString(),
        new Date().toISOString(),
        f.eventId,
        f.userId,
      ),
    ]);
    const pendingId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at)
        VALUES(?,?,?,'pending_email_confirmation','in_person','test',?,?,?)`).bind(
        pendingId,
        f.eventId,
        f.operatorId,
        crypto.randomUUID(),
        new Date().toISOString(),
        new Date().toISOString(),
      ),
      env.DB.prepare(`INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at)
        VALUES(?,?,'budget-day','in_person',?,?)`).bind(
        crypto.randomUUID(),
        pendingId,
        new Date().toISOString(),
        new Date().toISOString(),
      ),
    ]);
    const response = await callApi(env, `${path}/days`, { headers: { authorization: `Bearer ${f.token}` } }, strict);
    expect(response.status).toBe(200);
    const result = eventDaysManagementResponseSchema.parse(await response.json());
    expect(result.days).toEqual([
      expect.objectContaining({ id: "budget-day", date: "2026-12-01", attendanceCounts: { in_person: 1 } }),
    ]);
  });

  it("refuses missing or invalid credentials before accessing D1", async () => {
    for (const token of [null, "invalid"]) {
      const headers = new Headers();
      if (token) headers.set("authorization", `Bearer ${token}`);
      expect((await callApi(env, `${path}/days`, { headers }, { maxRoundTrips: 0 })).status).toBe(401);
    }
  });

  it("rechecks permission revocation in the same day snapshot", async () => {
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("FROM events WHERE slug"),
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
      `${path}/days`,
      { headers: { authorization: `Bearer ${f.token}` } },
      strict,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("days");
  });

  it.each([true, false])("retains delegated credential scope ceilings (permitted: %s)", async (permitted) => {
    const token = await createMcpSession(
      env.DB,
      { id: f.operatorId, email: `${f.operatorId}@example.test` },
      crypto.randomUUID(),
      permitted ? ["events:read"] : ["forms:read"],
    );
    const response = await callApi(env, `${path}/days`, {
      headers: { authorization: `Bearer ${token}`, "x-pkic-machine-auth": "mcp" },
    });
    expect(response.status).toBe(permitted ? 200 : 403);
  });
});

describe("one D1 round trip includes JWT context and event data", () => {
  it.each(["anonymous", "attendee", "management"] as const)(
    "serves %s fields in one read-only batch",
    async (capacity) => {
      await env.DB.prepare("UPDATE events SET visibility='public', settings_json=? WHERE id=?")
        .bind(JSON.stringify({ internal: "never-audience", virtualUrl: "https://private.test" }), f.eventId)
        .run();
      await env.DB.prepare(
        "INSERT INTO referral_codes(code,event_id,owner_type,owner_id,created_at) SELECT 'ownshare',event_id,'registration',id,created_at FROM registrations WHERE event_id=? AND user_id=?",
      )
        .bind(f.eventId, f.userId)
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
      if (capacity === "attendee") expect(event.participation?.promotion).toMatchObject({ sharePath: "/r/ownshare" });
      else expect(event.participation?.promotion ?? null).toBeNull();
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

describe("one D1 round trip for bounded event listing", () => {
  it.each(["anonymous", "attendee", "management"] as const)(
    "includes auth, pagination, count and %s enrichment in one batch",
    async (capacity) => {
      await env.DB.prepare("UPDATE events SET visibility='public' WHERE id=?").bind(f.eventId).run();
      const token =
        capacity === "anonymous"
          ? null
          : capacity === "management"
            ? f.token
            : await createAdminSession(env.DB, f.userId, crypto.randomUUID());
      for (const offset of [0, 1]) {
        const response = await callApi(
          env,
          `/api/v1/events?q=scan-test&limit=1&offset=${offset}${capacity === "management" ? "&sort=-total_registrations" : ""}`,
          { headers: token ? { authorization: `Bearer ${token}` } : {} },
          strict,
        );
        expect(response.status, await response.clone().text()).toBe(200);
        const body = eventsListResponseSchema.parse(await response.json());
        expect(body.page.total).toBe(1);
        expect(body.events).toHaveLength(offset === 0 ? 1 : 0);
        if (offset === 0) {
          expect("totalRegistrations" in body.events[0]).toBe(capacity === "management");
          if (capacity === "attendee") expect(body.events[0].participation?.registrationId).toBeDefined();
        }
      }
    },
  );

  it.each(["anonymous", "attendee", "management"] as const)(
    "serves the portal's default and phase-filtered event lists for %s within D1's expression limit",
    async (capacity) => {
      const token =
        capacity === "anonymous"
          ? null
          : capacity === "management"
            ? f.token
            : await createAdminSession(env.DB, f.userId, crypto.randomUUID());
      for (const query of [
        "",
        "?phase=upcoming",
        "?phase=now",
        "?phase=past&sort=name",
        "?visibility=public",
        "?kind=standalone&phase=now&sort=starts_at&limit=1",
        "?kind=standalone&phase=upcoming&sort=starts_at&limit=1",
      ]) {
        const response = await callApi(
          env,
          `/api/v1/events${query}`,
          { headers: token ? { authorization: `Bearer ${token}` } : {} },
          strict,
        );
        expect(response.status, await response.clone().text()).toBe(200);
        eventsListResponseSchema.parse(await response.json());
      }
    },
  );

  it("refuses management-only sorting without management authority", async () => {
    const response = await callApi(env, "/api/v1/events?sort=total_registrations", undefined, strict);
    expect(response.status).toBe(400);
  });
});

it("shares the canonical human actor and owning event lookup in one batch", async () => {
  const profile = profileD1Flow(env.DB);
  const context = await readEventAdminContext(
    profile.db,
    new Request("https://app.test/api/v1/events/scan-test", { headers: { authorization: `Bearer ${f.token}` } }),
    env,
    "scan-test",
  );
  enforceD1RoundTripBudget(profile.summary(), strict, "shared event authorization context");
  expect(context.actor.id).toBe(f.operatorId);
  expect(context.event.id).toBe(f.eventId);
});

it("loads the shared registration management projection in one resource batch", async () => {
  const row = await env.DB.prepare("SELECT id FROM registrations WHERE event_id=? AND user_id=?")
    .bind(f.eventId, f.userId)
    .first<{ id: string }>();
  const registration = await getRegistrationById(env.DB, row!.id);
  const profile = profileD1Flow(env.DB);
  const result = await buildRegistrationManageView(profile.db, registration, "https://app.test");
  enforceD1RoundTripBudget(profile.summary(), strict, "registration management projection");
  expect(result.registration.id).toBe(registration.id);
  expect(result.event.id).toBe(f.eventId);
  expect(result.sponsorSharing.allowed).toBe(false);
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
