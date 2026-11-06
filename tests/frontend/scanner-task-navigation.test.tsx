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

import { useScannerAction } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/ScannerModeSelect";

const host = document.createElement("div");
document.body.append(host);
afterEach(async () => {
  await act(() => render(null, host));
  vi.unstubAllGlobals();
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
  if (presentation === "fullscreen") expect(onLaunch).toHaveBeenCalledWith("exit", "entry");
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
  expect(onLaunch).toHaveBeenCalledWith("entry", "print");
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

it.each([true, false])("uses the responsive print default and retains a manual override: mobile=%s", async (mobile) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  function Print() {
    const shell = useRef<HTMLDivElement>(null);
    const { presentation, setPresentation } = useScannerPresentation(shell, "responsive");
    return (
      <div ref={shell}>
        <output>{presentation}</output>
        <button onClick={() => setPresentation(mobile ? "embedded" : "fullscreen")}>Change view</button>
      </div>
    );
  }
  await act(() => render(<Print />, host));
  expect(host.querySelector("output")?.textContent).toBe(mobile ? "fullscreen" : "embedded");
  await act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  await act(() => render(<Print />, host));
  expect(host.querySelector("output")?.textContent).toBe(mobile ? "embedded" : "fullscreen");
});
it("carries the previous gradient orientation through scanner mounting", async () => {
  await act(() =>
    render(
      <ScannerTaskNavigation.Provider
        value={{ launch: "print", gradientFrom: "exit", tasks, onLaunch: vi.fn(), onConsumed: vi.fn() }}
      >
        <FastScannerView {...baseProps} purpose="print" />
      </ScannerTaskNavigation.Provider>,
      host,
    ),
  );
  const root = host.querySelector('[aria-label="Badge printing scanner"]')!;
  expect(root.getAttribute("data-gradient-from")).toBe("exit");
  await act(() => {
    const event = new Event("animationend", { bubbles: true });
    Object.assign(event, { animationName: "pk-scanner-field-turn" });
    root.dispatchEvent(event);
  });
  expect(root.hasAttribute("data-gradient-from")).toBe(false);
  expect(root.getAttribute("data-scanner-role")).toBe("print");
});

it("restores entry and exit from shared URL state without starting full screen", async () => {
  const path = "#/events/example/scanner";
  function Mode() {
    const [action, setAction] = useScannerAction(["attendance", "checkout"], undefined, false);
    return (
      <>
        <output>{action}</output>
        <button onClick={() => setAction("checkout")}>Exit task</button>
      </>
    );
  }
  window.location.hash = `${path}?scanAction=checkout`;
  await act(() => render(<Mode />, host));
  expect(host.querySelector("output")?.textContent).toBe("checkout");
  await act(() => {
    window.location.hash = path;
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(host.querySelector("output")?.textContent).toBe("attendance");
  await act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(window.location.hash).toContain("scanAction=checkout");
  await act(() => render(null, host));
  await act(() => render(<Mode />, host));
  expect(host.querySelector("output")?.textContent).toBe("checkout");
  await act(() => {
    window.location.hash = `${path}?scanAction=lead`;
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(host.querySelector("output")?.textContent).toBe("attendance");
});

it.each(["exception", "lead"])("rejects nonselectable URL mode %s even with broader permissions", async (requested) => {
  window.location.hash = `#/events/example/scanner?scanAction=${requested}`;
  function Mode() {
    const [action] = useScannerAction(["attendance", "check", "admission", "exception", "lead"], undefined, false);
    return <output>{action}</output>;
  }
  await act(() => render(<Mode />, host));
  expect(host.querySelector("output")?.textContent).toBe("attendance");
});
