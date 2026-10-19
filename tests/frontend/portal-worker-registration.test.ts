// @vitest-environment jsdom
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-service-worker?worker&url", () => ({
  default: "/_assets/portal-worker.js",
}));
beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="portal-app"></div>';
  document.head.innerHTML = '<link rel="stylesheet" href="/_assets/portal-old.css">';
  document.getElementById("portal-app")!.dataset.portalBundleUrl = `${location.origin}/_assets/portal-old.js`;
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function capturedRegistrationModule() {
  const { capturePortalWorkerPageAssets } = await import("../../assets/ts/member-flows/portal/portal-worker-release");
  capturePortalWorkerPageAssets(document.getElementById("portal-app")!.dataset.portalBundleUrl!);
  return import("../../assets/ts/member-flows/portal/portal-worker-registration");
}

describe("ordinary portal service worker registration", () => {
  it("shares one public module registration across startup, scanner preparation, and explicit push callers", async () => {
    const permission = vi.fn(),
      subscribe = vi.fn();
    const registration = { scope: "https://portal.invalid/portal/", pushManager: { subscribe } },
      register = vi.fn().mockResolvedValue(registration);
    vi.stubGlobal("navigator", { serviceWorker: { register }, permissions: { request: permission } });
    vi.stubGlobal("Notification", { requestPermission: permission });
    vi.stubGlobal("PushManager", { subscribe });
    const { registerPortalServiceWorker } = await capturedRegistrationModule();
    const first = registerPortalServiceWorker(),
      second = registerPortalServiceWorker();
    expect(first).toBe(second);
    expect(await first).toBe(registration);
    expect(await registerPortalServiceWorker()).toBe(registration);
    const identity = [`${location.origin}/_assets/portal-old.js`, `${location.origin}/_assets/portal-old.css`]
      .sort()
      .join("\n");
    const digest = createHash("sha256").update(identity).digest("hex");
    expect(register).toHaveBeenCalledExactlyOnceWith(
      `${location.origin}/_assets/portal-worker.js?portalRelease=${digest}`,
      {
        scope: "/portal/",
        type: "module",
        updateViaCache: "none",
      },
    );
    expect(permission).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });
  it("retries after a refused registration without poisoning later scanner preparation", async () => {
    const registration = {},
      register = vi.fn().mockRejectedValueOnce(new Error("Refused")).mockResolvedValueOnce(registration);
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    const { registerPortalServiceWorker } = await capturedRegistrationModule();
    await expect(registerPortalServiceWorker()).rejects.toThrow("Refused");
    expect(await registerPortalServiceWorker()).toBe(registration);
    expect(register).toHaveBeenCalledTimes(2);
  });
  it("bounds a stalled registration and lets a later explicit preparation retry", async () => {
    vi.useFakeTimers();
    const register = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({});
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    const { registerPortalServiceWorker } = await capturedRegistrationModule();
    const refused = expect(registerPortalServiceWorker()).rejects.toThrow(
      "Portal offline files could not be prepared.",
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await refused;
    expect(vi.getTimerCount()).toBe(0);
    expect(await registerPortalServiceWorker()).not.toBeNull();
    expect(register).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps unsupported browsers usable without claiming prepared offline files", async () => {
    vi.stubGlobal("navigator", {});
    const { registerPortalServiceWorker } = await capturedRegistrationModule();
    expect(await registerPortalServiceWorker()).toBeNull();
  });
});

it.each(["module", "css"])(
  "changes the app release query for %s-only release while worker bytes URL stays fixed",
  async (changed) => {
    const register = vi.fn().mockResolvedValue({});
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    const first = await capturedRegistrationModule();
    await first.registerPortalServiceWorker();
    const oldUrl = new URL(register.mock.calls[0]![0]);
    if (changed === "module")
      document.getElementById("portal-app")!.dataset.portalBundleUrl = `${location.origin}/_assets/portal-new.js`;
    else document.querySelector("link")!.href = "/_assets/portal-new.css";
    vi.resetModules();
    const next = await capturedRegistrationModule();
    await next.registerPortalServiceWorker();
    const newUrl = new URL(register.mock.calls[1]![0]);
    expect(newUrl.pathname).toBe(oldUrl.pathname);
    expect(newUrl.searchParams.get("portalRelease")).not.toBe(oldUrl.searchParams.get("portalRelease"));
    expect(newUrl.searchParams.get("portalRelease")).toMatch(/^[a-f0-9]{64}$/);
  },
);

it.each([
  "https://outside.example/_assets/portal.js",
  "/_assets/portal.js?email=private",
  "/_assets/portal.js#private",
  "/api/v1/users/current",
])("refuses noncanonical entry identity %s without registering stale offline files", async (url) => {
  const register = vi.fn();
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  document.getElementById("portal-app")!.dataset.portalBundleUrl = url;
  const { registerPortalServiceWorker } = await capturedRegistrationModule();
  await expect(registerPortalServiceWorker()).rejects.toThrow("Portal offline release is unavailable");
  expect(register).not.toHaveBeenCalled();
});

it("keeps initial stylesheet identity stable when route CSS arrives before registration", async () => {
  const register = vi.fn().mockResolvedValue({});
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  const module = await capturedRegistrationModule();
  document.head.insertAdjacentHTML("beforeend", '<link rel="stylesheet" href="/_assets/route-lazy.css">');
  await module.registerPortalServiceWorker();
  const identity = [`${location.origin}/_assets/portal-old.js`, `${location.origin}/_assets/portal-old.css`]
    .sort()
    .join("\n");
  expect(new URL(register.mock.calls[0]![0]).searchParams.get("portalRelease")).toBe(
    createHash("sha256").update(identity).digest("hex"),
  );
});
