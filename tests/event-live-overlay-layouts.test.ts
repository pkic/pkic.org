import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_OVERLAY_DEFAULT_POSITIONS,
  LIVE_OVERLAY_PRESET_LAYOUTS,
  liveOverlayBoxOf,
} from "../assets/shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_MAX_SAVED_LAYOUTS,
  LIVE_OVERLAY_PRESETS,
  eventLiveOverlayLayoutPutSchema,
  eventLiveOverlayLayoutsResponseSchema,
  type EventLiveOverlayLayoutPut,
} from "../assets/shared/schemas/live-overlay-layout";
import { callApi } from "./helpers/app";
import { queryAll } from "./helpers/context";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { createLiveRoomFixture } from "./helpers/live-session-room";
import type { DatabaseLike } from "../functions/_lib/types";

const f = createLiveRoomFixture(),
  sockets: WebSocket[] = [];
const FULL_FRAME = LIVE_OVERLAY_PRESET_LAYOUTS["full-frame"].elements;
const collection = () => `/api/v1/events/${f.eventSlug}/settings/live/layouts`;

const positionsPath = () => `/api/v1/events/${f.eventSlug}/settings/live/positions`;

async function api(
  method: "GET" | "PUT" | "DELETE",
  slug: string | null,
  body?: unknown,
  person: "operator" | "attendee" = "operator",
  db: DatabaseLike = env.DB,
  path = slug ? `${collection()}/${slug}` : collection(),
) {
  return callApi({ ...env, DB: db }, path, {
    method,
    headers: {
      authorization: `Bearer ${f.tokens[person]}`,
      "content-type": "application/json",
      origin: "https://app.test",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function layouts() {
  const response = await api("GET", null);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  return eventLiveOverlayLayoutsResponseSchema.parse(await response.json()).layouts;
}
const put = (overrides: Partial<EventLiveOverlayLayoutPut> = {}) =>
  eventLiveOverlayLayoutPutSchema.parse({
    expectedUpdatedAt: null,
    name: "Keynote",
    preset: "full-frame",
    elements: { ...FULL_FRAME, ticker: { ...FULL_FRAME.ticker, visible: false } },
    ...overrides,
  });
const positions = (method: "PUT" | "DELETE", body?: unknown) =>
  api(method, null, body, "operator", env.DB, positionsPath());
async function current() {
  const response = await api("GET", null);
  return eventLiveOverlayLayoutsResponseSchema.parse(await response.json());
}
const audits = () =>
  queryAll<{ action: string }>(env.DB, "SELECT action FROM audit_log WHERE entity_id=? ORDER BY created_at", f.eventId);

beforeEach(async () => {
  await f.setup();
});
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close(1000, "done");
  vi.restoreAllMocks();
});

describe("event overlay layouts", () => {
  it("lists the built-in layouts, default first, before any is saved", async () => {
    const listed = await layouts();
    expect(listed.map((layout) => layout.slug)).toEqual([...LIVE_OVERLAY_PRESETS]);
    expect(listed.every((layout) => layout.builtIn && !layout.saved && layout.updatedAt === null)).toBe(true);
    expect(listed[0]!.elements).toEqual(FULL_FRAME);
  });

  it("creates, replaces at the version it read, and refuses a duplicate or stale save", async () => {
    const created = await api("PUT", "keynote", put());
    expect(created.status, await created.clone().text()).toBe(200);
    const saved = eventLiveOverlayLayoutsResponseSchema
      .parse(await created.json())
      .layouts.find((layout) => layout.slug === "keynote")!;
    expect(saved).toMatchObject({ name: "Keynote", builtIn: false, saved: true, preset: "full-frame" });
    expect(saved.elements.ticker.visible).toBe(false);
    expect((await api("PUT", "keynote", put())).status).toBe(409);
    const renamed = await api("PUT", "keynote", put({ name: "Opening keynote", expectedUpdatedAt: saved.updatedAt }));
    expect(renamed.status).toBe(200);
    const current = (await layouts()).find((layout) => layout.slug === "keynote")!;
    expect(current.name).toBe("Opening keynote");
    expect(current.updatedAt! > saved.updatedAt!).toBe(true);
    expect((await api("PUT", "keynote", put({ expectedUpdatedAt: saved.updatedAt }))).status).toBe(409);
    expect((await audits()).map((row) => row.action)).toEqual([
      "live_overlay_layout_saved",
      "live_overlay_layout_saved",
    ]);
  });

  it("saves a built-in layout under its own name and resets it to the preset", async () => {
    const response = await api("PUT", "lower-third", put({ name: "Name only", preset: null }));
    expect(response.status).toBe(200);
    const changed = (await layouts()).find((layout) => layout.slug === "lower-third")!;
    expect(changed).toMatchObject({ name: "Name only", builtIn: true, saved: true, preset: "lower-third" });
    const preset = LIVE_OVERLAY_PRESET_LAYOUTS["lower-third"];
    const reset = await api(
      "PUT",
      "lower-third",
      put({ expectedUpdatedAt: changed.updatedAt, name: preset.name, elements: preset.elements }),
    );
    expect(reset.status).toBe(200);
    expect((await layouts()).find((layout) => layout.slug === "lower-third")!.elements).toEqual(preset.elements);
  });

  it("deletes the event's own layouts but never a built-in one or the default", async () => {
    await api("PUT", "keynote", put());
    const removed = await api("DELETE", "keynote");
    expect(removed.status).toBe(200);
    expect(
      eventLiveOverlayLayoutsResponseSchema.parse(await removed.json()).layouts.some((l) => l.slug === "keynote"),
    ).toBe(false);
    expect((await api("DELETE", "keynote")).status).toBe(404);
    await api("PUT", "full-frame", put({ name: "Full frame" }));
    for (const slug of ["full-frame", "panel"]) {
      const refused = await api("DELETE", slug);
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("LIVE_OVERLAY_LAYOUT_BUILT_IN");
    }
    expect((await layouts()).find((layout) => layout.slug === "full-frame")!.saved).toBe(true);
  });

  it("refuses attendees and invalid layouts without writing", async () => {
    expect((await api("GET", null, undefined, "attendee")).status).toBe(403);
    expect((await api("PUT", "keynote", put(), "attendee")).status).toBe(403);
    expect((await api("DELETE", "keynote", undefined, "attendee")).status).toBe(403);
    const valid = put();
    for (const [slug, body] of [
      ["Keynote!", valid],
      ["keynote", { ...valid, elements: { ...valid.elements, timer: { ...valid.elements.timer, x: 0.9, w: 0.2 } } }],
      ["keynote", { ...valid, elements: { ...valid.elements, timer: { ...valid.elements.timer, w: 0.001 } } }],
      ["keynote", { ...valid, elements: { ...valid.elements, stageMessage: undefined } }],
      ["keynote", { ...valid, name: " " }],
      ["keynote", { ...valid, roomId: f.roomId }],
    ] as const)
      expect((await api("PUT", slug, body)).status).toBe(400);
    expect(await queryAll(env.DB, "SELECT slug FROM event_live_overlay_layouts")).toEqual([]);
    expect(await audits()).toEqual([]);
  });

  it("keeps the saved layouts within the event's limit", async () => {
    const now = new Date().toISOString();
    await env.DB.batch(
      Array.from({ length: LIVE_OVERLAY_MAX_SAVED_LAYOUTS }, (_, index) =>
        env.DB.prepare(
          "INSERT INTO event_live_overlay_layouts(event_id,slug,name,preset,elements_json,created_at,updated_at) VALUES(?,?,?,NULL,?,?,?)",
        ).bind(f.eventId, `scene-${index}`, `Scene ${index}`, JSON.stringify(FULL_FRAME), now, now),
      ),
    );
    const refused = await api("PUT", "one-more", put());
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("LIVE_OVERLAY_LAYOUT_LIMIT");
  });

  it("rolls the save back when the operator's access is revoked after the read", async () => {
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("INSERT INTO event_live_overlay_layouts"),
      () =>
        env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?")
          .bind(new Date().toISOString(), f.users.operator)
          .run(),
    );
    expect((await api("PUT", "keynote", put(), "operator", db)).status).toBe(403);
    expect(await queryAll(env.DB, "SELECT slug FROM event_live_overlay_layouts")).toEqual([]);
    expect(await audits()).toEqual([]);
  });

  it("hands live rooms every layout, resolved against the shared positions, on their refresh, once per change", async () => {
    const operator = await f.connect({ person: "operator" });
    sockets.push(operator.socket);
    expect((await operator.next("room.snapshot")).overlayLayouts.map((layout) => layout.slug)).toEqual([
      ...LIVE_OVERLAY_PRESETS,
    ]);
    const body = put();
    expect((await api("PUT", "keynote", body)).status).toBe(200);
    const moved = { ...LIVE_OVERLAY_DEFAULT_POSITIONS.lowerThird, y: 0.5 };
    expect(
      (
        await positions("PUT", {
          expectedUpdatedAt: null,
          elements: { ...LIVE_OVERLAY_DEFAULT_POSITIONS, lowerThird: moved },
        })
      ).status,
    ).toBe(200);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    await runDurableObjectAlarm(f.room());
    const changed = (await operator.next("overlay.layouts.changed")).layouts;
    expect(changed.find((layout) => layout.slug === "keynote")).toEqual({
      slug: "keynote",
      name: "Keynote",
      elements: { ...body.elements, lowerThird: { ...body.elements.lowerThird, ...moved } },
    });
    expect(changed.find((layout) => layout.slug === "full-frame")!.elements.lowerThird.y).toBe(0.5);
    const count = operator.received.filter((message) => message.type === "overlay.layouts.changed").length;
    await runDurableObjectAlarm(f.room());
    expect(operator.received.filter((message) => message.type === "overlay.layouts.changed")).toHaveLength(count);
  });
});

describe("shared element positions", () => {
  const lowerThirdOf = async (slug: string) =>
    liveOverlayBoxOf((await current()).layouts.find((layout) => layout.slug === slug)!.elements.lowerThird);
  const moveShared = async (y: number) => {
    const before = (await current()).positions;
    const elements = { ...before.elements, lowerThird: { ...before.elements.lowerThird, y } };
    const response = await positions("PUT", { expectedUpdatedAt: before.updatedAt, elements });
    expect(response.status, await response.clone().text()).toBe(200);
    return eventLiveOverlayLayoutsResponseSchema.parse(await response.json());
  };

  it("starts from the built-in positions, and every layout that shares an element inherits a move", async () => {
    const start = await current();
    expect(start.positions).toEqual({ elements: LIVE_OVERLAY_DEFAULT_POSITIONS, saved: false, updatedAt: null });
    // Built-in layouts share what they place where Full frame does; side by side places it itself.
    expect(LIVE_OVERLAY_PRESET_LAYOUTS["close-up"].elements.ticker.shared).toBe(true);
    expect(LIVE_OVERLAY_PRESET_LAYOUTS["side-by-side"].elements.lowerThird.shared).toBe(false);
    expect((await api("PUT", "keynote", put())).status).toBe(200);
    const moved = await moveShared(0.5);
    expect(moved.positions.saved).toBe(true);
    for (const slug of ["full-frame", "lower-third", "panel", "keynote"])
      expect((await lowerThirdOf(slug)).y, slug).toBe(0.5);
    expect(await lowerThirdOf("side-by-side")).toEqual(
      liveOverlayBoxOf(LIVE_OVERLAY_PRESET_LAYOUTS["side-by-side"].elements.lowerThird),
    );
    expect((await audits()).map((row) => row.action)).toEqual([
      "live_overlay_layout_saved",
      "live_overlay_positions_saved",
    ]);
  });

  it("keeps a layout's own position once it is unlinked, and follows again once it uses the shared one", async () => {
    const own = { ...FULL_FRAME.lowerThird, shared: false, x: 0.3, y: 0.3 };
    const keynote = put({ elements: { ...put().elements, lowerThird: own } });
    expect((await api("PUT", "keynote", keynote)).status).toBe(200);
    await moveShared(0.6);
    expect(await lowerThirdOf("keynote")).toEqual(liveOverlayBoxOf(own));
    expect((await lowerThirdOf("full-frame")).y).toBe(0.6);
    // "Use shared position": the layout shares the element again and takes the shared box.
    const saved = (await current()).layouts.find((layout) => layout.slug === "keynote")!;
    const relinked = put({
      expectedUpdatedAt: saved.updatedAt,
      elements: { ...saved.elements, lowerThird: { ...own, shared: true } },
    });
    expect((await api("PUT", "keynote", relinked)).status).toBe(200);
    expect((await lowerThirdOf("keynote")).y).toBe(0.6);
  });

  it("applies one layout's position to every layout that shares it", async () => {
    const own = { ...FULL_FRAME.lowerThird, shared: false, x: 0.2, y: 0.25 };
    expect((await api("PUT", "keynote", put({ elements: { ...put().elements, lowerThird: own } }))).status).toBe(200);
    // "Apply this position to all layouts": the shared position takes the box, and the layout shares it again.
    const before = (await current()).positions;
    const applied = await positions("PUT", {
      expectedUpdatedAt: before.updatedAt,
      elements: { ...before.elements, lowerThird: liveOverlayBoxOf(own) },
    });
    expect(applied.status).toBe(200);
    const saved = (await current()).layouts.find((layout) => layout.slug === "keynote")!;
    await api(
      "PUT",
      "keynote",
      put({
        expectedUpdatedAt: saved.updatedAt,
        elements: { ...saved.elements, lowerThird: { ...own, shared: true } },
      }),
    );
    for (const slug of ["full-frame", "lower-third", "keynote"])
      expect(await lowerThirdOf(slug), slug).toEqual(liveOverlayBoxOf(own));
  });

  it("resets the shared positions to the built-in ones, and refuses a stale or invalid save", async () => {
    const moved = await moveShared(0.4);
    const stale = await positions("PUT", { expectedUpdatedAt: null, elements: moved.positions.elements });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe("LIVE_OVERLAY_POSITIONS_CHANGED");
    const outside = { ...moved.positions.elements, timer: { ...moved.positions.elements.timer, x: 0.95, w: 0.2 } };
    expect((await positions("PUT", { expectedUpdatedAt: moved.positions.updatedAt, elements: outside })).status).toBe(
      400,
    );
    expect((await api("DELETE", null, undefined, "attendee", env.DB, positionsPath())).status).toBe(403);
    const reset = await positions("DELETE");
    expect(reset.status).toBe(200);
    expect(eventLiveOverlayLayoutsResponseSchema.parse(await reset.json()).positions).toEqual({
      elements: LIVE_OVERLAY_DEFAULT_POSITIONS,
      saved: false,
      updatedAt: null,
    });
    expect(await lowerThirdOf("full-frame")).toEqual(LIVE_OVERLAY_DEFAULT_POSITIONS.lowerThird);
    expect((await audits()).map((row) => row.action)).toEqual([
      "live_overlay_positions_saved",
      "live_overlay_positions_reset",
    ]);
  });
});
