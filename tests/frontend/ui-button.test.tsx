// @vitest-environment jsdom
/**
 * Button behaviour that a visual specimen cannot show: what the control
 * exposes to assistive technology, and what it does while busy.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { Button } from "../../assets/ts/ui/Button";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

function buttonIn(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector("button");
  if (!button) throw new Error("no button rendered");
  return button;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

describe("Button", () => {
  it("defaults to a non-submitting button so it cannot post a form by accident", () => {
    expect(buttonIn(mount(<Button>Save</Button>)).type).toBe("button");
  });

  it("applies the variant and size as modifiers", () => {
    const button = buttonIn(
      mount(
        <Button variant="danger" size="sm">
          Remove
        </Button>,
      ),
    );
    expect(button.className).toContain("pk-btn--danger");
    expect(button.className).toContain("pk-btn--sm");
  });

  it("omits the size modifier at the default size", () => {
    expect(buttonIn(mount(<Button>Plain</Button>)).className).not.toContain("pk-btn--md");
  });

  it("stays focusable while loading, so the user is not thrown out of the form", () => {
    const button = buttonIn(mount(<Button loading>Saving</Button>));
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
  });

  it("does not fire its handler while loading", () => {
    const onClick = vi.fn();
    const button = buttonIn(
      mount(
        <Button loading onClick={onClick}>
          Saving
        </Button>,
      ),
    );
    void act(() => button.click());
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not fire its handler while disabled", () => {
    const onClick = vi.fn();
    const button = buttonIn(
      mount(
        <Button disabled onClick={onClick}>
          Save
        </Button>,
      ),
    );
    void act(() => button.click());
    expect(onClick).not.toHaveBeenCalled();
  });

  it("fires its handler when neither disabled nor loading", () => {
    const onClick = vi.fn();
    const button = buttonIn(mount(<Button onClick={onClick}>Save</Button>));
    void act(() => button.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders a spinner only while loading, hidden from the accessibility tree", () => {
    expect(mount(<Button>Idle</Button>).querySelector(".pk-btn__spinner")).toBeNull();
    const spinner = mount(<Button loading>Busy</Button>).querySelector(".pk-btn__spinner");
    expect(spinner).not.toBeNull();
    expect(spinner?.getAttribute("aria-hidden")).toBe("true");
  });
});
