import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  eventLiveStudioSetupResponseSchema,
  type EventLiveStudioSetupPut,
} from "../assets/shared/schemas/live-studio-setup";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { createLiveRoomFixture } from "./helpers/live-session-room";
import type { D1RoundTripBudget } from "./helpers/d1-round-trip-budget";
import type { DatabaseLike } from "../functions/_lib/types";

const f = createLiveRoomFixture();
const path = () => `/api/v1/events/${f.eventSlug}/settings/live/studio`;

function api(
  method: "GET" | "PUT",
  body?: unknown,
  person: "operator" | "secondOperator" = "operator",
  db: DatabaseLike = env.DB,
  budget?: D1RoundTripBudget,
) {
  return callApi(
    { ...env, DB: db },
    path(),
    {
      method,
      headers: {
        authorization: `Bearer ${f.tokens[person]}`,
        "content-type": "application/json",
        origin: "https://app.test",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    budget,
  );
}
async function read(person: "operator" | "secondOperator" = "operator") {
  const response = await api("GET", undefined, person);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  return eventLiveStudioSetupResponseSchema.parse(await response.json());
}
const ticker = {
  style: "accent" as const,
  speed: 120,
  messages: [{ id: "wifi", prefix: "Wi-Fi", template: "PKIC-guest", condition: "always" as const }],
};
const setup = (overrides: Partial<EventLiveStudioSetupPut> = {}): EventLiveStudioSetupPut => ({
  expectedUpdatedAt: null,
  graphics: {
    ticker,
    topQuestions: { count: 3 },
    lowerThird: { motion: "cut" },
    timer: {
      showLabel: true,
      format: "clock",
      customFormat: "{{minutes}}m",
      direction: "remaining",
      presentation: "tab",
      placement: "top-right",
      size: "medium",
    },
  },
  layouts: { stage: [{ id: "stage-time", type: "time", x: 0, y: 0, w: 6, h: 9 }] },
  ...overrides,
});
const audits = () =>
  queryAll<{ action: string }>(env.DB, "SELECT action FROM audit_log WHERE entity_id=? ORDER BY created_at", f.eventId);

/** Leaves the second operator with exactly these permissions on the event, in place of administrator access. */
async function secondOperatorHolds(...permissions: Array<"agenda:live_studio" | "agenda:live_setup">) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(now, f.users.secondOperator),
    ...permissions.map((permission) =>
      env.DB.prepare(
        "INSERT INTO permission_grants (id,user_id,permission,context_type,context_id,granted_by_user_id,created_at) VALUES (?,?,?,'event',?,?,?)",
      ).bind(crypto.randomUUID(), f.users.secondOperator, permission, f.eventId, f.users.operator, now),
    ),
  ]);
  f.tokens.secondOperator = await createAdminSession(env.DB, f.users.secondOperator, crypto.randomUUID());
}

beforeEach(async () => {
  await f.setup();
});

describe("event studio setup", () => {
  it("is empty and unversioned until the event saves one", async () => {
    expect(await read()).toEqual({ graphics: {}, layouts: {}, updatedAt: null });
  });

  it("saves, replaces at the version it read, and refuses a duplicate first save or a stale one", async () => {
    const created = await api("PUT", setup());
    expect(created.status, await created.clone().text()).toBe(200);
    const saved = eventLiveStudioSetupResponseSchema.parse(await created.json());
    expect(saved.graphics.ticker).toEqual(ticker);
    expect(saved.updatedAt).not.toBeNull();
    expect(await read()).toEqual(saved);

    expect((await api("PUT", setup())).status).toBe(409);
    const next = await api(
      "PUT",
      setup({
        expectedUpdatedAt: saved.updatedAt,
        graphics: { schedule: { scope: "all-rooms", layout: "list", theme: "white-on-black" } },
      }),
    );
    expect(next.status).toBe(200);
    const replaced = eventLiveStudioSetupResponseSchema.parse(await next.json());
    expect(replaced.graphics).toEqual({ schedule: { scope: "all-rooms", layout: "list", theme: "white-on-black" } });
    expect(replaced.updatedAt! > saved.updatedAt!).toBe(true);

    const stale = await api("PUT", setup({ expectedUpdatedAt: saved.updatedAt }));
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe("LIVE_STUDIO_SETUP_CHANGED");
    expect((await audits()).map((row) => row.action)).toEqual(["live_studio_setup_saved", "live_studio_setup_saved"]);
  });

  it("saves in two database round trips: the event and access, then one atomic batch", async () => {
    expect((await api("PUT", setup(), "operator", env.DB, { maxRoundTrips: 2, mode: "fail" })).status).toBe(200);
  });

  it("refuses a setup the shared contract does not accept, and stores nothing", async () => {
    for (const body of [
      setup({ graphics: { ticker: { ...ticker, speed: 500 } } }),
      { ...setup(), graphics: { timer: { ...setup().graphics.timer, timerId: "session" } } },
      setup({ layouts: { stage: [{ id: "x", type: "time", x: 10, y: 0, w: 6, h: 9 }] } }),
      { ...setup(), extra: true },
    ])
      expect((await api("PUT", body)).status).toBe(400);
    expect(await queryAll(env.DB, "SELECT event_id FROM event_live_studio_setups")).toEqual([]);
  });

  it("lets a room operator read the setup but not change it", async () => {
    expect((await api("PUT", setup())).status).toBe(200);
    await secondOperatorHolds("agenda:live_studio");
    expect((await read("secondOperator")).graphics.ticker).toEqual(ticker);
    const saved = await read();
    expect((await api("PUT", setup({ expectedUpdatedAt: saved.updatedAt }), "secondOperator")).status).toBe(403);
    await secondOperatorHolds("agenda:live_setup");
    expect((await api("PUT", setup({ expectedUpdatedAt: saved.updatedAt }), "secondOperator")).status).toBe(200);
  });

  it("rolls the save back when the operator's access is revoked after the read", async () => {
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("INSERT INTO event_live_studio_setups"),
      () =>
        env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?")
          .bind(new Date().toISOString(), f.users.operator)
          .run(),
    );
    expect((await api("PUT", setup(), "operator", db)).status).toBe(403);
    expect(await queryAll(env.DB, "SELECT event_id FROM event_live_studio_setups")).toEqual([]);
    expect(await audits()).toEqual([]);
  });

  it("keeps every part that still reads when another part no longer does", async () => {
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO event_live_studio_setups(event_id,setup_json,created_at,updated_at) VALUES(?,?,?,?)",
    )
      .bind(
        f.eventId,
        JSON.stringify({
          graphics: { ticker, topQuestions: { count: "many" }, retired: true },
          layouts: { show: "broken", stage: setup().layouts.stage },
        }),
        now,
        now,
      )
      .run();
    expect(await read()).toEqual({ graphics: { ticker }, layouts: { stage: setup().layouts.stage }, updatedAt: now });
  });
});
