import { PORTAL_WORKER_RELEASE_PARAMETER, portalWorkerPageRelease } from "./portal-worker-release";
import scannerWorkerUrl from "./sections/events/detail/scanner/scanner-service-worker?worker&url";

const registrationDeadlineMs = 15_000;
const registrations = new WeakMap<ServiceWorkerContainer, Promise<ServiceWorkerRegistration>>();

async function releaseWorkerUrl(): Promise<string> {
  const release = await portalWorkerPageRelease();
  const worker = new URL(scannerWorkerUrl, location.origin);
  worker.searchParams.set(PORTAL_WORKER_RELEASE_PARAMETER, release);
  return worker.href;
}

/** Public app files only. Registration never requests notification permission or subscribes to push. */
export function registerPortalServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || typeof navigator.serviceWorker?.register !== "function")
    return Promise.resolve(null);
  const workers = navigator.serviceWorker;
  const existing = registrations.get(workers);
  if (existing) return existing;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Portal offline files could not be prepared.")), registrationDeadlineMs);
  });
  const pending = Promise.race([
    releaseWorkerUrl().then((url) =>
      workers.register(url, { scope: "/portal/", type: "module", updateViaCache: "none" }),
    ),
    deadline,
  ]).finally(() => clearTimeout(timer));
  registrations.set(workers, pending);
  void pending.catch(() => {
    if (registrations.get(workers) === pending) registrations.delete(workers);
  });
  return pending;
}
