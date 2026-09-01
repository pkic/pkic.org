// @vitest-environment jsdom
/**
 * Badge, Chip, and Kicker tests.
 *
 * Covering tone variants, dot rendering, pressed state, remove button behavior,
 * and element rendering.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { Badge } from "../../assets/ts/ui/Badge";
import { Chip } from "../../assets/ts/ui/Chip";
import { Kicker } from "../../assets/ts/ui/Kicker";

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

describe("Badge", () => {
  function badgeIn(container: HTMLElement): HTMLSpanElement {
    const badge = container.querySelector("span");
    if (!badge) throw new Error("no badge rendered");
    return badge as HTMLSpanElement;
  }

  it("renders as a span", () => {
    const badge = badgeIn(mount(<Badge>Healthy</Badge>));
    expect(badge.tagName).toBe("SPAN");
  });

  it("defaults to the neutral tone and names it, so every badge is described by a class", () => {
    const badge = badgeIn(mount(<Badge>Info</Badge>));
    expect(badge.className).toContain("pk-badge");
    expect(badge.className).toContain("pk-badge--neutral");
  });

  it("applies the tone as a modifier class", () => {
    const badge = badgeIn(mount(<Badge tone="ok">Online</Badge>));
    expect(badge.className).toContain("pk-badge--ok");
  });

  it("applies tone class for each valid tone", () => {
    const tones = ["ok", "warn", "danger", "info", "accent"] as const;
    for (const tone of tones) {
      const badge = badgeIn(mount(<Badge tone={tone}>Status</Badge>));
      expect(badge.className).toContain(`pk-badge--${tone}`);
    }
  });

  it("shows the dot by default", () => {
    const badge = badgeIn(mount(<Badge>Active</Badge>));
    expect(badge.className).toContain("pk-badge--dot");
  });

  it("shows the dot when explicitly enabled", () => {
    const badge = badgeIn(mount(<Badge dot>Active</Badge>));
    expect(badge.className).toContain("pk-badge--dot");
  });

  it("hides the dot when disabled", () => {
    const badge = badgeIn(mount(<Badge dot={false}>Active</Badge>));
    expect(badge.className).not.toContain("pk-badge--dot");
  });

  it("renders the dot as a pseudo-element", () => {
    const badge = badgeIn(mount(<Badge>Active</Badge>));
    // The dot is a ::before pseudo-element, which cannot be directly queried
    // but we verify the modifier class exists, which enables its CSS rendering
    expect(badge.className).toContain("pk-badge--dot");
  });

  it("resolves the tone through a class, never an inline style attribute", () => {
    const badge = badgeIn(mount(<Badge tone="ok">Online</Badge>));
    expect(badge.getAttribute("style")).toBeNull();
    expect(badge.className).toContain("pk-badge--ok");
  });
});

describe("Chip", () => {
  function chipIn(container: HTMLElement): HTMLElement {
    const chip = container.querySelector<HTMLElement>(".pk-chip");
    if (!chip) throw new Error("no chip rendered");
    return chip;
  }

  function toggleIn(container: HTMLElement): HTMLElement {
    const toggle = container.querySelector<HTMLElement>(".pk-chip__toggle");
    if (!toggle) throw new Error("no chip toggle rendered");
    return toggle;
  }

  function removeButtonIn(container: HTMLElement): HTMLButtonElement {
    const remove = container.querySelector<HTMLButtonElement>("button.pk-chip__remove");
    if (!remove) throw new Error("no remove button rendered");
    return remove;
  }

  it("wraps its controls rather than being one, so remove can be a sibling", () => {
    const chip = chipIn(mount(<Chip>Filter</Chip>));
    expect(chip.tagName).toBe("SPAN");
    expect(chip.className).toContain("pk-chip");
  });

  it("omits aria-pressed when the chip does not toggle", () => {
    const container = mount(<Chip>Filter</Chip>);
    expect(toggleIn(container).getAttribute("aria-pressed")).toBeNull();
  });

  it("reports the pressed state in both directions", () => {
    expect(toggleIn(mount(<Chip pressed>Filter</Chip>)).getAttribute("aria-pressed")).toBe("true");
    expect(toggleIn(mount(<Chip pressed={false}>Filter</Chip>)).getAttribute("aria-pressed")).toBe("false");
  });

  it("renders a remove button only when it can be removed", () => {
    expect(mount(<Chip>Filter</Chip>).querySelector("button.pk-chip__remove")).toBeNull();
    const removable = mount(<Chip onRemove={() => undefined}>Filter</Chip>);
    expect(removeButtonIn(removable).type).toBe("button");
  });

  it("names the remove control, and names what it removes when told", () => {
    const generic = mount(<Chip onRemove={() => undefined}>Filter</Chip>);
    expect(removeButtonIn(generic).getAttribute("aria-label")).toBe("Remove filter");

    const specific = mount(
      <Chip onRemove={() => undefined} removeLabel="Status: Active">
        Status: Active
      </Chip>,
    );
    expect(removeButtonIn(specific).getAttribute("aria-label")).toBe("Remove Status: Active");
  });

  it("calls onRemove when the remove button is clicked", () => {
    const onRemove = vi.fn();
    const container = mount(<Chip onRemove={onRemove}>Filter</Chip>);
    void act(() => removeButtonIn(container).click());
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("keeps remove separate from toggle — they are siblings, not nested controls", () => {
    // Nesting a button inside a button is invalid HTML: the inner control is
    // unreachable by keyboard in some browsers and assistive technology cannot
    // report which of the two it is on. axe caught this; the structure is now
    // a plain wrapper holding two independent buttons.
    const onRemove = vi.fn();
    const onToggle = vi.fn();
    const container = mount(
      <Chip onToggle={onToggle} onRemove={onRemove}>
        Filter
      </Chip>,
    );
    const removeButton = removeButtonIn(container);
    expect(removeButton.closest("button")).toBe(removeButton);
    expect(container.querySelector("button button")).toBeNull();

    void act(() => removeButton.click());
    expect(onToggle).not.toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("renders a static chip when nothing happens on activation", () => {
    const container = mount(<Chip>Applied filter</Chip>);
    expect(container.querySelector(".pk-chip__toggle")?.tagName).toBe("SPAN");
  });

  it("toggles when given a handler", () => {
    const onToggle = vi.fn();
    const container = mount(
      <Chip pressed onToggle={onToggle}>
        Status: Active
      </Chip>,
    );
    const toggle = container.querySelector<HTMLButtonElement>("button.pk-chip__toggle");
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    void act(() => toggle?.click());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("Kicker", () => {
  it("renders as a span by default", () => {
    const container = mount(<Kicker>Release</Kicker>);
    const element = container.querySelector("span.pk-kicker");
    expect(element).not.toBeNull();
    expect(element?.tagName).toBe("SPAN");
  });

  it("renders as the requested element", () => {
    const container = mount(<Kicker as="p">Release</Kicker>);
    const element = container.querySelector("p.pk-kicker");
    expect(element).not.toBeNull();
    expect(element?.tagName).toBe("P");
  });

  it("renders the requested span element explicitly", () => {
    const container = mount(<Kicker as="span">Release</Kicker>);
    const element = container.querySelector("span.pk-kicker");
    expect(element).not.toBeNull();
    expect(element?.tagName).toBe("SPAN");
  });

  it("applies the base class", () => {
    const container = mount(<Kicker>Release</Kicker>);
    const element = container.querySelector(".pk-kicker");
    expect(element?.className).toContain("pk-kicker");
  });

  it("renders the dot as a pseudo-element", () => {
    const container = mount(<Kicker>Release</Kicker>);
    const element = container.querySelector(".pk-kicker");
    // The dot is a ::before pseudo-element; we verify the element has the class
    // which enables its CSS rendering
    expect(element).not.toBeNull();
    expect(element?.className).toContain("pk-kicker");
  });
});
