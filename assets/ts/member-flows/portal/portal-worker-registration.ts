import scannerWorkerUrl from "./sections/events/detail/scanner/scanner-service-worker?worker&url";

const registrationDeadlineMs = 15_000;
const registrations = new WeakMap<ServiceWorkerContainer, Promise<ServiceWorkerRegistration>>();

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
    Promise.resolve().then(() => workers.register(scannerWorkerUrl, { scope: "/portal/", type: "module" })),
    deadline,
  ]).finally(() => clearTimeout(timer));
  registrations.set(workers, pending);
  void pending.catch(() => {
    if (registrations.get(workers) === pending) registrations.delete(workers);
  });
  return pending;
}
