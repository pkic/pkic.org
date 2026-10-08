// @vitest-environment node
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
let fetcher: ReturnType<typeof vi.fn>;
const requestKey = (key: Request | string) => (typeof key === "string" ? new URL(key, origin).href : key.url);
beforeEach(async () => {
  vi.resetModules();
  listeners = new Map();
  entries = new Map();
  vi.stubGlobal("self", {
    location: { origin },
    clients: { claim: vi.fn(), matchAll: vi.fn() },
    addEventListener: (type: string, callback: (event: WorkerEvent) => void) => listeners.set(type, callback),
  });
  vi.stubGlobal("caches", {
    open: vi.fn(async () => ({
      put: vi.fn(async (key: Request | string, value: Response) => {
        entries.set(requestKey(key), value.clone());
      }),
      match: vi.fn(async (key: Request | string) => entries.get(requestKey(key))?.clone()),
    })),
  });
  fetcher = vi.fn(async (key: Request | string) =>
    requestKey(key).endsWith("/portal/")
      ? new Response(
          '<script src="/js/built/portal.js"></script><link href="/_assets/portal.css"><img src="/private/attendee-photo.png">',
          { headers: { "content-type": "text/html" } },
        )
      : new Response("public branding", {
          headers: { "content-type": requestKey(key).endsWith(".svg") ? "image/svg+xml" : "image/png" },
        }),
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
