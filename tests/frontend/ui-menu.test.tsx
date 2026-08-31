// @vitest-environment jsdom
/**
 * The Menu's keyboard contract and focus behaviour.
 *
 * A row menu is operated by keyboard far more than its appearance suggests,
 * and every one of these cases is a way it can strand a keyboard user: focus
 * that never enters the menu, focus that never comes back, or a menu that
 * cannot be dismissed.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { Menu, type MenuItem } from "../../assets/ts/ui/Menu";

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

function items(overrides: Partial<MenuItem>[] = []): MenuItem[] {
  const base: MenuItem[] = [
    { id: "open", label: "Open profile", onSelect: vi.fn() },
    { id: "resend", label: "Resend invitation", onSelect: vi.fn() },
    { id: "end", label: "End membership", onSelect: vi.fn(), danger: true },
  ];
  return base.map((item, index) => ({ ...item, ...(overrides[index] ?? {}) }));
}

function trigger(container: HTMLElement): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(".pk-menu__trigger");
  if (!found) throw new Error("no trigger rendered");
  return found;
}

function menuItems(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
}

function press(element: Element, key: string) {
  void act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("Menu", () => {
  it("announces itself as a closed menu button before it is opened", () => {
    const container = mount(<Menu label="Actions for Marit" items={items()} />);
    expect(trigger(container).getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger(container).getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it("opens on click and exposes the menu it controls", () => {
    const container = mount(<Menu label="Actions" items={items()} />);
    void act(() => trigger(container).click());
    expect(trigger(container).getAttribute("aria-expanded")).toBe("true");
    const menu = container.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(trigger(container).getAttribute("aria-controls")).toBe(menu?.id);
  });

  it("opens onto the first item with ArrowDown and the last with ArrowUp", () => {
    const down = mount(<Menu label="Actions" items={items()} />);
    press(trigger(down), "ArrowDown");
    expect(document.activeElement).toBe(menuItems(down)[0]);

    const up = mount(<Menu label="Actions" items={items()} />);
    press(trigger(up), "ArrowUp");
    const upItems = menuItems(up);
    expect(document.activeElement).toBe(upItems[upItems.length - 1]);
  });

  it("wraps around the ends rather than trapping focus at them", () => {
    const container = mount(<Menu label="Actions" items={items()} />);
    press(trigger(container), "ArrowDown");
    const rendered = menuItems(container);

    press(rendered[0], "ArrowUp");
    expect(document.activeElement).toBe(menuItems(container)[rendered.length - 1]);

    press(menuItems(container)[rendered.length - 1], "ArrowDown");
    expect(document.activeElement).toBe(menuItems(container)[0]);
  });

  it("jumps to the ends with Home and End", () => {
    const container = mount(<Menu label="Actions" items={items()} />);
    press(trigger(container), "ArrowDown");
    press(menuItems(container)[0], "End");
    expect(document.activeElement).toBe(menuItems(container)[2]);
    press(menuItems(container)[2], "Home");
    expect(document.activeElement).toBe(menuItems(container)[0]);
  });

  it("closes on Escape and gives focus back to the trigger", () => {
    const container = mount(<Menu label="Actions" items={items()} />);
    press(trigger(container), "ArrowDown");
    press(menuItems(container)[0], "Escape");
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger(container));
  });

  it("closes on Tab without stealing focus back, so tabbing continues forward", () => {
    const container = mount(<Menu label="Actions" items={items()} />);
    press(trigger(container), "ArrowDown");
    press(menuItems(container)[0], "Tab");
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).not.toBe(trigger(container));
  });

  it("runs the item's action and closes, returning focus to the trigger", () => {
    const onSelect = vi.fn();
    const container = mount(<Menu label="Actions" items={items([{ onSelect }])} />);
    void act(() => trigger(container).click());
    void act(() => menuItems(container)[0].click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger(container));
  });

  it("omits disabled items rather than offering focus to something inert", () => {
    const container = mount(<Menu label="Actions" items={items([{}, { disabled: true }])} />);
    void act(() => trigger(container).click());
    const labels = menuItems(container).map((item) => item.textContent);
    expect(labels).not.toContain("Resend invitation");
    expect(labels).toHaveLength(2);
  });

  it("closes when a pointer goes down outside it", () => {
    const container = mount(<Menu label="Actions" items={items()} />);
    void act(() => trigger(container).click());
    void act(() => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it("keeps exactly one item in the tab order, as a menu is one stop", () => {
    const container = mount(<Menu label="Actions" items={items()} />);
    press(trigger(container), "ArrowDown");
    const tabbable = menuItems(container).filter((item) => item.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
  });
});
