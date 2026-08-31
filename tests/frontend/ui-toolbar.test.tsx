// @vitest-environment jsdom
/**
 * Toolbar and BulkBar behaviour that visual specs cannot show: accessible names,
 * event handlers, state transitions, and structural constraints.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { Toolbar } from "../../assets/ts/ui/Toolbar";
import { BulkBar } from "../../assets/ts/ui/BulkBar";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

describe("Toolbar", () => {
  it("exposes role='toolbar' with its accessible name", () => {
    const container = mount(<Toolbar label="List controls" />);
    const toolbar = container.querySelector('[role="toolbar"]') as HTMLElement;
    expect(toolbar).not.toBeNull();
    expect(toolbar.getAttribute("aria-label")).toBe("List controls");
  });

  it("renders a search input with an accessible name via visually-hidden label", () => {
    const container = mount(
      <Toolbar label="List controls" search={{ value: "", placeholder: "Find items", onInput: () => {} }} />,
    );
    const label = container.querySelector("label") as HTMLLabelElement;
    const input = container.querySelector('input[type="search"]') as HTMLInputElement;

    expect(label).not.toBeNull();
    expect(label.textContent).toBe("Search");
    expect(input).not.toBeNull();
    expect(input.id).toBeTruthy();
    expect(label.getAttribute("for")).toBe(input.id);
  });

  it("fires onInput with the typed value", () => {
    const onInput = vi.fn();
    const container = mount(
      <Toolbar label="List controls" search={{ value: "", placeholder: "Find items", onInput }} />,
    );
    const input = container.querySelector('input[type="search"]') as HTMLInputElement;

    void act(() => {
      input.value = "test query";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onInput).toHaveBeenCalledWith("test query");
  });

  it("does not nest buttons inside buttons", () => {
    const container = mount(
      <Toolbar label="List controls">
        <button>Action 1</button>
        <button>Action 2</button>
      </Toolbar>,
    );

    const buttons = container.querySelectorAll("button");
    for (const button of buttons) {
      const parentButton = button.closest("button:not(:scope)");
      expect(parentButton).toBeNull();
    }
  });
});

describe("BulkBar", () => {
  it("renders nothing when count is 0", () => {
    const container = mount(<BulkBar count={0} total={42} onClear={() => {}} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("exposes role='status' for announcement", () => {
    const container = mount(<BulkBar count={2} total={42} onClear={() => {}} />);
    const status = container.querySelector('[role="status"]') as HTMLElement;
    expect(status).not.toBeNull();
  });

  it("displays the selection count with both numbers", () => {
    const container = mount(<BulkBar count={5} total={100} onClear={() => {}} />);
    const text = container.textContent;
    expect(text).toContain("5 of 100 selected");
  });

  it("fires onClear when the clear button is clicked", () => {
    const onClear = vi.fn();
    const container = mount(<BulkBar count={3} total={42} onClear={onClear} />);
    const clearButton = container.querySelector("button") as HTMLButtonElement;
    expect(clearButton.textContent).toContain("Clear selection");

    void act(() => clearButton.click());

    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("does not nest buttons inside buttons", () => {
    const container = mount(
      <BulkBar count={2} total={42} onClear={() => {}}>
        <button>Bulk action</button>
      </BulkBar>,
    );

    const buttons = container.querySelectorAll("button");
    for (const button of buttons) {
      const parentButton = button.closest("button:not(:scope)");
      expect(parentButton).toBeNull();
    }
  });
});
