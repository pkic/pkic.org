// @vitest-environment jsdom
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { useScannerManualEntry } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerManualEntry";
import { useHashQueryParam } from "../../assets/ts/hooks/useHashQueryParam";
import { ScannerManualControls } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerCaptureControls";

let host: HTMLDivElement;
const capture = vi.fn();
afterEach(async () => {
  if (host) {
    await act(() => render(null, host));
    host.remove();
  }
  capture.mockClear();
});

function ManualEntry() {
  const [open, setOpen] = useState(false);
  const [focusRequested, setFocusRequested] = useState(false);
  const [badgeId, setBadge] = useState("");
  return (
    <form>
      <button type="button">Other control</button>
      <ScannerManualControls
        action="attendance"
        busy={false}
        ready
        onCapture={capture}
        open={open}
        onOpen={() => {
          setOpen(true);
          setFocusRequested(true);
        }}
        onClose={() => setOpen(false)}
        entry={{
          focusRequested,
          onFocusHandled: () => setFocusRequested(false),
          badgeId,
          onBadge: setBadge,
          field: {},
        }}
      />
    </form>
  );
}

it("opens the actual manual dialog, focuses its input and retains controlled input across close and reopen", async () => {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<ManualEntry />, host));
  const dialog = host.querySelector<HTMLDialogElement>("dialog")!;
  Object.defineProperty(dialog, "close", { configurable: true, value: () => dialog.removeAttribute("open") });
  const enter = Array.from(host.querySelectorAll("button")).find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent?.trim()) === "Find attendee or badge",
  )!;
  expect(dialog.open).toBe(false);
  expect(host.querySelector('input[name="badgeId"]')).toBeNull();
  expect(host.querySelector("details, summary")).toBeNull();
  await act(() => enter.click());
  const input = host.querySelector<HTMLInputElement>('input[name="badgeId"]')!;
  expect(dialog.open).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(dialog.querySelector("label")?.textContent).toContain("Badge code");
  const badgeId = "abcd-efgh-jklm-npqr";
  await act(() => {
    input.value = badgeId;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(input.value).toBe(badgeId);
  expect(host.textContent).toContain("Spaces and hyphens are optional.");
  expect(host.textContent).not.toContain("credential reference");
  expect(dialog.querySelector(".pk-dialog__body button")).toBeNull();
  const confirm = dialog.querySelector<HTMLButtonElement>(".pk-dialog__foot .pk-btn--primary")!;
  expect(confirm.textContent).toBe("Record attendance");
  expect(dialog.textContent).not.toContain("Done");
  await act(() => confirm.click());
  expect(capture).toHaveBeenCalledOnce();
  expect(dialog.open).toBe(true);
  await act(() =>
    Array.from(dialog.querySelectorAll("button"))
      .find((button) => button.textContent === "Cancel")!
      .click(),
  );
  expect(dialog.open).toBe(false);
  expect(host.querySelector('input[name="badgeId"]')).toBeNull();
  await act(() => enter.click());
  const reopened = host.querySelector<HTMLInputElement>('input[name="badgeId"]')!;
  expect(document.activeElement).toBe(reopened);
  expect(reopened.value).toBe(badgeId);
});

it.each([false, true])(
  "restores capture on history return while preserving manual entry: manual=%s",
  async (manualOpen) => {
    host = document.createElement("div");
    document.body.append(host);
    const pause = vi.fn(),
      resume = vi.fn();
    let controls!: ReturnType<typeof useScannerManualEntry>;
    function Scanner() {
      const [tab] = useHashQueryParam("scannerTab", "scan", ["scan", "recent"]);
      controls = useScannerManualEntry(true, pause, resume, tab === "recent");
      return null;
    }
    window.location.hash = "#/events/example/scanner";
    await act(() => render(<Scanner />, host));
    await act(() => {
      window.location.hash = "#/events/example/scanner?scannerTab=recent";
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(controls.paused.current).toBe(true);
    if (manualOpen) await act(() => controls.setOpen(true));
    await act(() => {
      window.location.hash = "#/events/example/scanner";
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(controls.paused.current).toBe(manualOpen);
    expect(resume).toHaveBeenCalledTimes(manualOpen ? 0 : 1);
  },
);
