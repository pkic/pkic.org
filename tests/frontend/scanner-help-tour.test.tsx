import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FastScannerView } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/FastScannerView";
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
});
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => (item.getAttribute("aria-label") ?? item.textContent?.trim()) === label,
  );
  expect(button).toBeTruthy();
  await act(async () => {
    button!.click();
  });
}
const base = {
  context: "Labels",
  result: null,
  pending: 0,
  message: "",
  cameraActive: false,
  preview: false,
  onPreview: () => {},
  onExit: () => {},
  onManual: () => {},
  onCameraRetry: () => {},
};
it("teaches print outcomes and real sound profiles without creating scan history or requiring a live print", async () => {
  const pause = vi.fn(),
    sound = vi.fn();
  await act(() =>
    render(
      <FastScannerView
        {...base}
        purpose="print"
        onOperatorPause={pause}
        onTourSound={sound}
        statusActions={<button>Print again</button>}
      />,
      host,
    ),
  );
  await click("Scanner help");
  expect(pause).toHaveBeenLastCalledWith(true);
  expect(document.querySelector("[data-tour-active]")).not.toBeNull();
  expect(host.textContent).not.toContain("Print again");
  for (let i = 0; i < 3; i++) await click("Next");
  expect(host.querySelector(".pk-fast-scanner--eligible")?.textContent).toContain("Example: Print requested");
  expect(sound).toHaveBeenLastCalledWith("print");
  await click("Replay sound");
  expect(sound).toHaveBeenLastCalledWith("print");
  await click("Next");
  expect(host.querySelector(".pk-fast-scanner--warning")).not.toBeNull();
  expect(sound).toHaveBeenLastCalledWith("warning");
  await click("Next");
  expect(host.querySelector(".pk-fast-scanner--denied")).not.toBeNull();
  expect(sound).toHaveBeenLastCalledWith("error");
  expect(host.querySelectorAll(".pk-fast-scanner__trail li")).toHaveLength(0);
  await click("Close help tour");
  expect(pause).toHaveBeenLastCalledWith(false);
  expect(host.textContent).not.toContain("Example:");
  expect(host.textContent).toContain("Print again");
  expect(document.querySelector("[data-tour-active]")).toBeNull();
});
it.each(["attendance", "checkout", "lead"] as const)(
  "shows role-specific help for %s and Escape closes only the tour",
  async (mode) => {
    const exit = vi.fn();
    await act(() => render(<FastScannerView {...base} mode={mode} onExit={exit} />, host));
    await click("Scanner help");
    const popup = document.querySelector(".pk-guided-tour")!;
    expect(popup.textContent).toContain(mode === "lead" ? "permission" : mode === "checkout" ? "exit" : "entry");
    await act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector(".pk-guided-tour")).toBeNull();
    expect(exit).not.toHaveBeenCalled();
  },
);
