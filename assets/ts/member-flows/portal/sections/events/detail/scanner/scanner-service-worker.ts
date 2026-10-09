import { scannerOfflineAssets } from "./scanner-offline-install";
import { PORTAL_OFFLINE_STATIC_ASSETS } from "../../../../../../../shared/schemas/portal-offline-assets";
import { portalWorkerCacheIdentity } from "../../../../portal-worker-release";
import { userAuthSessionResponseSchema } from "../../../../../../../shared/schemas/user-auth";
import { readActiveUserSession, scannerUploadSuspended } from "../../../../../../shared/pending-user-logout";
import { scannerReceiptMatches } from "./scanner-receipt";
import { eventScanResponseSchema } from "../../../../../../../shared/schemas/event-participation-scanning";
import { scannerUploadStatusMessageSchema } from "../../../../../../../shared/schemas/event-scan-upload-status";
import { drainScanOutbox } from "./scan-outbox";
import "../../../../notifications/portal-push-worker";

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
// Vite emits a content-fingerprinted module URL. A waiting generation must not
// overwrite the public shell still used by active clients.
const CACHE_PREFIX = "pkic-scanner-shell-";
const CACHE = `${CACHE_PREFIX}v2:${portalWorkerCacheIdentity(worker.location.href)}`;
// Public images the shell precaches; anything else (attendee photos, badges) never enters the cache.
const BRANDING_ASSETS = new Set<string>(PORTAL_OFFLINE_STATIC_ASSETS.filter((path) => path.startsWith("/img/")));
worker.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      // Query-only registrations and retries of the same immutable worker must
      // not rewrite or delete an already complete active generation.
      if ((await caches.keys()).includes(CACHE) && (await (await caches.open(CACHE)).match("/portal/"))) return;
      const response = await fetch("/portal/", { credentials: "omit" });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html"))
        throw new Error("Scanner offline shell could not be prepared");
      const html = await response.clone().text();
      const paths = await scannerOfflineAssets(html);
      try {
        const cache = await caches.open(CACHE);
        // Bound memory and connections while writing only this uncommitted generation.
        const pending = [...paths];
        const workers = await Promise.allSettled(
          Array.from({ length: 4 }, async () => {
            while (pending.length) {
              const path = pending.shift()!;
              const asset = await fetch(path, { credentials: "omit" });
              if (!asset.ok) throw new Error("Scanner offline files could not be prepared");
              await cache.put(path, asset);
            }
          }),
        );
        const failed = workers.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
        await cache.put("/portal/", response);
      } catch (error) {
        await caches.delete(CACHE);
        throw error;
      }
    })(),
  ),
);
worker.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      // No skipWaiting: old controlled clients release their worker before
      // activation. Keep the immediate prior public generation for exact old
      // module requests, and discard older generations only after activation.
      await worker.clients.claim();
      const previous = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE);
      const complete = [];
      for (const name of previous) if (await (await caches.open(name)).match("/portal/")) complete.push(name);
      const retained = complete.at(-1);
      await Promise.all(previous.filter((name) => name !== retained).map((name) => caches.delete(name)));
    })(),
  ),
);
const allowed = (request: Request) => {
  const url = new URL(request.url);
  return (
    request.method === "GET" &&
    url.origin === worker.location.origin &&
    (((url.pathname.startsWith("/js/built/") || url.pathname.startsWith("/_assets/")) &&
      ["script", "style"].includes(request.destination)) ||
      (url.pathname.startsWith("/fonts/") && request.destination === "font") ||
      (BRANDING_ASSETS.has(url.pathname) && !url.search && request.destination === "image"))
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
      // Existing controlled pages can still request their exact older hashed
      // modules after activation. Keep earlier public generations available;
      // never use another generation's shell as the current shell.
      for (const name of (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE)) {
        const retained = await (await caches.open(name)).match(event.request);
        if (retained) return retained;
      }
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
      const active = await readActiveUserSession();
      const sessionResponse =
        active && !(await scannerUploadSuspended(active.operatorUserId, active.sessionId))
          ? await fetch("/api/v1/auth/session", { credentials: "same-origin", signal: AbortSignal.timeout(15_000) })
          : null;
      const session = sessionResponse?.ok
        ? userAuthSessionResponseSchema.safeParse(await sessionResponse.json())
        : null;
      const authorized =
        session?.success &&
        session.data.sessionId === active?.sessionId &&
        session.data.identity.id === active?.operatorUserId;
      const result =
        !authorized || !active
          ? { uploaded: 0, state: "authentication_required" as const }
          : await drainScanOutbox(async (record) => {
              if (await scannerUploadSuspended(record.scan.operatorUserId, active.sessionId))
                return new Response(null, { status: 401 });
              const response = await fetch(`/api/v1/events/${encodeURIComponent(record.eventId)}/scans`, {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(record.scan),
                signal: AbortSignal.timeout(15_000),
              });
              if (response.ok) {
                const receipt = eventScanResponseSchema.parse(await response.clone().json());
                if (scannerReceiptMatches(receipt, record.scan)) {
                  receipts.push(receipt);
                }
              }
              return response;
            }, active.operatorUserId);
      for (const client of await worker.clients.matchAll()) {
        for (const receipt of receipts) client.postMessage(receipt);
        client.postMessage(scannerUploadStatusMessageSchema.parse({ type: "pkic-scanner-upload-status", ...result }));
      }
      // One bounded drain can leave work pending. Rejecting waitUntil requests
      // browser-managed retry; the outbox retains its own persisted backoff.
      // Authentication refusal requires foreground sign-in, not repeated uploads.
      if (result.state === "retry") throw new Error("Scanner upload remains pending");
    })(),
  );
});
