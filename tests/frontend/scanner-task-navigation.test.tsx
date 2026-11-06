import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import {
  ScannerTaskNavigation,
  useScannerTaskLaunch,
} from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerTaskNavigation";
import { FastScannerView } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/FastScannerView";
import { useScannerPresentation } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useScannerPresentation";

const host = document.createElement("div");
document.body.append(host);
afterEach(async () => {
  await act(() => render(null, host));
});
const props = {
  pending: 0,
  message: "Ready",
  cameraActive: true,
  result: null,
  preview: false,
  onPreview: () => {},
  onExit: () => {},
};

const tasks = [
  { key: "entry" as const, label: "Entry", href: "#/events/example/scanner", action: "attendance" as const },
  { key: "exit" as const, label: "Exit", href: "#/events/example/scanner", action: "checkout" as const },
  { key: "print" as const, label: "Print", href: "#/events/example/scanner/print" },
];
const baseProps = { ...props, context: "Venue entrance" };
it.each(["embedded", "fullscreen"] as const)("supports task swipes only in full screen: %s", async (presentation) => {
  const onLaunch = vi.fn();
  await act(() =>
    render(
      <ScannerTaskNavigation.Provider value={{ launch: null, onLaunch, onConsumed: vi.fn(), tasks }}>
        <FastScannerView {...baseProps} presentation={presentation} />
      </ScannerTaskNavigation.Provider>,
      host,
    ),
  );
  const root = host.querySelector('[aria-label="Continuous badge scanner"]')!;
  await act(() => {
    root.dispatchEvent(new MouseEvent("pointerdown", { clientX: 250, clientY: 300, bubbles: true }));
    root.dispatchEvent(new MouseEvent("pointerup", { clientX: 80, clientY: 305, bubbles: true }));
  });
  if (presentation === "fullscreen") expect(onLaunch).toHaveBeenCalledWith("exit");
  else expect(onLaunch).not.toHaveBeenCalled();
  expect(Boolean(host.querySelector('[aria-label^="Swipe left"]'))).toBe(presentation === "fullscreen");
  expect(host.querySelector("a")).toBeNull();
});
it("supports keyboard switching, excludes unauthorized modes and refuses switches while printing", async () => {
  const onLaunch = vi.fn();
  const navigation = { launch: null, onLaunch, onConsumed: vi.fn(), tasks: [tasks[0]!, tasks[2]!] };
  const view = (busy: boolean) => (
    <ScannerTaskNavigation.Provider value={navigation}>
      <FastScannerView {...baseProps} purpose="print" taskSwitchDisabled={busy} />
    </ScannerTaskNavigation.Provider>
  );
  await act(() => render(view(true), host));
  const cue = () => host.querySelector('[aria-label^="Swipe left"]')!;
  await act(() => {
    cue().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  });
  expect(onLaunch).not.toHaveBeenCalled();
  await act(() => render(view(false), host));
  await act(() => {
    cue().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  });
  expect(onLaunch).toHaveBeenCalledWith("entry");
});
it("does not show switching without two authorized tasks", async () => {
  await act(() =>
    render(
      <ScannerTaskNavigation.Provider
        value={{ launch: null, onLaunch: vi.fn(), onConsumed: vi.fn(), tasks: [tasks[0]!] }}
      >
        <FastScannerView {...baseProps} />
      </ScannerTaskNavigation.Provider>,
      host,
    ),
  );
  expect(host.querySelector('[aria-label^="Swipe left"]')).toBeNull();
});
it("consumes a switch once and keeps print full screen after the launch request clears", async () => {
  const start = vi.fn();
  function Desk() {
    const shell = useRef<HTMLDivElement>(null);
    const { presentation } = useScannerPresentation(shell, "embedded");
    useScannerTaskLaunch("print", start);
    return (
      <div ref={shell}>
        <output>{presentation}</output>
      </div>
    );
  }
  function Owner() {
    const [launch, setLaunch] = useState<"print" | null>("print");
    return (
      <ScannerTaskNavigation.Provider value={{ launch, tasks, onLaunch: () => {}, onConsumed: () => setLaunch(null) }}>
        <Desk />
      </ScannerTaskNavigation.Provider>
    );
  }
  await act(() => render(<Owner />, host));
  expect(start).toHaveBeenCalledOnce();
  expect(host.querySelector("output")?.textContent).toBe("fullscreen");
});
