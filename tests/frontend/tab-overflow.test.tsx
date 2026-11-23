// @vitest-environment jsdom
/**
 * Tabs that do not fit go into a More menu at the end of the strip.
 *
 * jsdom has no layout, so each test lays the strip out by hand: tabs 100px
 * wide, a 250px strip and an 80px menu button. With the button in place, only
 * the first tab fits.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";

import { Tabs as RoutedTabs } from "../../assets/ts/components/Tabs";
import { TabList } from "../../assets/ts/ui/TabList";
import { Tabs } from "../../assets/ts/ui/Tabs";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

function rect(left: number, right: number): DOMRect {
  return { left, right, width: right - left, top: 0, bottom: 40, height: 40, x: left, y: 0, toJSON: () => ({}) };
}

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("pk-tabs__list")) return rect(0, 250);
    const strip = this.parentElement;
    if (strip?.classList.contains("pk-tabs__list")) {
      const index = [...strip.children].indexOf(this);
      return rect(index * 100, (index + 1) * 100);
    }
    return rect(0, 0);
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("pk-tabs__more") ? 80 : 0;
  });
});

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.restoreAllMocks();
});

const rooms = ["Red hall", "Blue hall", "Room 2", "Room 8", "Room 9"].map((label, index) => ({
  id: `room-${index}`,
  label,
}));

function Rooms({ initial = "room-0", onSelect }: { initial?: string; onSelect?: (id: string) => void }) {
  const [active, setActive] = useState(initial);
  return (
    <TabList
      label="Locations"
      items={rooms}
      activeId={active}
      onSelect={(id) => {
        onSelect?.(id);
        setActive(id);
      }}
    />
  );
}

const moreButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(".pk-tabs__more button");
function press(target: Element | null | undefined, key: string): void {
  target?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}
const tabs = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

describe("tab overflow", () => {
  it("shows the tabs that fit and lists the rest in a More menu", () => {
    const onSelect = vi.fn();
    const host = mount(<Rooms onSelect={onSelect} />);
    const hidden = tabs(host).map((tab) => tab.classList.contains("pk-tabs__link--overflow"));
    expect(hidden).toEqual([false, true, true, true, true]);
    expect(moreButton(host)?.getAttribute("aria-label")).toBe("More tabs");

    void act(() => moreButton(host)?.click());
    const items = [...host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(items.map((item) => item.textContent)).toEqual(["Blue hall", "Room 2", "Room 8", "Room 9"]);

    void act(() => items[2]?.click());
    expect(onSelect).toHaveBeenCalledWith("room-3");
    expect(moreButton(host)?.getAttribute("aria-label")).toBe("Room 8, more tabs");
    expect(moreButton(host)?.classList.contains("pk-tabs__link--current")).toBe(true);
  });

  it("keeps the strip reachable by keyboard while the current tab is in the menu", () => {
    const host = mount(<Rooms initial="room-3" />);
    expect(tabs(host).map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1, -1]);

    void act(() => press(tabs(host)[0], "ArrowRight"));
    expect(document.activeElement).toBe(moreButton(host));
    expect(moreButton(host)?.getAttribute("aria-label")).toBe("Blue hall, more tabs");

    void act(() => press(moreButton(host), "ArrowLeft"));
    expect(document.activeElement).toBe(tabs(host)[0]);
    expect(tabs(host)[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("lists links that do not fit as links", () => {
    const items = rooms.map((room) => ({ ...room, href: `/rooms/${room.id}` }));
    const host = mount(<Tabs label="Locations" items={items} activeId="room-0" />);
    void act(() => moreButton(host)?.click());
    const links = [...host.querySelectorAll<HTMLAnchorElement>(".pk-menu a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/rooms/room-1",
      "/rooms/room-2",
      "/rooms/room-3",
      "/rooms/room-4",
    ]);
  });

  it("keeps a tab's mark and its meaning in the menu", () => {
    const items = rooms.map((room) =>
      room.id === "room-2"
        ? { ...room, href: `/rooms/${room.id}`, icon: <svg class="not-streamed" />, title: "Not streamed" }
        : { ...room, href: `/rooms/${room.id}` },
    );
    const host = mount(<Tabs label="Locations" items={items} activeId="room-2" />);
    // The current tab is in the menu, so the More button wears its mark too.
    expect(moreButton(host)?.querySelector(".not-streamed")).not.toBeNull();
    void act(() => moreButton(host)?.click());
    const entry = host.querySelector<HTMLAnchorElement>('.pk-menu a[href="/rooms/room-2"]');
    expect(entry?.querySelector(".pk-menu__item-icon .not-streamed")).not.toBeNull();
    expect(entry?.getAttribute("title")).toBe("Not streamed");
    // Only the tab that has the mark shows it.
    expect(host.querySelectorAll(".pk-menu__item-icon")).toHaveLength(1);
  });

  it("follows a routed tab's own link when it is chosen from the menu", () => {
    const onChange = vi.fn();
    const items = rooms.map((room) => ({ key: room.id, label: room.label }));
    const host = mount(
      <RoutedTabs
        label="Locations"
        items={items}
        active="room-0"
        hrefFor={(key) => `/rooms/${key}`}
        onChange={onChange}
      />,
    );
    void act(() => moreButton(host)?.click());
    const entries = [...host.querySelectorAll<HTMLAnchorElement>('a[role="menuitemradio"]')];
    expect(entries.map((entry) => entry.textContent)).toEqual(["Blue hall", "Room 2", "Room 8", "Room 9"]);
    // A real link, so it also opens in a new tab.
    expect(entries[1]?.getAttribute("href")).toBe("/rooms/room-2");

    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    void act(() => {
      entries[1]?.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledWith("room-2");
  });

  it("names a tab with marks by its current text, after its items change", () => {
    const marked = (order: number[]) =>
      order.map((index) => ({ id: rooms[index]!.id, label: <strong>{rooms[index]!.label}</strong> }));
    const host = mount(
      <TabList label="Locations" items={marked([0, 1, 2, 3, 4])} activeId="room-0" onSelect={() => {}} />,
    );
    void act(() =>
      render(<TabList label="Locations" items={marked([0, 4, 3, 2, 1])} activeId="room-0" onSelect={() => {}} />, host),
    );
    void act(() => moreButton(host)?.click());
    const entries = [...host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(entries.map((entry) => entry.textContent)).toEqual(["Room 9", "Room 8", "Room 2", "Blue hall"]);
  });

  it("has no menu when every tab fits", () => {
    // Without the hand-made layout, jsdom gives the strip no width: nothing is measured as cut off.
    vi.restoreAllMocks();
    const roomy = mount(<Rooms />);
    expect(moreButton(roomy)).toBeNull();
    expect(tabs(roomy).some((tab) => tab.classList.contains("pk-tabs__link--overflow"))).toBe(false);
  });
});
