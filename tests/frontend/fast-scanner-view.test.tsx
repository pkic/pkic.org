// @vitest-environment jsdom
import { render } from "preact-render-to-string";
import { describe, it, expect, vi } from "vitest";
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
describe("continuous scanner presentation", () => {
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
