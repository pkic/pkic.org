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
const CACHE = "pkic-scanner-shell-v1";
const BRANDING_ASSETS = new Set(["/img/logo.svg", "/img/icon-180x180-white-trans.png"]);
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
          [...new Set([...paths, ...BRANDING_ASSETS])].map(async (path) => {
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
