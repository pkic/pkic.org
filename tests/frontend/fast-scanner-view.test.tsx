// @vitest-environment jsdom
import { render } from "preact-render-to-string";
import { describe, it, expect, vi, afterEach } from "vitest";
import { FastScannerView } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/FastScannerView";
import {
  enterScannerFullscreen,
  scannerImmersiveLifecycle,
} from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/immersive-scanner";
import { eventScanResponseSchema } from "../../assets/shared/schemas/event-participation-scanning";

const props = {
  context: "Main hall · Session admission",
  pending: 0,
  message: "Ready",
  cameraActive: true,
  preview: false,
  onPreview: () => {},
  onExit: () => {},
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("continuous scanner presentation", () => {
  it("shows screen-awake status only after a granted wake lock and releases it on exit", async () => {
    const lock = Object.assign(new EventTarget(), { released: false, release: vi.fn(async () => {}) });
    const request = vi.fn(async () => lock);
    vi.stubGlobal("navigator", { wakeLock: { request } });
    const awake = vi.fn();
    const release = scannerImmersiveLifecycle(document.createElement("div"), () => {}, awake);
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith("screen");
    expect(awake).toHaveBeenLastCalledWith(true);
    release();
    expect(awake).toHaveBeenLastCalledWith(false);
    expect(lock.release).toHaveBeenCalledOnce();
    expect(render(<FastScannerView {...props} result={null} screenAwake />)).toContain("Screen awake");
  });
  it("does not promise to keep the screen awake when the browser denies the request", async () => {
    vi.stubGlobal("navigator", {
      wakeLock: {
        request: async () => {
          throw new Error("Denied");
        },
      },
    });
    const awake = vi.fn();
    const release = scannerImmersiveLifecycle(document.createElement("div"), () => {}, awake);
    await Promise.resolve();
    expect(awake).not.toHaveBeenCalledWith(true);
    release();
    expect(render(<FastScannerView {...props} result={null} />)).toContain("Screen may turn off");
  });
  it("releases the wake lock immediately when the scanner becomes hidden", async () => {
    const lock = Object.assign(new EventTarget(), { released: false, release: vi.fn(async () => {}) });
    vi.stubGlobal("navigator", { wakeLock: { request: async () => lock } });
    const exit = vi.fn();
    const release = scannerImmersiveLifecycle(document.createElement("div"), exit);
    await Promise.resolve();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(exit).toHaveBeenCalledOnce();
    expect(lock.release).toHaveBeenCalledOnce();
    release();
  });
  it("uses shared SVG status icons and exposes a next-badge countdown with a skip control", () => {
    const html = render(
      <FastScannerView
        {...props}
        result={null}
        cooldown={{ durationMs: 600, remainingMs: 400, saving: false, skip: () => {} }}
      />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("PKI Consortium");
    expect(html).toContain("Next badge in 0.4 seconds");
    expect(html).toContain("Scan next now");
    expect(html).toContain("<progress");
    expect(html).not.toContain("○");
  });
  it("never claims uploads are complete while scans remain pending", () => {
    const html = render(
      <FastScannerView {...props} pending={3} result={null} uploadStatus="All pending scans uploaded." />,
    );
    expect(html).not.toContain("All pending scans uploaded.");
    expect(html).toContain("Uploading scans in the background");
  });
  it("keeps an unacknowledged scan neutral and hides setup and personal data", () => {
    const html = render(<FastScannerView {...props} pending={3} result={null} />);
    expect(html).toContain("Verification pending");
    expect(html).toContain("3 pending");
    expect(html).toContain("pk-fast-scanner--unverified");
    expect(html).not.toContain("pk-fast-scanner--eligible");
    expect(html).not.toContain("Badge code");
    expect(html).not.toContain("Scan mode");
  });
  it.each([
    ["eligible", "Eligibility verified"],
    ["denied", "Do not admit"],
    ["unknown", "Unknown badge"],
    ["warning", "Registration required"],
  ] as const)("renders %s as a distinct result", (outcome, label) => {
    const result = eventScanResponseSchema.parse({
      operationId: "00000000-0000-4000-8000-000000000001",
      outcome,
      reason: outcome === "eligible" ? "eligible" : "unknown_credential",
      recorded: true,
      attendanceRecorded: false,
    });
    const html = render(<FastScannerView {...props} result={result} />);
    expect(html).toContain(label);
    expect(html).toContain(`pk-fast-scanner--${outcome}`);
  });
  it("works without native fullscreen and releases the immersive lifecycle on exit", () => {
    const element = document.createElement("div");
    const exit = vi.fn();
    enterScannerFullscreen(element);
    const release = scannerImmersiveLifecycle(element, exit);
    expect(document.body.classList.contains("pk-scanner-immersive")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(exit).toHaveBeenCalledOnce();
    release();
    expect(document.body.classList.contains("pk-scanner-immersive")).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(exit).toHaveBeenCalledOnce();
  });
});
