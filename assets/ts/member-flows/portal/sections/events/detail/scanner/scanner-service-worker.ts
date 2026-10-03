import { eventScanResponseSchema } from "../../../../../../../shared/schemas/event-participation-scanning";
import { drainScanOutbox } from "./scan-outbox";

interface WorkerEvent {
  waitUntil(promise: Promise<unknown>): void;
}
interface WorkerFetchEvent extends WorkerEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
}
interface WorkerScope {
  location: Location;
  clients: { claim(): Promise<void>; matchAll(): Promise<Array<{ postMessage(value: unknown): void }>> };
  addEventListener(type: string, callback: (event: WorkerEvent) => void): void;
}
declare const self: WorkerScope;
const worker = self;
const CACHE = "pkic-scanner-shell-v1";
worker.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const response = await fetch("/portal/", { credentials: "omit" });
      if (response.ok && response.headers.get("content-type")?.includes("text/html")) {
        const cache = await caches.open(CACHE);
        const html = await response.clone().text();
        await cache.put("/portal/", response);
        const paths = [...html.matchAll(/(?:src|href)="((?:\/js\/built\/|\/_assets\/)[^"?#]+\.(?:js|css))"/g)].map(
          (match) => match[1],
        );
        await Promise.all(
          paths.map(async (path) => {
            const asset = await fetch(path, { credentials: "omit" });
            if (asset.ok) await cache.put(path, asset);
          }),
        );
      }
    })(),
  ),
);
worker.addEventListener("activate", (event) => event.waitUntil(worker.clients.claim()));
const allowed = (request: Request) => {
  const url = new URL(request.url);
  return (
    request.method === "GET" &&
    url.origin === worker.location.origin &&
    (((url.pathname.startsWith("/js/built/") || url.pathname.startsWith("/_assets/")) &&
      ["script", "style"].includes(request.destination)) ||
      (url.pathname.startsWith("/fonts/") && request.destination === "font"))
  );
};
worker.addEventListener("fetch", (raw) => {
  const event = raw as WorkerFetchEvent;
  if (event.request.mode === "navigate" && new URL(event.request.url).pathname === "/portal/") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await (await caches.open(CACHE)).match("/portal/");
        return cached ?? Response.error();
      }),
    );
    return;
  }
  if (!allowed(event.request)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const existing = await cache.match(event.request);
      if (existing) return existing;
      const response = await fetch(event.request);
      if (response.ok && response.type === "basic") await cache.put(event.request, response.clone());
      return response;
    })(),
  );
});
worker.addEventListener("sync", (event) => {
  if ((event as WorkerEvent & { tag: string }).tag !== "pkic-scanner-upload") return;
  event.waitUntil(
    (async () => {
      const receipts: ReturnType<typeof eventScanResponseSchema.parse>[] = [];
      await drainScanOutbox(async (record) => {
        const response = await fetch(`/api/v1/events/${encodeURIComponent(record.eventId)}/scans`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(record.scan),
          signal: AbortSignal.timeout(15_000),
        });
        if (response.ok) {
          const receipt = eventScanResponseSchema.parse(await response.clone().json());
          if (receipt.operationId === record.scan.operationId) {
            receipts.push(receipt);
          }
        }
        return response;
      });
      for (const client of await worker.clients.matchAll()) for (const receipt of receipts) client.postMessage(receipt);
    })(),
  );
});
