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

  it("shows a disabled item rather than hiding it, so the menu keeps its shape", () => {
    const container = mount(<Menu label="Actions" items={items([{}, { disabled: true }])} />);
    void act(() => trigger(container).click());
    const rendered = menuItems(container);
    expect(rendered.map((item) => item.textContent)).toContain("Resend invitation");
    expect(rendered[1].disabled).toBe(true);
  });

  it("steps over a disabled item instead of parking focus on something inert", () => {
    const container = mount(<Menu label="Actions" items={items([{}, { disabled: true }])} />);
    press(trigger(container), "ArrowDown");
    expect(document.activeElement).toBe(menuItems(container)[0]);
    press(menuItems(container)[0], "ArrowDown");
    expect(document.activeElement).toBe(menuItems(container)[2]);
  });

  it("does not run a disabled item's action if it is somehow clicked", () => {
    const onSelect = vi.fn();
    const container = mount(<Menu label="Actions" items={items([{}, { disabled: true, onSelect }])} />);
    void act(() => trigger(container).click());
    void act(() => menuItems(container)[1].click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens onto the last ENABLED item with ArrowUp, not the last rendered one", () => {
    const container = mount(<Menu label="Actions" items={items([{}, {}, { disabled: true }])} />);
    press(trigger(container), "ArrowUp");
    expect(document.activeElement).toBe(menuItems(container)[1]);
  });

  /*
   * Placement. jsdom reports every rect as zero, so each case stubs the two
   * measurements the component actually reads — the trigger's rect and the
   * popup's own size — and asserts the geometry it writes back. That is the
   * part that has broken on real screens; the rest is the browser's job.
   */
  describe("placement", () => {
    function withRects(triggerRect: Partial<DOMRect>, popupSize: { width: number; height: number }) {
      const original = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (this: Element) {
        const isPopup = this.getAttribute("role") === "menu";
        const box = isPopup
          ? { top: 0, left: 0, right: popupSize.width, bottom: popupSize.height, ...popupSize }
          : { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...triggerRect };
        return { ...box, x: box.left, y: box.top, toJSON: () => box } as DOMRect;
      };
      return () => {
        Element.prototype.getBoundingClientRect = original;
      };
    }

    function popup(container: HTMLElement): HTMLElement {
      const found = container.querySelector<HTMLElement>('[role="menu"]');
      if (!found) throw new Error("menu is not open");
      return found;
    }

    it("hangs below the trigger when there is room", () => {
      const restore = withRects({ top: 100, bottom: 130, left: 40, right: 70, width: 30 }, { width: 200, height: 150 });
      try {
        const container = mount(<Menu label="Actions" items={items()} />);
        void act(() => trigger(container).click());
        expect(popup(container).style.top).toBe("134px");
        expect(popup(container).style.left).toBe("40px");
      } finally {
        restore();
      }
    });

    it("flips above the trigger in the last row of a table, where below would fall off", () => {
      // jsdom's viewport is 768 tall. A trigger at 700 leaves no room below.
      const restore = withRects({ top: 700, bottom: 730, left: 40, right: 70, width: 30 }, { width: 200, height: 150 });
      try {
        const container = mount(<Menu label="Actions" items={items()} />);
        void act(() => trigger(container).click());
        expect(popup(container).style.top).toBe(`${700 - 4 - 150}px`);
      } finally {
        restore();
      }
    });

    it("stays below when flipping would land it in an even smaller gap", () => {
      const restore = withRects({ top: 20, bottom: 50, left: 40, right: 70, width: 30 }, { width: 200, height: 700 });
      try {
        const container = mount(<Menu label="Actions" items={items()} />);
        void act(() => trigger(container).click());
        expect(popup(container).style.top).toBe("54px");
      } finally {
        restore();
      }
    });

    it("clamps into the viewport rather than pushing the page sideways", () => {
      // jsdom's viewport is 1024 wide. End-aligning a 400px popup to a trigger
      // at the right edge would put its left edge past the margin.
      const restore = withRects(
        { top: 100, bottom: 130, left: 1000, right: 1020, width: 20 },
        { width: 400, height: 150 },
      );
      try {
        const container = mount(<Menu label="Actions" items={items()} align="end" />);
        void act(() => trigger(container).click());
        expect(popup(container).style.left).toBe(`${1024 - 400 - 8}px`);
      } finally {
        restore();
      }
    });

    it("is never narrower than the trigger it hangs from", () => {
      const restore = withRects(
        { top: 100, bottom: 130, left: 40, right: 340, width: 300 },
        { width: 200, height: 80 },
      );
      try {
        const container = mount(<Menu label="Actions" items={items()} />);
        void act(() => trigger(container).click());
        expect(popup(container).style.minWidth).toBe("300px");
      } finally {
        restore();
      }
    });

    it("follows its trigger on scroll instead of closing, so momentum cannot eat it", () => {
      let top = 300;
      const original = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (this: Element) {
        const isPopup = this.getAttribute("role") === "menu";
        const box = isPopup
          ? { top: 0, left: 0, right: 200, bottom: 100, width: 200, height: 100 }
          : { top, left: 40, right: 70, bottom: top + 30, width: 30, height: 30 };
        return { ...box, x: box.left, y: box.top, toJSON: () => box } as DOMRect;
      };
      try {
        const container = mount(<Menu label="Actions" items={items()} />);
        void act(() => trigger(container).click());
        expect(popup(container).style.top).toBe("334px");

        top = 200;
        void act(() => {
          document.dispatchEvent(new Event("scroll", { bubbles: true }));
        });

        expect(container.querySelector('[role="menu"]')).not.toBeNull();
        expect(popup(container).style.top).toBe("234px");
      } finally {
        Element.prototype.getBoundingClientRect = original;
      }
    });
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
