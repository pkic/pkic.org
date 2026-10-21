import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clientPageRelease,
  installClientReleaseRecovery,
  recoverClientImport,
} from "../../assets/ts/shared/client-release-recovery";
import { beginClientMutation } from "../../assets/ts/shared/client-release-safety";

const shell = (release: string) => `<script type="module" src="/_assets/portal.${release}.js"></script>`;
let dispose: (() => void) | undefined;
let reload: ReturnType<typeof vi.fn<() => void>>;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
const probe = () => window.dispatchEvent(new Event("focus"));
const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T10:00:00.000Z"));
  Reflect.deleteProperty(globalThis, Symbol.for("pkic.client-release-safety"));
  sessionStorage.clear();
  history.replaceState(null, "", "/portal/#/home");
  document.head.innerHTML = shell("old");
  document.body.innerHTML = "";
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  reload = vi.fn();
  fetchMock = vi.fn(async () => new Response(shell("new"), { headers: { "content-type": "text/html" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, Symbol.for("pkic.client-release-safety"));
});
const install = () => {
  dispose = installClientReleaseRecovery(reload);
};

it("refreshes an idle client onto the deployed shell, preserving its route and query", async () => {
  history.replaceState(null, "", "/portal/?appearance=dark#/users?users.q=delegate");
  install();
  await vi.advanceTimersByTimeAsync(16_000);
  probe();
  await settle();
  expect(fetchMock).toHaveBeenCalledWith(
    "/portal/",
    expect.objectContaining({ cache: "no-cache", credentials: "omit", redirect: "error" }),
  );
  expect(reload).toHaveBeenCalledOnce();
  expect(location.hash).toBe("#/users?users.q=delegate");
});
it("checks periodically without any build or version endpoint", async () => {
  install();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(reload).toHaveBeenCalledOnce();
});
it("defers a discovered update until interaction has stopped", async () => {
  install();
  probe();
  await settle();
  expect(reload).not.toHaveBeenCalled();
  document.dispatchEvent(new Event("pointerdown"));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(reload).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledOnce();
});
it.each(["beforeinput", "input", "change", "submit", "dragstart"])(
  "never discards edits after %s, even after changing routes",
  async (type) => {
    install();
    document.dispatchEvent(new Event(type, { bubbles: true }));
    history.replaceState(null, "", "/portal/#/groups");
    await vi.advanceTimersByTimeAsync(600_000);
    probe();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  },
);
it("rechecks edits made while the version request is in flight", async () => {
  let respond!: (response: Response) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  install();
  await vi.advanceTimersByTimeAsync(16_000);
  probe();
  document.dispatchEvent(new Event("input"));
  respond(new Response(shell("new"), { headers: { "content-type": "text/html" } }));
  await settle();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reload).not.toHaveBeenCalled();
});
it.each([
  "/events/conference/scanner",
  "/events/conference/lead-scanner",
  "/events/conference/live/studio",
  "/verify",
  "/events/conference/sponsors/org/scanner",
])("protects active route %s", async (route) => {
  history.replaceState(null, "", `/portal/#${route}`);
  install();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("waits for API mutations and remains blocked after an uncertain save", async () => {
  install();
  const finish = beginClientMutation();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetchMock).not.toHaveBeenCalled();
  finish(false);
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("resumes after a completed mutation", async () => {
  install();
  const finish = beginClientMutation();
  await vi.advanceTimersByTimeAsync(16_000);
  probe();
  expect(fetchMock).not.toHaveBeenCalled();
  finish(true);
  probe();
  await settle();
  expect(reload).toHaveBeenCalledOnce();
});
it.each(["hidden", "offline", "dialog", "focused input"])("does not refresh with %s", async (condition) => {
  if (condition === "hidden") vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  if (condition === "offline") vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  if (condition === "dialog") document.body.innerHTML = "<dialog open></dialog>";
  if (condition === "focused input") {
    document.body.innerHTML = "<input>";
    document.querySelector("input")!.focus();
  }
  install();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["unchanged", "network", "maintenance", "non-html", "missing fingerprint"])(
  "leaves clients running for %s responses",
  async (condition) => {
    if (condition === "unchanged")
      fetchMock.mockResolvedValue(new Response(shell("old"), { headers: { "content-type": "text/html" } }));
    if (condition === "network") fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    if (condition === "maintenance")
      fetchMock.mockResolvedValue(
        new Response(shell("new"), { status: 503, headers: { "content-type": "text/html" } }),
      );
    if (condition === "non-html") fetchMock.mockResolvedValue(Response.json({}));
    if (condition === "missing fingerprint")
      fetchMock.mockResolvedValue(new Response("Maintenance", { headers: { "content-type": "text/html" } }));
    install();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(reload).not.toHaveBeenCalled();
  },
);
it("recovers lazy import errors promptly without swallowing the original failure", async () => {
  install();
  await vi.advanceTimersByTimeAsync(16_000);
  const event = new Event("vite:preloadError", { cancelable: true });
  window.dispatchEvent(event);
  await settle();
  expect(event.defaultPrevented).toBe(false);
  expect(reload).toHaveBeenCalledOnce();
});
it("recognizes a lazy error caught by a render boundary but ignores ordinary errors", async () => {
  install();
  await vi.advanceTimersByTimeAsync(16_000);
  recoverClientImport(new Error("Validation failed"));
  expect(fetchMock).not.toHaveBeenCalled();
  recoverClientImport(new TypeError("Failed to fetch dynamically imported module: /_assets/old.js"));
  await settle();
  expect(reload).toHaveBeenCalledOnce();
});
it("throttles checks and coalesces simultaneous focus and navigation events", async () => {
  fetchMock.mockResolvedValue(new Response(shell("old"), { headers: { "content-type": "text/html" } }));
  install();
  probe();
  probe();
  await settle();
  probe();
  await settle();
  expect(fetchMock).toHaveBeenCalledOnce();
});
it("prevents repeat reloads if a browser receives the stale shell again", async () => {
  install();
  await vi.advanceTimersByTimeAsync(16_000);
  probe();
  await settle();
  dispose!();
  install();
  await vi.advanceTimersByTimeAsync(600_000);
  expect(reload).toHaveBeenCalledOnce();
});
it("fails closed when session storage cannot enforce the reload limit", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  install();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(reload).not.toHaveBeenCalled();
});
it("installs once across independently built entries and aborts requests on cleanup", async () => {
  install();
  const otherDispose = installClientReleaseRecovery(reload);
  otherDispose();
  probe();
  await settle();
  const request = fetchMock.mock.calls[0][1] as RequestInit;
  dispose!();
  expect(request.signal?.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(fetchMock).toHaveBeenCalledOnce();
});
it("includes the existing offline inventory in the release fingerprint", () => {
  const first = clientPageRelease(document);
  const link = document.createElement("link");
  link.rel = "pkic-scanner-offline";
  link.href = `/_assets/scanner-offline-${"a".repeat(64)}.json`;
  document.head.append(link);
  expect(clientPageRelease(document)).not.toBe(first);
});
it.each(["/sessions/", "/members/", "/events/2026/conference/register/", "/donate/"])(
  "recovers active components outside the portal at %s",
  async (path) => {
    history.replaceState(null, "", path);
    install();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetchMock).toHaveBeenCalledWith(path, expect.objectContaining({ cache: "no-cache" }));
    expect(reload).toHaveBeenCalledOnce();
  },
);
it("does not enable automatic refresh without fingerprinted scripts", () => {
  document.head.innerHTML = "";
  install();
  expect(document.documentElement.hasAttribute("data-client-release-recovery")).toBe(false);
});
it.each(["/events/conference/live/", "/live-overlay/"])("never refreshes a live output at %s", async (path) => {
  history.replaceState(null, "", path);
  install();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("keeps embedded payment or media frames running", async () => {
  history.replaceState(null, "", "/donate/");
  document.body.innerHTML = '<iframe title="Payment"></iframe>';
  install();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("keeps playing audio and video running", async () => {
  document.body.innerHTML = "<video></video>";
  vi.spyOn(document.querySelector("video")!, "paused", "get").mockReturnValue(false);
  install();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetchMock).not.toHaveBeenCalled();
});
it("protects edited forms outside the portal", async () => {
  history.replaceState(null, "", "/events/2026/conference/register/");
  install();
  document.dispatchEvent(new Event("input"));
  await vi.advanceTimersByTimeAsync(300_000);
  expect(fetchMock).not.toHaveBeenCalled();
});
