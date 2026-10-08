// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, it, expect, vi } from "vitest";
import { FastScannerView } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/FastScannerView";
import { scannerSwipeDirection } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-gestures";
const host = document.createElement("div");
document.body.append(host);
const props = {
  context: "Event scope synthetic",
  result: null,
  pending: 3,
  message: "Verification pending",
  cameraActive: true,
  preview: false,
  onPreview: () => {},
  onExit: () => {},
  screenAwake: true,
};
afterEach(async () => {
  await act(() => render(null, host));
  vi.restoreAllMocks();
});
describe("attendee-facing scanner and operator drawer", () => {
  it("keeps all operational detail in a closed drawer and exposes semantic status to screen readers", async () => {
    await act(async () => render(<FastScannerView {...props} />, host));
    const drawer = host.querySelector<HTMLElement>('[aria-label="Scanner operator controls"]')!;
    expect(drawer.hidden).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Verification pending");
    expect(host.querySelector(".pk-fast-scanner__stage")?.textContent).toContain(props.context);
    expect(host.querySelector(".pk-fast-scanner__stage")?.textContent).not.toContain("3 pending");
  });
  it("opens on the operator button, traps focus and closes with Escape without exiting scanning", async () => {
    const exit = vi.fn();
    await act(async () => render(<FastScannerView {...props} onExit={exit} />, host));
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Operator controls"]')!;
    await act(async () => trigger.click());
    const drawer = host.querySelector<HTMLElement>('[aria-label="Scanner operator controls"]')!;
    expect(drawer.hidden).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(drawer.textContent).toContain("3 pending");
    const controls = drawer.querySelectorAll<HTMLButtonElement>("button");
    controls[controls.length - 1].focus();
    await act(async () => {
      drawer.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(controls[0]);
    await act(async () => {
      drawer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(drawer.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(exit).not.toHaveBeenCalled();
  });
  it("opens and closes by vertical swipe and keeps skip available as a discreet control", async () => {
    const skip = vi.fn();
    await act(async () =>
      render(
        <FastScannerView {...props} cooldown={{ durationMs: 600, remainingMs: 300, saving: false, skip }} />,
        host,
      ),
    );
    const surface = host.querySelector<HTMLElement>('[aria-label="Continuous badge scanner"]')!;
    await act(async () => {
      surface.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 600, bubbles: true }));
      surface.dispatchEvent(new MouseEvent("pointerup", { clientX: 110, clientY: 450, bubbles: true }));
    });
    const drawer = host.querySelector<HTMLElement>('[aria-label="Scanner operator controls"]')!;
    expect(drawer.hidden).toBe(false);
    await act(async () => {
      drawer.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 400, bubbles: true }));
      drawer.dispatchEvent(new MouseEvent("pointerup", { clientX: 100, clientY: 550, bubbles: true }));
    });
    expect(drawer.hidden).toBe(false);
    await act(async () => {
      surface.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100, clientY: 400, bubbles: true }));
      surface.dispatchEvent(new MouseEvent("pointerup", { clientX: 110, clientY: 550, bubbles: true }));
    });
    expect(drawer.hidden).toBe(true);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('.pk-fast-scanner__stage [aria-label="Scan next now"]')!.click(),
    );
    expect(skip).toHaveBeenCalledOnce();
    expect(scannerSwipeDirection({ x: 0, y: 0 }, { x: 120, y: -50 })).toBeNull();
  });
  it("contains keyboard focus on the scanning surface and restores focus on exit", async () => {
    const previous = document.createElement("button");
    document.body.append(previous);
    previous.focus();
    await act(async () => render(<FastScannerView {...props} />, host));
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Operator controls"]')!;
    expect(document.activeElement).toBe(trigger);
    const stage = host.querySelector<HTMLElement>(".pk-fast-scanner__stage")!;
    const controls = [...stage.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
    const first = controls[0]!,
      last = controls.at(-1)!;
    expect(first.textContent).toBe("Show preview");
    expect(last).toBe(trigger);
    for (const [start, target, shiftKey] of [
      [last, first, false],
      [first, last, true],
    ] as const) {
      start.focus();
      const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
      start.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(target);
      expect(stage.contains(document.activeElement)).toBe(true);
    }
    await act(async () => render(null, host));
    expect(document.activeElement).toBe(previous);
    previous.remove();
  });
});
