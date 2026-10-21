import { clientMutationsAllowReload } from "./client-release-safety";

const CHECK_INTERVAL_MS = 5 * 60_000;
const CHECK_THROTTLE_MS = 60_000;
const IDLE_MS = 15_000;
const RELOAD_RECORD = "pkic.client-release-reload";
const PAGE_LIMIT_BYTES = 512 * 1024;

/** Module URLs already fingerprint the import graph; no extra manifest or build pass. */
export function clientPageRelease(page: Document): string | null {
  const paths = [...page.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')]
    .map((script) => script.getAttribute("src"))
    .filter((path): path is string => !!path && /^\/(?:_assets|js\/built)\/[A-Za-z0-9_./-]+\.js$/.test(path));
  const inventory = page.querySelector<HTMLLinkElement>('link[rel="pkic-scanner-offline"]')?.getAttribute("href");
  if (inventory && /^\/_assets\/scanner-offline-[a-f0-9]{64}\.json$/.test(inventory)) paths.push(inventory);
  return paths.length ? [...new Set(paths)].sort().join("\n") : null;
}

export function isClientImportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk .+ failed/i.test(
    message,
  );
}

const RECOVER_EVENT = "pkic:client-import-error";
const INSTALLED_ATTRIBUTE = "data-client-release-recovery";

/** Also called by render boundaries, which can consume a rejected lazy import. */
export function recoverClientImport(error: unknown): void {
  if (isClientImportError(error)) window.dispatchEvent(new Event(RECOVER_EVENT));
}

/** Install before page behavior imports so lazy failures share one recovery handler. */
export function installClientReleaseRecovery(reload = () => window.location.reload()): () => void {
  if (document.documentElement.hasAttribute(INSTALLED_ATTRIBUTE)) return () => {};
  const release = clientPageRelease(document);
  if (!release) return () => {};
  document.documentElement.setAttribute(INSTALLED_ATTRIBUTE, "");
  let edited = false;
  let lastActivity = Date.now();
  let lastCheck = 0;
  let checking = false;
  let nextRelease: string | null = null;
  let reloading = false;
  let disposed = false;
  const controller = new AbortController();
  const { signal } = controller;

  const safe = () => {
    const route = `${location.pathname}/${location.hash.split("?", 1)[0]}`;
    // These surfaces own cameras, queued scans, live connections, or sign-in transitions.
    const protectedRoute =
      /\/(scanner|lead-scanner|scan|attendance|live|live-overlay|studio|verify|join)(?:\/|$)/i.test(route);
    const editing = document.activeElement?.matches("input, textarea, select, [contenteditable='true']");
    return (
      !edited &&
      !protectedRoute &&
      !editing &&
      clientMutationsAllowReload() &&
      !document.querySelector('dialog[open], [role="dialog"], [aria-busy="true"], iframe') &&
      ![...document.querySelectorAll<HTMLMediaElement>("audio, video")].some(
        (media) => !media.paused && !media.ended,
      ) &&
      document.visibilityState === "visible" &&
      navigator.onLine &&
      !document.fullscreenElement
    );
  };
  const tryReload = () => {
    if (disposed || reloading || !nextRelease || !safe() || Date.now() - lastActivity < IDLE_MS) return;
    try {
      const stored = sessionStorage.getItem(RELOAD_RECORD);
      const record: unknown = stored ? JSON.parse(stored) : null;
      if (
        record &&
        typeof record === "object" &&
        "source" in record &&
        "at" in record &&
        (record.source === release ||
          (typeof record.at === "string" && Date.now() - Date.parse(record.at) < CHECK_INTERVAL_MS))
      )
        return;
      // Storage must succeed before reloading: restricted storage fails closed, without a loop.
      sessionStorage.setItem(RELOAD_RECORD, JSON.stringify({ source: release, at: new Date().toISOString() }));
    } catch {
      return;
    }
    reloading = true;
    reload();
  };
  const check = async (urgent = false) => {
    if (disposed || checking || reloading || !safe()) return;
    if (nextRelease) return tryReload();
    if (!urgent && Date.now() - lastCheck < CHECK_THROTTLE_MS) return;
    checking = true;
    lastCheck = Date.now();
    try {
      // Native HTTP revalidation reuses an unchanged shell through ETag/304; no version endpoint or cookie.
      // Query/hash capabilities and credentials never enter this public-shell probe.
      const response = await fetch(location.pathname, {
        cache: "no-cache",
        credentials: "omit",
        redirect: "error",
        headers: { Accept: "text/html" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return;
      if (Number(response.headers.get("content-length")) > PAGE_LIMIT_BYTES) return;
      const html = await response.text();
      if (new TextEncoder().encode(html).byteLength > PAGE_LIMIT_BYTES) return;
      const current = clientPageRelease(new DOMParser().parseFromString(html, "text/html"));
      if (current && current !== release) nextRelease = current;
      // Recheck safety after the network response: the user may have started editing meanwhile.
      tryReload();
    } catch {
      // Offline, maintenance, and failed checks leave the current application running.
    } finally {
      checking = false;
    }
  };
  const activity = () => {
    lastActivity = Date.now();
  };
  const edit = () => {
    edited = true;
    activity();
  };
  const probe = () => {
    void check();
  };
  const urgentProbe = () => {
    void check(true);
  };
  window.addEventListener(RECOVER_EVENT, urgentProbe, { signal });
  document.addEventListener("beforeinput", edit, { capture: true, signal });
  document.addEventListener("input", edit, { capture: true, signal });
  document.addEventListener("dragstart", edit, { capture: true, signal });
  document.addEventListener("change", edit, { capture: true, signal });
  document.addEventListener("submit", edit, { capture: true, signal });
  document.addEventListener("pointerdown", activity, { capture: true, signal });
  document.addEventListener("keydown", activity, { capture: true, signal });
  document.addEventListener("visibilitychange", probe, { signal });
  window.addEventListener("focus", probe, { signal });
  window.addEventListener("online", probe, { signal });
  window.addEventListener("hashchange", probe, { signal });
  // Do not suppress the original failure: existing error boundaries remain available if recovery is unsafe.
  window.addEventListener("vite:preloadError", urgentProbe, { signal });
  window.addEventListener("unhandledrejection", (event) => recoverClientImport(event.reason), { signal });
  const interval = window.setInterval(probe, CHECK_INTERVAL_MS);
  const retry = window.setInterval(() => {
    if (nextRelease) tryReload();
  }, IDLE_MS);
  return () => {
    disposed = true;
    controller.abort();
    window.clearInterval(interval);
    window.clearInterval(retry);
    document.documentElement.removeAttribute(INSTALLED_ATTRIBUTE);
  };
}
