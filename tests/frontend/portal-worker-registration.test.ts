import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-service-worker?worker&url", () => ({
  default: "/_assets/portal-worker.js",
}));
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ordinary portal service worker registration", () => {
  it("shares one public module registration across startup, scanner preparation, and explicit push callers", async () => {
    const permission = vi.fn(),
      subscribe = vi.fn();
    const registration = { scope: "https://portal.invalid/portal/", pushManager: { subscribe } },
      register = vi.fn().mockResolvedValue(registration);
    vi.stubGlobal("navigator", { serviceWorker: { register }, permissions: { request: permission } });
    vi.stubGlobal("Notification", { requestPermission: permission });
    vi.stubGlobal("PushManager", { subscribe });
    const { registerPortalServiceWorker } =
      await import("../../assets/ts/member-flows/portal/portal-worker-registration");
    const first = registerPortalServiceWorker(),
      second = registerPortalServiceWorker();
    expect(first).toBe(second);
    expect(await first).toBe(registration);
    expect(await registerPortalServiceWorker()).toBe(registration);
    expect(register).toHaveBeenCalledExactlyOnceWith("/_assets/portal-worker.js", {
      scope: "/portal/",
      type: "module",
    });
    expect(permission).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });
  it("retries after a refused registration without poisoning later scanner preparation", async () => {
    const registration = {},
      register = vi.fn().mockRejectedValueOnce(new Error("Refused")).mockResolvedValueOnce(registration);
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    const { registerPortalServiceWorker } =
      await import("../../assets/ts/member-flows/portal/portal-worker-registration");
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
    const { registerPortalServiceWorker } =
      await import("../../assets/ts/member-flows/portal/portal-worker-registration");
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
    const { registerPortalServiceWorker } =
      await import("../../assets/ts/member-flows/portal/portal-worker-registration");
    expect(await registerPortalServiceWorker()).toBeNull();
  });
});
