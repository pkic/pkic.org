// @vitest-environment jsdom
import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { ControlTooltips } from "../../assets/ts/ui/ControlTooltips";

let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (host) {
    await act(() => render(null, host!));
    host.remove();
    host = undefined;
  }
  vi.useRealTimers();
});

function Scope() {
  const scope = useRef<HTMLDivElement>(null);
  return (
    <div ref={scope}>
      <ControlTooltips scope={scope} />
      <button type="button" aria-label="Reset layout" title="Put this workspace's panels back">
        R
      </button>
      <button type="button" title="Full screen">
        <svg />
      </button>
      <dialog open>
        <button type="button" title="Inside a dialog">
          D
        </button>
      </dialog>
    </div>
  );
}

const pointer = (type: string, target: Element, related: Element | null = null) => {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget: related });
  target.dispatchEvent(event);
};

it("takes every title as it is written, so the browser's own never shows, and shows the tooltip at once on hover", async () => {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<Scope />, host!));
  const reset = host.querySelector<HTMLButtonElement>('button[aria-label="Reset layout"]')!;
  // Taken on mount, before any hover: a disabled control or a slow pointer never meets the browser's title.
  expect(reset.hasAttribute("title")).toBe(false);
  expect(reset.dataset.tooltip).toBe("Put this workspace's panels back");
  expect(reset.getAttribute("aria-description")).toBe("Put this workspace's panels back");
  await act(() => pointer("pointerover", reset));
  const tooltip = document.querySelector('[role="tooltip"]')!;
  expect(tooltip.textContent).toBe("Put this workspace's panels back");
  expect(reset.getAttribute("aria-describedby")).toBe(tooltip.id);
  await act(() => pointer("pointerout", reset, host!));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(reset.hasAttribute("aria-describedby")).toBe(false);
});

it("names an icon control by its title, and leaves titles in a dialog to the browser", async () => {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<Scope />, host!));
  const full = host.querySelector<HTMLButtonElement>('button[data-tooltip="Full screen"]')!;
  expect(full.getAttribute("aria-label")).toBe("Full screen");
  await act(() => pointer("pointerover", full.querySelector("svg")!));
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Full screen");
  const inDialog = host.querySelector<HTMLButtonElement>("dialog button")!;
  await act(() => pointer("pointerover", inDialog));
  expect(inDialog.title).toBe("Inside a dialog");
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

it("closes the tooltip on Escape and when the control is pressed", async () => {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<Scope />, host!));
  const reset = host.querySelector<HTMLButtonElement>('button[aria-label="Reset layout"]')!;
  await act(() => pointer("pointerover", reset));
  await act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(() => pointer("pointerover", host!));
  await act(() => pointer("pointerover", reset));
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  await act(() => pointer("pointerdown", reset));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

/** A control whose state, and so its hint, changes while it is pointed at. */
function OnAir() {
  const scope = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  return (
    <div ref={scope}>
      <ControlTooltips scope={scope} />
      <button
        type="button"
        aria-label="Show Up next on air"
        title={on ? "On air · covered by Question\nQuestion is drawn over it." : "Off air\nClick to put it on air now."}
        onClick={() => setOn(!on)}
      >
        PGM
      </button>
    </div>
  );
}

it("leads with the control's state and follows it as the control writes a new title", async () => {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<OnAir />, host!));
  const button = host.querySelector("button")!;
  await act(() => pointer("pointerover", button));
  const lead = () => document.querySelector('[role="tooltip"] .pk-control-tooltip__lead')?.textContent;
  expect(lead()).toBe("Off air");
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Off airClick to put it on air now.");
  await act(() => button.click());
  // Pressing hides it; pointing again shows the new state, and a change while shown replaces the words in place.
  await act(() => pointer("pointerover", host!));
  await act(() => pointer("pointerover", button));
  expect(lead()).toBe("On air · covered by Question");
  expect(button.hasAttribute("title")).toBe(false);
  expect(button.getAttribute("aria-description")).toBe("On air · covered by Question. Question is drawn over it.");
  await act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => undefined);
  expect(button.dataset.tooltip).toBe("Off air\nClick to put it on air now.");
  expect(lead()).toBe("Off air");
});

it("shows the tooltip on keyboard focus without a delay", async () => {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<Scope />, host!));
  const reset = host.querySelector<HTMLButtonElement>('button[aria-label="Reset layout"]')!;
  const matches = vi.spyOn(reset, "matches").mockImplementation((selector) => selector === ":focus-visible");
  await act(() => reset.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Put this workspace's panels back");
  matches.mockRestore();
});
