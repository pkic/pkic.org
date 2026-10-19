// @vitest-environment node
import { createHash } from "node:crypto";
import { PORTAL_OFFLINE_STATIC_ASSETS } from "../../assets/shared/schemas/portal-offline-assets";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-outbox", () => ({
  drainScanOutbox: vi.fn(),
}));
interface WorkerEvent {
  request?: Request;
  waitUntil: (promise: Promise<unknown>) => void;
  respondWith: (promise: Promise<Response>) => void;
}
const origin = "https://pkic.example";
const branding = ["/img/logo.svg", "/img/icon-180x180-white-trans.png"];
let listeners: Map<string, (event: WorkerEvent) => void>;
let entries: Map<string, Response>;
let generations: Map<string, Map<string, Response>>;
let fetcher: ReturnType<typeof vi.fn>;
const requestKey = (key: Request | string) => (typeof key === "string" ? new URL(key, origin).href : key.url);
const inventory = JSON.stringify({
  version: 1,
  entrypoints: ["/js/built/portal.js", "/_assets/changed.js"],
  assets: [
    "/js/built/portal.js",
    "/_assets/portal.css",
    "/_assets/changed.js",
    "/_assets/preload-helper.js",
    ...PORTAL_OFFLINE_STATIC_ASSETS,
  ],
});
const inventoryPath = `/_assets/scanner-offline-${createHash("sha256").update(inventory).digest("hex")}.json`;
const shell = (html: string) =>
  new Response(html + `<link rel="pkic-scanner-offline" href="${inventoryPath}">`, {
    headers: { "content-type": "text/html" },
  });
const publicAsset = (key: Request | string, body = "public branding") =>
  new Response(requestKey(key).endsWith(inventoryPath) ? inventory : body, {
    headers: {
      "content-type": requestKey(key).endsWith(inventoryPath)
        ? "application/json"
        : requestKey(key).endsWith(".svg")
          ? "image/svg+xml"
          : "image/png",
    },
  });
beforeEach(async () => {
  vi.resetModules();
  listeners = new Map();
  generations = new Map();
  entries = new Map();
  vi.stubGlobal("self", {
    location: { origin, href: `${origin}/_assets/scanner-worker-oldhash.js` },
    clients: { claim: vi.fn(), matchAll: vi.fn() },
    addEventListener: (type: string, callback: (event: WorkerEvent) => void) => listeners.set(type, callback),
  });
  vi.stubGlobal("caches", {
    keys: vi.fn(async () => [...generations.keys()]),
    delete: vi.fn(async (name: string) => generations.delete(name)),
    open: vi.fn(async (name: string) => {
      const cacheEntries = generations.get(name) ?? new Map<string, Response>();
      generations.set(name, cacheEntries);
      if (name.includes("oldhash")) entries = cacheEntries;
      return {
        put: vi.fn(async (key: Request | string, value: Response) => {
          cacheEntries.set(requestKey(key), value.clone());
        }),
        match: vi.fn(async (key: Request | string) => cacheEntries.get(requestKey(key))?.clone()),
      };
    }),
  });
  fetcher = vi.fn(async (key: Request | string) =>
    requestKey(key).endsWith("/portal/")
      ? shell(
          '<script src="/js/built/portal.js"></script><link href="/_assets/portal.css"><img src="/private/attendee-photo.png">',
        )
      : publicAsset(key),
  );
  vi.stubGlobal("fetch", fetcher);
  await import("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-service-worker");
});
afterEach(() => {
  vi.unstubAllGlobals();
});
async function install() {
  const waitUntil = vi.fn();
  listeners.get("install")!({ waitUntil, respondWith: vi.fn() });
  await waitUntil.mock.calls[0]![0];
}
function fetchEvent(path: string, destination = "image", method = "GET") {
  const request = new Request(new URL(path, origin), { method });
  Object.defineProperty(request, "destination", { value: destination });
  const event: WorkerEvent = { request, waitUntil: vi.fn(), respondWith: vi.fn() };
  listeners.get("fetch")!(event);
  return event;
}
async function loadGeneration(hash: string, query = "") {
  vi.resetModules();
  listeners = new Map();
  vi.stubGlobal("self", {
    location: { origin, href: `${origin}/_assets/scanner-worker-${hash}.js${query}` },
    clients: { claim: vi.fn(), matchAll: vi.fn() },
    addEventListener: (type: string, callback: (event: WorkerEvent) => void) => listeners.set(type, callback),
  });
  await import("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-service-worker");
}
async function cacheSnapshot() {
  return Promise.all(
    [...generations].map(async ([name, rows]) => [
      name,
      await Promise.all([...rows].map(async ([url, response]) => [url, await response.clone().text()])),
    ]),
  );
}

describe("offline scanner branding cache", () => {
  it("warms only the public scanner branding alongside its shell, with credentials omitted", async () => {
    await install();
    for (const path of branding) {
      expect(entries.has(`${origin}${path}`)).toBe(true);
      expect(fetcher).toHaveBeenCalledWith(path, { credentials: "omit" });
    }
    expect(entries.has(`${origin}/js/built/portal.js`)).toBe(true);
    expect(entries.has(`${origin}/_assets/portal.css`)).toBe(true);
    expect([...entries.keys()].some((key) => key.includes("attendee"))).toBe(false);
  });
  it("prepares transitive startup imports before the first cold offline navigation", async () => {
    await install();
    expect(entries.has(`${origin}/_assets/preload-helper.js`)).toBe(true);
    fetcher.mockRejectedValue(new TypeError("offline"));
    const event = fetchEvent("/_assets/preload-helper.js", "script");
    expect(await (await vi.mocked(event.respondWith).mock.calls[0]![0]).text()).toBe("public branding");
  });
  it("refuses a changed inventory body before creating a candidate cache", async () => {
    fetcher.mockImplementation(async (key: Request | string) =>
      requestKey(key).endsWith("/portal/")
        ? shell('<script src="/js/built/portal.js"></script>')
        : new Response(inventory + " "),
    );
    await expect(install()).rejects.toThrow("digest differs");
    expect(generations.size).toBe(0);
  });
  it("retains explicitly prewarmed camera and fallback modules for a fresh offline decoder load", async () => {
    const modules = ["/_assets/qr-scanner.min.camera.js", "/_assets/qr-scanner-worker.min.decoder.js"];
    fetcher.mockImplementation(async (request: Request) => {
      const response = new Response(request.url.endsWith("decoder.js") ? "fallback decoder module" : "camera module");
      Object.defineProperty(response, "type", { value: "basic" });
      return response;
    });
    for (const path of modules) {
      const event = fetchEvent(path, "script");
      await vi.mocked(event.respondWith).mock.calls[0]![0];
      expect(entries.has(`${origin}${path}`)).toBe(true);
    }
    fetcher.mockClear();
    fetcher.mockRejectedValue(new Error("offline"));
    const fallback = fetchEvent(modules[1]!, "script");
    expect(await (await vi.mocked(fallback.respondWith).mock.calls[0]![0]).text()).toBe("fallback decoder module");
    const camera = fetchEvent(modules[0]!, "script");
    expect(await (await vi.mocked(camera.respondWith).mock.calls[0]![0]).text()).toBe("camera module");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(branding)("serves warmed %s when the browser restarts offline", async (path) => {
    await install();
    fetcher.mockClear();
    fetcher.mockRejectedValue(new Error("offline"));
    const event = fetchEvent(path);
    expect(event.respondWith).toHaveBeenCalledOnce();
    const response = await vi.mocked(event.respondWith).mock.calls[0]![0];
    expect(await response.text()).toBe("public branding");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ["/img/attendees/person.png", "image", "GET"],
    ["/api/v1/users/current/photo", "image", "GET"],
    ["/private/badge.svg", "image", "GET"],
    ["/_assets/attendee-photo.png", "image", "GET"],
    ["/img/logo.svg?attendeeId=private", "image", "GET"],
    ["https://other.example/img/logo.svg", "image", "GET"],
    ["/img/logo.svg", "", "GET"],
    ["/img/logo.svg", "image", "POST"],
  ])("does not intercept or retain nonpublic image request %s (%s, %s)", async (path, destination, method) => {
    const event = fetchEvent(path, destination, method);
    expect(event.respondWith).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(entries.size).toBe(0);
  });
});

describe("changed scanner cache generations", () => {
  it.each(["network", "404", "shell-403", "shell-invalid-type"])(
    "preserves last-good shell and assets on failed %s install",
    async (failure) => {
      await install();
      const before = await cacheSnapshot();
      await loadGeneration("newhash");
      fetcher.mockImplementation(async (key: Request | string) => {
        const url = requestKey(key);
        if (url.endsWith("/portal/")) {
          if (failure === "shell-403")
            return new Response("denied", { status: 403, headers: { "content-type": "text/html" } });
          if (failure === "shell-invalid-type")
            return new Response("not html", { headers: { "content-type": "application/json" } });
          return shell('<script src="/_assets/changed.js"></script>');
        }
        if (url.endsWith("changed.js")) {
          if (failure === "network") throw new TypeError("Controlled failed required asset");
          return new Response("missing", { status: 404 });
        }
        return publicAsset(key);
      });
      await expect(install()).rejects.toThrow();
      expect(await cacheSnapshot()).toEqual(before);
    },
  );
  it("keeps old public files available while the fully prepared new shell uses its own generation", async () => {
    await install();
    const before = await cacheSnapshot();
    await loadGeneration("newhash");
    fetcher.mockImplementation(async (key: Request | string) =>
      requestKey(key).endsWith("/portal/")
        ? shell('<script src="/_assets/changed.js"></script>')
        : publicAsset(key, requestKey(key).endsWith("/js/built/portal.js") ? "public branding" : "new public asset"),
    );
    await install();
    expect(generations.size).toBe(2);
    const snapshots = await cacheSnapshot();
    expect(snapshots[0]).toEqual(before[0]);
    expect(JSON.stringify(snapshots[1])).toContain("changed.js");
    fetcher.mockRejectedValue(new TypeError("offline"));
    const retained = fetchEvent("/js/built/portal.js", "script");
    expect(await (await vi.mocked(retained.respondWith).mock.calls[0]![0]).text()).toBe("public branding");
  });
});

it("retains at most current and immediate prior generations only after successful activation", async () => {
  await install();
  await loadGeneration("secondhash");
  await install();
  await loadGeneration("thirdhash");
  await install();
  // Installing/waiting never removes a generation still owned by an old client.
  expect(generations.size).toBe(3);
  const waitUntil = vi.fn();
  listeners.get("activate")!({ waitUntil, respondWith: vi.fn() });
  await waitUntil.mock.calls[0]![0];
  expect([...generations.keys()]).toEqual([
    `${"pkic-scanner-shell-v2:"}${origin}/_assets/scanner-worker-secondhash.js`,
    `${"pkic-scanner-shell-v2:"}${origin}/_assets/scanner-worker-thirdhash.js`,
  ]);
});

it("does not rewrite or delete a complete generation on query-only registration retry", async () => {
  await install();
  const before = await cacheSnapshot();
  await loadGeneration("oldhash", "?replacement=one");
  fetcher.mockClear();
  fetcher.mockRejectedValue(new TypeError("must not refetch existing active generation"));
  await install();
  expect(await cacheSnapshot()).toEqual(before);
  expect(fetcher).not.toHaveBeenCalled();
});

it("separates an app-only release and retains only a complete prior generation", async () => {
  const firstRelease = "1".repeat(64);
  const secondRelease = "2".repeat(64);
  await loadGeneration("unchangedworkerhash", `?portalRelease=${firstRelease}`);
  await install();
  const firstName = [...generations.keys()][0]!;
  await loadGeneration("unchangedworkerhash", `?portalRelease=${secondRelease}`);
  await install();
  const newestName = [...generations.keys()].at(-1)!;
  expect(newestName).not.toBe(firstName);
  generations.set("pkic-scanner-shell-v2:incomplete-candidate", new Map());
  const waitUntil = vi.fn();
  listeners.get("activate")!({ waitUntil, respondWith: vi.fn() });
  await waitUntil.mock.calls[0]![0];
  expect([...generations.keys()]).toEqual([firstName, newestName]);
});
