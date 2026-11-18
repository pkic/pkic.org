// @vitest-environment jsdom
import { render } from "preact";
import { useRef } from "preact/hooks";
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

it("shows a control's title as a tooltip after a short hover, and hides it when the pointer leaves", async () => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<Scope />, host!));
  const reset = host.querySelector<HTMLButtonElement>('button[aria-label="Reset layout"]')!;
  await act(() => pointer("pointerover", reset));
  // The browser's own title is gone at once, so it never shows beside the tooltip.
  expect(reset.hasAttribute("title")).toBe(false);
  expect(reset.getAttribute("aria-description")).toBe("Put this workspace's panels back");
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(() => void vi.advanceTimersByTime(400));
  const tooltip = document.querySelector('[role="tooltip"]')!;
  expect(tooltip.textContent).toBe("Put this workspace's panels back");
  expect(reset.getAttribute("aria-describedby")).toBe(tooltip.id);
  await act(() => pointer("pointerout", reset, host!));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(reset.hasAttribute("aria-describedby")).toBe(false);
});

it("names an icon control by its title, and leaves titles in a dialog to the browser", async () => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<Scope />, host!));
  const full = [...host.querySelectorAll("button")].find((button) => button.title === "Full screen")!;
  await act(() => pointer("pointerover", full.querySelector("svg")!));
  expect(full.getAttribute("aria-label")).toBe("Full screen");
  const inDialog = host.querySelector<HTMLButtonElement>("dialog button")!;
  await act(() => pointer("pointerover", inDialog));
  await act(() => void vi.advanceTimersByTime(400));
  expect(inDialog.title).toBe("Inside a dialog");
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

it("closes the tooltip on Escape and when the control is pressed", async () => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<Scope />, host!));
  const reset = host.querySelector<HTMLButtonElement>('button[aria-label="Reset layout"]')!;
  await act(() => pointer("pointerover", reset));
  await act(() => void vi.advanceTimersByTime(400));
  await act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(() => pointer("pointerover", host!));
  await act(() => pointer("pointerover", reset));
  await act(() => void vi.advanceTimersByTime(400));
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  await act(() => pointer("pointerdown", reset));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});
