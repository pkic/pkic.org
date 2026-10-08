import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const modules = vi.hoisted(() => ({
  mainLoaded: vi.fn(),
  fallbackLoaded: vi.fn(),
  prepareView: vi.fn<() => Promise<unknown>>(),
  createWorker: vi.fn(),
}));
let serviceWorkers: EventTarget & { controller: object | null; ready: Promise<object> };
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doMock("qr-scanner", () => {
    modules.mainLoaded();
    return { default: class {} };
  });
  vi.doMock("qr-scanner/qr-scanner-worker.min.js", () => {
    modules.fallbackLoaded();
    return { createWorker: modules.createWorker };
  });

  modules.prepareView.mockResolvedValue({});
  serviceWorkers = Object.assign(new EventTarget(), { controller: null as object | null, ready: Promise.resolve({}) });
  vi.stubGlobal("navigator", { serviceWorker: serviceWorkers });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("offline camera decoder preparation", () => {
  it("warms the fallback even with native QR detection, only after service worker control", async () => {
    vi.stubGlobal("BarcodeDetector", class {});
    const { prepareScannerDecoder } =
      await import("../../assets/ts/member-flows/portal/sections/events/detail/scanner/prepareScannerDecoder");
    const preparation = prepareScannerDecoder(new AbortController().signal, modules.prepareView);
    await Promise.resolve();
    expect(modules.mainLoaded).not.toHaveBeenCalled();
    expect(modules.fallbackLoaded).not.toHaveBeenCalled();
    expect(modules.prepareView).not.toHaveBeenCalled();
    serviceWorkers.controller = {};
    serviceWorkers.dispatchEvent(new Event("controllerchange"));
    expect(await preparation).toBe(true);
    expect(modules.mainLoaded).toHaveBeenCalledOnce();
    expect(modules.fallbackLoaded).toHaveBeenCalledOnce();
    expect(modules.prepareView).toHaveBeenCalledOnce();
    expect(modules.createWorker).not.toHaveBeenCalled();
  });
  it("warms both modules immediately when the scanner is already controlled", async () => {
    serviceWorkers.controller = {};
    const { prepareScannerDecoder } =
      await import("../../assets/ts/member-flows/portal/sections/events/detail/scanner/prepareScannerDecoder");
    expect(await prepareScannerDecoder(new AbortController().signal)).toBe(true);
    expect(modules.mainLoaded).toHaveBeenCalledOnce();
    expect(modules.fallbackLoaded).toHaveBeenCalledOnce();
    expect(modules.prepareView).not.toHaveBeenCalled();
  });
  it("cancels an unmounted scanner without importing modules or retaining the controller listener", async () => {
    const remove = vi.spyOn(serviceWorkers, "removeEventListener");
    const { prepareScannerDecoder } =
      await import("../../assets/ts/member-flows/portal/sections/events/detail/scanner/prepareScannerDecoder");
    const controller = new AbortController();
    const preparation = prepareScannerDecoder(controller.signal, modules.prepareView);
    controller.abort();
    expect(await preparation).toBe(false);
    expect(remove).toHaveBeenCalledWith("controllerchange", expect.any(Function));
    serviceWorkers.controller = {};
    serviceWorkers.dispatchEvent(new Event("controllerchange"));
    expect(modules.mainLoaded).not.toHaveBeenCalled();
    expect(modules.fallbackLoaded).not.toHaveBeenCalled();
    expect(modules.prepareView).not.toHaveBeenCalled();
  });
  it("bounds a stalled controller wait and removes its listener", async () => {
    vi.useFakeTimers();
    const remove = vi.spyOn(serviceWorkers, "removeEventListener");
    const { prepareScannerDecoder } =
      await import("../../assets/ts/member-flows/portal/sections/events/detail/scanner/prepareScannerDecoder");
    const preparation = prepareScannerDecoder(new AbortController().signal, modules.prepareView);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await preparation).toBe(false);
    expect(remove).toHaveBeenCalledWith("controllerchange", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    expect(modules.fallbackLoaded).not.toHaveBeenCalled();
    expect(modules.prepareView).not.toHaveBeenCalled();
  });
  it("keeps a stalled caller-owned view load within the original preparation deadline", async () => {
    vi.useFakeTimers();
    serviceWorkers.controller = {};
    modules.prepareView.mockImplementation(() => new Promise(() => {}));
    const { prepareScannerDecoder } =
      await import("../../assets/ts/member-flows/portal/sections/events/detail/scanner/prepareScannerDecoder");
    const preparation = prepareScannerDecoder(new AbortController().signal, modules.prepareView);
    await vi.advanceTimersByTimeAsync(10000);
    expect(modules.prepareView).toHaveBeenCalledOnce();
    expect(await preparation).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("refuses a failed caller-owned view load", async () => {
    serviceWorkers.controller = {};
    modules.prepareView.mockRejectedValue(new Error("Public UI code unavailable"));
    const { prepareScannerDecoder } =
      await import("../../assets/ts/member-flows/portal/sections/events/detail/scanner/prepareScannerDecoder");
    await expect(prepareScannerDecoder(new AbortController().signal, modules.prepareView)).rejects.toThrow(
      "Public UI code unavailable",
    );
    expect(modules.createWorker).not.toHaveBeenCalled();
  });
  it("does not claim prepared offline modules on a browser without service workers", async () => {
    vi.stubGlobal("navigator", {});
    const { prepareScannerDecoder } =
      await import("../../assets/ts/member-flows/portal/sections/events/detail/scanner/prepareScannerDecoder");
    expect(await prepareScannerDecoder(new AbortController().signal)).toBe(false);
    expect(modules.mainLoaded).not.toHaveBeenCalled();
  });
});
