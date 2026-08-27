import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEventFlowPath } from "../assets/shared/event-flow-paths";
import { createGroupManagedEvent } from "../functions/_lib/services/events/group-management";
import type { DatabaseLike, Env, StaticAssetsBinding } from "../functions/_lib/types";
import app from "../functions/router";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";

const OWNER_GROUP_ID = "20000000-0000-4000-8000-000000000003";
const EVENT_SLUG = "portal-public-shell-test";
const EVENT_BASE_PATH = `/events/2027/${EVENT_SLUG}/`;

const FLOW_PATHS = [
  ["registration", `${EVENT_BASE_PATH}register/`],
  ["registrationConfirm", `${EVENT_BASE_PATH}register/confirm/`],
  ["registrationManage", `${EVENT_BASE_PATH}register/manage/`],
  ["proposal", `${EVENT_BASE_PATH}propose/`],
  ["proposalManage", `${EVENT_BASE_PATH}propose/manage/`],
  ["speakerManage", `${EVENT_BASE_PATH}propose/speaker/`],
  ["speakerPresentation", `${EVENT_BASE_PATH}propose/presentation/`],
  ["inviteDecline", `${EVENT_BASE_PATH}invite/decline/`],
] as const;

function expectPrivateNoStoreHeaders(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("x-frame-options")).toBe("DENY");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
}

type AssetRecorder = StaticAssetsBinding & { calls: Request[] };

const NO_DB = {
  prepare() {
    throw new Error("public event flow shell must not consult D1");
  },
} as unknown as DatabaseLike;

function assetsFor(options: { staticPaths?: string[]; missingShell?: string } = {}): AssetRecorder {
  const calls: Request[] = [];
  const staticPaths = new Set(options.staticPaths ?? []);
  const assets: AssetRecorder = {
    calls,
    fetch: vi.fn(async (request: Request) => {
      calls.push(request);
      const pathname = new URL(request.url).pathname;
      if (staticPaths.has(pathname)) {
        return new Response("existing Hugo event page", {
          status: 200,
          headers: { "content-type": "text/html; charset=UTF-8" },
        });
      }
      if (pathname.startsWith("/_event-flow-shells/")) {
        if (options.missingShell === pathname) return new Response("missing", { status: 404 });
        return new Response(`<main data-shell-path="${pathname}"></main>`, {
          status: 200,
          headers: { "content-type": "text/html; charset=UTF-8" },
        });
      }
      return new Response("Not found", { status: 404 });
    }),
  };
  return assets;
}

function request(path: string, method = "GET"): Request {
  return new Request(`https://app.test${path}`, { method });
}

function workerEnv(assets: AssetRecorder, db: DatabaseLike = env.DB): Env {
  return { ...env, DB: db, ASSETS: undefined, ASSETS_PUBLIC: assets } as unknown as Env;
}

async function createPortalEvent(): Promise<string> {
  const email = `public-shell-admin-${crypto.randomUUID()}@example.test`;
  const adminId = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(adminId).run();
  const created = await createGroupManagedEvent(
    env.DB,
    { identityType: "user", id: adminId, email, role: "admin" },
    OWNER_GROUP_ID,
    {
      slug: EVENT_SLUG,
      name: "Portal public shell test",
      timezone: "UTC",
      startsAt: "2027-11-01T09:00:00.000Z",
      endsAt: "2027-11-01T17:00:00.000Z",
      profileKey: "workshop",
      registrationPolicy: "no_registration",
      inviteLimitAttendee: 5,
      links: [],
    },
  );
  return created.eventId;
}

describe("portal event public flow shells", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("parses only supported canonical flow paths and preserves the event base path", () => {
    expect(parseEventFlowPath(`${EVENT_BASE_PATH}register/`)).toEqual({
      eventSlug: EVENT_SLUG,
      eventBasePath: EVENT_BASE_PATH,
      flow: "registration",
    });
    expect(parseEventFlowPath(`/events/${EVENT_SLUG}/propose/manage/`)).toEqual({
      eventSlug: EVENT_SLUG,
      eventBasePath: `/events/${EVENT_SLUG}/`,
      flow: "proposalManage",
    });
    expect(parseEventFlowPath(`/events/${EVENT_SLUG}/register/`)).toEqual({
      eventSlug: EVENT_SLUG,
      eventBasePath: `/events/${EVENT_SLUG}/`,
      flow: "registration",
    });
    expect(parseEventFlowPath("/events/2026/register/")).toEqual({
      eventSlug: "2026",
      eventBasePath: "/events/2026/",
      flow: "registration",
    });

    for (const path of [
      `/events/2027/${EVENT_SLUG}/register/unknown/`,
      `/events/2027/${EVENT_SLUG}/agenda/`,
      `/events/2027/${EVENT_SLUG}/register%2Fconfirm/`,
      `/events/2027/${EVENT_SLUG}/register\\confirm/`,
      `/events/2027/${EVENT_SLUG}/register/../../admin/`,
      `/not-events/2027/${EVENT_SLUG}/register/`,
      `/events/20270/${EVENT_SLUG}/register/`,
    ]) {
      expect(parseEventFlowPath(path)).toBeNull();
    }
  });

  it("serves every portal-owned flow through the shared shell assets", async () => {
    const assets = assetsFor();

    for (const [flow, path] of FLOW_PATHS) {
      const response = await app.fetch(request(path), workerEnv(assets, NO_DB), {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any);

      expect(response.status, flow).toBe(200);
      expect(response.headers.get("content-type"), flow).toContain("text/html");
      await expect(response.text(), flow).resolves.toContain("data-shell-path");
    }

    const internalShellPaths = assets.calls
      .filter((call) => new URL(call.url).pathname.startsWith("/_event-flow-shells/"))
      .map((call) => new URL(call.url).pathname);
    expect(internalShellPaths).toEqual([
      "/_event-flow-shells/registration/",
      "/_event-flow-shells/registration-confirm/",
      "/_event-flow-shells/registration-manage/",
      "/_event-flow-shells/proposal/",
      "/_event-flow-shells/proposal-manage/",
      "/_event-flow-shells/speaker-manage/",
      "/_event-flow-shells/speaker-presentation/",
      "/_event-flow-shells/invite-decline/",
    ]);
  });

  it("serves a portal shell with security headers and strips query parameters from the internal asset fetch", async () => {
    const assets = assetsFor();
    const response = await app.fetch(
      new Request(`https://app.test${EVENT_BASE_PATH}register/?token=not-a-shell-token&debug=1`, {
        headers: {
          authorization: "Bearer capability-secret",
          cookie: "session=capability-secret",
          "x-event-base-path": "/events/attacker/",
        },
      }),
      workerEnv(assets, NO_DB),
      {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any,
    );

    expect(response.status).toBe(200);
    expectPrivateNoStoreHeaders(response);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");

    expect(assets.calls).toHaveLength(2);
    for (const assetRequest of assets.calls) {
      expect(new URL(assetRequest.url).search).toBe("");
      expect(assetRequest.headers.get("authorization")).toBeNull();
      expect(assetRequest.headers.get("cookie")).toBeNull();
      expect(assetRequest.headers.get("x-event-base-path")).toBeNull();
    }
    expect(new URL(assets.calls[1].url).pathname).toBe("/_event-flow-shells/registration/");
  });

  it("supports HEAD without returning a body and rejects POST before consulting assets", async () => {
    const headAssets = assetsFor();
    const headResponse = await app.fetch(request(`${EVENT_BASE_PATH}register/`, "HEAD"), workerEnv(headAssets, NO_DB), {
      passThroughOnException: () => {},
      waitUntil: () => {},
    } as any);
    expect(headResponse.status).toBe(200);
    expect(await headResponse.text()).toBe("");
    expect(headAssets.calls.map((call) => call.method)).toEqual(["HEAD", "GET"]);

    const postAssets = assetsFor();
    const postResponse = await app.fetch(request(`${EVENT_BASE_PATH}register/`, "POST"), workerEnv(postAssets, NO_DB), {
      passThroughOnException: () => {},
      waitUntil: () => {},
    } as any);
    expect(postResponse.status).toBe(405);
    expect(postResponse.headers.get("allow")).toBe("GET, HEAD");
    expectPrivateNoStoreHeaders(postResponse);
    expect(postAssets.calls).toHaveLength(0);

    const unavailableResponse = await app.fetch(
      request(`${EVENT_BASE_PATH}register/`),
      { ...workerEnv(postAssets, NO_DB), ASSETS_PUBLIC: undefined } as unknown as Env,
      {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any,
    );
    expect(unavailableResponse.status).toBe(503);
    expectPrivateNoStoreHeaders(unavailableResponse);
  });

  it("serves a generic shell for disabled or unknown event state", async () => {
    const assets = assetsFor();
    const response = await app.fetch(request(`${EVENT_BASE_PATH}register/`), workerEnv(assets, NO_DB), {
      passThroughOnException: () => {},
      waitUntil: () => {},
    } as any);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("data-shell-path");

    const unknownResponse = await app.fetch(request("/events/2099/no-such-event/register/"), workerEnv(assets, NO_DB), {
      passThroughOnException: () => {},
      waitUntil: () => {},
    } as any);
    expect(unknownResponse.status).toBe(200);
  });

  it("does not shadow static Hugo pages and rejects non-portal, unknown, and unsupported nested paths", async () => {
    await seedEventAndAdmin(env.DB);
    await env.DB.prepare(
      "UPDATE events SET starts_at = '2027-11-01T09:00:00.000Z', source_mode = 'hugo' WHERE slug = 'pqc-2026'",
    ).run();
    const existingPath = "/events/2026/pqc-conference-amsterdam-nl/register/";
    const assets = assetsFor({ staticPaths: [existingPath] });
    const existingResponse = await app.fetch(request(existingPath), workerEnv(assets, NO_DB), {
      passThroughOnException: () => {},
      waitUntil: () => {},
    } as any);
    expect(existingResponse.status).toBe(200);
    expect(await existingResponse.text()).toBe("existing Hugo event page");
    expect(assets.calls).toHaveLength(1);

    for (const path of [
      `/events/2027/${EVENT_SLUG}/register/`,
      `/events/2027/not-a-real-event/register/`,
      `/events/2027/pqc-2026/register/`,
    ]) {
      const response = await app.fetch(request(path), workerEnv(assets, NO_DB), {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any);
      expect(response.status, path).toBe(200);
      await expect(response.text(), path).resolves.toContain("data-shell-path");
    }

    for (const path of [`/events/2027/${EVENT_SLUG}/register/extra/`, `/events/2027/${EVENT_SLUG}/agenda/`]) {
      const response = await app.fetch(request(path), workerEnv(assets, NO_DB), {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any);
      expect(response.status, path).toBe(404);
    }

    expect(
      assets.calls.filter((call) => new URL(call.url).pathname.startsWith("/_event-flow-shells/")),
    ).not.toHaveLength(0);
  });

  it("keeps a persisted portal base_path routable when the event start date changes", async () => {
    await createPortalEvent();
    const assets = assetsFor();

    for (const [flow, path] of FLOW_PATHS) {
      const before = await app.fetch(request(path), workerEnv(assets, NO_DB), {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any);
      expect(before.status, flow).toBe(200);
    }

    await env.DB.prepare("UPDATE events SET starts_at = ? WHERE slug = ?")
      .bind("2028-11-01T09:00:00.000Z", EVENT_SLUG)
      .run();

    for (const [flow, path] of FLOW_PATHS) {
      const after = await app.fetch(request(path), workerEnv(assets, NO_DB), {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any);
      expect(after.status, flow).toBe(200);
    }

    const event = await env.DB.prepare("SELECT base_path, starts_at FROM events WHERE slug = ?")
      .bind(EVENT_SLUG)
      .first<{ base_path: string | null; starts_at: string }>();
    expect(event).toEqual({ base_path: EVENT_BASE_PATH, starts_at: "2028-11-01T09:00:00.000Z" });
  });
});
