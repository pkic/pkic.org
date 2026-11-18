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

it("names an icon control by its title and shows the hints inside a dialog", async () => {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<Scope />, host!));
  const full = host.querySelector<HTMLButtonElement>('button[data-tooltip="Full screen"]')!;
  expect(full.getAttribute("aria-label")).toBe("Full screen");
  // The title was its only name, so the tooltip adds no description that would say it twice.
  expect(full.hasAttribute("aria-description")).toBe(false);
  await act(() => pointer("pointerover", full.querySelector("svg")!));
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Full screen");
  expect(full.hasAttribute("aria-describedby")).toBe(false);
  const inDialog = host.querySelector<HTMLButtonElement>("dialog button")!;
  expect(inDialog.hasAttribute("title")).toBe(false);
  await act(() => pointer("pointerover", inDialog));
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Inside a dialog");
  expect(host.querySelectorAll("[title]")).toHaveLength(0);
});

it("covers a dialog or popover opened outside the scope, and nothing else on the page", async () => {
  host = document.createElement("div");
  document.body.append(host);
  const elsewhere = document.createElement("button");
  elsewhere.title = "Not part of the surface";
  document.body.append(elsewhere);
  await act(() => render(<Scope />, host!));
  // A confirmation mounts near the application root and a menu is a popover: neither stands inside the scope.
  const confirmation = document.createElement("dialog");
  confirmation.innerHTML = '<button type="button" aria-label="Close question" title="Close question">x</button>';
  const menu = document.createElement("div");
  menu.innerHTML = '<button type="button" role="menuitem" title="Takes it off the Projector.">Projector</button>';
  await act(async () => {
    document.body.append(confirmation, menu);
    menu.setAttribute("popover", "manual");
  });
  const close = confirmation.querySelector("button")!;
  const item = menu.querySelector("button")!;
  expect(close.hasAttribute("title")).toBe(false);
  expect(item.dataset.tooltip).toBe("Takes it off the Projector.");
  await act(() => pointer("pointerover", item));
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Takes it off the Projector.");
  // A title written later in an overlay is taken as well.
  await act(async () => {
    close.title = "Close question\nBack to the studio.";
  });
  expect(close.hasAttribute("title")).toBe(false);
  expect(close.getAttribute("aria-description")).toBe("Back to the studio.");
  expect(elsewhere.title).toBe("Not part of the surface");
  await act(() => pointer("pointerover", elsewhere));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  confirmation.remove();
  menu.remove();
  elsewhere.remove();
});

it("stands in the top layer as a popover, raised again each time it shows, so it draws above a dialog", async () => {
  const shows = vi.fn(function (this: HTMLElement) {
    this.dataset.open = "";
  });
  const hides = vi.fn(function (this: HTMLElement) {
    delete this.dataset.open;
  });
  const prototype = HTMLElement.prototype as unknown as Record<string, unknown>;
  prototype.showPopover = shows;
  prototype.hidePopover = hides;
  const matches = vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (this: HTMLElement, query) {
    return query === ":popover-open" ? "open" in this.dataset : Element.prototype.matches.call(this, query);
  });
  try {
    host = document.createElement("div");
    document.body.append(host);
    await act(() => render(<Scope />, host!));
    const reset = host.querySelector<HTMLButtonElement>('button[aria-label="Reset layout"]')!;
    await act(() => pointer("pointerover", reset));
    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
    expect(tooltip.getAttribute("popover")).toBe("manual");
    expect(shows).toHaveBeenCalledTimes(1);
    // Becoming a popover is not an overlay opening over the control: the tooltip stays.
    await act(async () => undefined);
    expect(document.querySelector('[role="tooltip"]')).toBe(tooltip);
    // The dialog's control is shown after the dialog opened: hidden and shown again, the tooltip is the newest on top.
    await act(() => pointer("pointerover", host!.querySelector("dialog button")!));
    expect(hides).toHaveBeenCalledTimes(1);
    expect(shows).toHaveBeenCalledTimes(2);
  } finally {
    matches.mockRestore();
    delete prototype.showPopover;
    delete prototype.hidePopover;
  }
});

/** A region with a hint of its own around controls, as a panel's header is. */
function Header({ hint = true }: { hint?: boolean }) {
  const scope = useRef<HTMLDivElement>(null);
  return (
    <div ref={scope}>
      <ControlTooltips scope={scope} />
      <header title={"Drag to move this panel\nIts menu moves it too."}>
        <span id="grip">Speakers</span>
        <button type="button" aria-label="Speakers panel">
          ⋯
        </button>
        <button
          type="button"
          aria-label="Reset layout"
          title={hint ? "Reset layout\nPut this workspace's panels back." : undefined}
        >
          R
        </button>
        <span id="name" title="Sam Speaker">
          Sam Speaker
        </span>
        <dialog open>
          <p id="body">Add a person</p>
        </dialog>
      </header>
    </div>
  );
}

it("says a hint once to assistive technology, and never lends a region's hint to a control inside it", async () => {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<Header />, host!));
  const reset = host.querySelector<HTMLButtonElement>('button[aria-label="Reset layout"]')!;
  // The first line repeats the name, so only what follows describes the control.
  expect(reset.getAttribute("aria-label")).toBe("Reset layout");
  expect(reset.getAttribute("aria-description")).toBe("Put this workspace's panels back.");
  await act(() => pointer("pointerover", reset));
  const tooltip = document.querySelector('[role="tooltip"]')!;
  expect(reset.getAttribute("aria-describedby")).toBe(`${tooltip.id}-more`);
  expect(document.getElementById(`${tooltip.id}-more`)?.textContent).toBe("Put this workspace's panels back.");
  // The header's hint is about the header: on its own text it shows, on the menu button inside it it does not.
  await act(() => pointer("pointerover", host!.querySelector("#grip")!));
  expect(document.querySelector('[role="tooltip"] .pk-control-tooltip__lead')?.textContent).toBe(
    "Drag to move this panel",
  );
  await act(() => pointer("pointerover", host!.querySelector('button[aria-label="Speakers panel"]')!));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  // Nor on a dialog a header action opened, which stands inside the header only in the document.
  await act(() => pointer("pointerover", host!.querySelector("#grip")!));
  await act(() => pointer("pointerover", host!.querySelector("#body")!));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  // A hint that only repeats the text on show is for a cut-off text; this one fits.
  const name = host.querySelector<HTMLElement>("#name")!;
  expect(name.hasAttribute("title")).toBe(false);
  expect(name.hasAttribute("aria-description")).toBe(false);
  await act(() => pointer("pointerover", name));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  // A control that stops writing a title loses its hint.
  await act(() => render(<Header hint={false} />, host!));
  expect(reset.hasAttribute("title")).toBe(false);
  expect(reset.dataset.tooltip).toBe("");
  expect(reset.hasAttribute("aria-description")).toBe(false);
  await act(() => pointer("pointerover", reset));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

it("opens for a mouse only: not for a touch, and not while a drag passes over", async () => {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<Scope />, host!));
  const reset = host.querySelector<HTMLButtonElement>('button[aria-label="Reset layout"]')!;
  const over = (init: Record<string, unknown>) => {
    const event = new MouseEvent("pointerover", { bubbles: true, ...init });
    Object.entries(init).forEach(([key, value]) => Object.defineProperty(event, key, { value }));
    reset.dispatchEvent(event);
  };
  await act(() => over({ pointerType: "touch" }));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(() => over({ buttons: 1 }));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(() => over({ pointerType: "mouse" }));
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
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
