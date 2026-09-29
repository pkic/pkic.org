// @vitest-environment jsdom
/**
 * Pager, Meter, and Toast behaviour that visual specimens cannot show:
 * pagination logic, aria attributes, clamping, callback invocation.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { Pager, pageWindow } from "../../assets/ts/ui/Pager";
import { Meter } from "../../assets/ts/ui/Meter";
import { Toast } from "../../assets/ts/ui/Toast";

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

describe("pageWindow", () => {
  it("returns empty array for pageCount 0", () => {
    expect(pageWindow(1, 0)).toEqual([]);
  });

  it("returns empty array for pageCount 1", () => {
    expect(pageWindow(1, 1)).toEqual([]);
  });

  it("returns all pages when pageCount is 7 or fewer", () => {
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("shows first and last page with current and neighbours when pageCount exceeds 7", () => {
    // Current at middle: should show first, last, and current with neighbours
    const result = pageWindow(5, 10);
    expect(result).toContain(1);
    expect(result).toContain(10);
    expect(result).toContain(4);
    expect(result).toContain(5);
    expect(result).toContain(6);
    expect(result).toContain("gap");
  });

  it("shows correct window when current page is at the start", () => {
    const result = pageWindow(1, 15);
    expect(result).toEqual([1, 2, "gap", 15]);
  });

  it("shows correct window when current page is at the end", () => {
    const result = pageWindow(15, 15);
    expect(result).toEqual([1, "gap", 14, 15]);
  });

  it("includes gaps where pages are omitted", () => {
    const result = pageWindow(8, 20);
    const gapCount = result.filter((x) => x === "gap").length;
    expect(gapCount).toBeGreaterThanOrEqual(1);
  });

  it("always has first and last pages present for pageCount > 7", () => {
    const result = pageWindow(12, 20);
    expect(result).toContain(1);
    expect(result).toContain(20);
  });
});

describe("Pager", () => {
  it("disables the previous button on page 1", () => {
    const container = mount(
      <Pager page={1} pageCount={5} total={50} rangeStart={1} rangeEnd={10} onSelect={() => {}} />,
    );
    const prevBtn = container.querySelector(".pk-pager__button--prev") as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
  });

  it("enables the previous button on page 2 or later", () => {
    const container = mount(
      <Pager page={2} pageCount={5} total={50} rangeStart={11} rangeEnd={20} onSelect={() => {}} />,
    );
    const prevBtn = container.querySelector(".pk-pager__button--prev") as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(false);
  });

  it("disables the next button on the last page", () => {
    const container = mount(
      <Pager page={5} pageCount={5} total={50} rangeStart={41} rangeEnd={50} onSelect={() => {}} />,
    );
    const nextBtn = container.querySelector(".pk-pager__button--next") as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
  });

  it("enables the next button before the last page", () => {
    const container = mount(
      <Pager page={4} pageCount={5} total={50} rangeStart={31} rangeEnd={40} onSelect={() => {}} />,
    );
    const nextBtn = container.querySelector(".pk-pager__button--next") as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(false);
  });

  it("marks the current page with aria-current", () => {
    const container = mount(
      <Pager page={3} pageCount={5} total={50} rangeStart={21} rangeEnd={30} onSelect={() => {}} />,
    );
    const buttons = container.querySelectorAll(".pk-pager__button");
    const currentBtn = Array.from(buttons).find((btn) => btn.getAttribute("aria-current") === "page");
    expect(currentBtn).toBeTruthy();
    expect(currentBtn?.textContent).toBe("3");
  });

  it("makes the ellipsis aria-hidden and not a button", () => {
    const container = mount(
      <Pager page={1} pageCount={20} total={200} rangeStart={1} rangeEnd={10} onSelect={() => {}} />,
    );
    const gap = container.querySelector(".pk-pager__item--gap");
    expect(gap?.getAttribute("aria-hidden")).toBe("true");
    expect(gap?.querySelector("button")).toBeNull();
  });

  it("calls onSelect with the selected page number", () => {
    const onSelect = vi.fn();
    const container = mount(
      <Pager page={2} pageCount={5} total={50} rangeStart={11} rangeEnd={20} onSelect={onSelect} />,
    );
    const buttons = container.querySelectorAll(".pk-pager__button");
    const pageBtn = Array.from(buttons).find((btn) => btn.textContent === "3");
    if (pageBtn) {
      void act(() => (pageBtn as HTMLButtonElement).click());
      expect(onSelect).toHaveBeenCalledWith(3);
    }
  });

  it("calls onSelect with page - 1 when previous is clicked", () => {
    const onSelect = vi.fn();
    const container = mount(
      <Pager page={3} pageCount={5} total={50} rangeStart={21} rangeEnd={30} onSelect={onSelect} />,
    );
    const prevBtn = container.querySelector(".pk-pager__button--prev") as HTMLButtonElement;
    void act(() => prevBtn.click());
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("calls onSelect with page + 1 when next is clicked", () => {
    const onSelect = vi.fn();
    const container = mount(
      <Pager page={2} pageCount={5} total={50} rangeStart={11} rangeEnd={20} onSelect={onSelect} />,
    );
    const nextBtn = container.querySelector(".pk-pager__button--next") as HTMLButtonElement;
    void act(() => nextBtn.click());
    expect(onSelect).toHaveBeenCalledWith(3);
  });
});

describe("Meter", () => {
  it("clamps value below 0 to 0", () => {
    const container = mount(<Meter value={-10} max={100} label="Test meter" />);
    const meter = container.querySelector('[role="meter"]');
    expect(meter?.getAttribute("aria-valuenow")).toBe("0");
  });

  it("clamps value above max to max", () => {
    const container = mount(<Meter value={150} max={100} label="Test meter" />);
    const meter = container.querySelector('[role="meter"]');
    expect(meter?.getAttribute("aria-valuenow")).toBe("100");
  });

  it("exposes aria-valuenow with the actual value", () => {
    const container = mount(<Meter value={42} max={100} label="Test meter" />);
    const meter = container.querySelector('[role="meter"]');
    expect(meter?.getAttribute("aria-valuenow")).toBe("42");
  });

  it("exposes aria-valuemin as 0", () => {
    const container = mount(<Meter value={50} max={100} label="Test meter" />);
    const meter = container.querySelector('[role="meter"]');
    expect(meter?.getAttribute("aria-valuemin")).toBe("0");
  });

  it("exposes aria-valuemax as the max value", () => {
    const container = mount(<Meter value={50} max={100} label="Test meter" />);
    const meter = container.querySelector('[role="meter"]');
    expect(meter?.getAttribute("aria-valuemax")).toBe("100");
  });

  it("does not render an inline style attribute on the fill", () => {
    const container = mount(<Meter value={50} max={100} label="Test meter" />);
    const fill = container.querySelector(".pk-meter__fill");
    expect(fill?.getAttribute("style")).toBeNull();
  });

  it("sets data-fill to a rounded 5% increment", () => {
    const container1 = mount(<Meter value={23} max={100} label="Test meter" />);
    const fill1 = container1.querySelector(".pk-meter__fill");
    expect(fill1?.getAttribute("data-fill")).toBe("25");

    const container2 = mount(<Meter value={12} max={100} label="Test meter" />);
    const fill2 = container2.querySelector(".pk-meter__fill");
    expect(fill2?.getAttribute("data-fill")).toBe("10");
  });

  it("renders the label in aria-label", () => {
    const container = mount(<Meter value={50} max={100} label="Progress indicator" />);
    const meter = container.querySelector('[role="meter"]');
    expect(meter?.getAttribute("aria-label")).toBe("Progress indicator");
  });

  it("applies tone as a modifier class", () => {
    const container = mount(<Meter value={50} max={100} label="Test" tone="danger" />);
    const meter = container.querySelector('[role="meter"]');
    expect(meter?.className).toContain("pk-meter--danger");
  });

  it("guards against max <= 0", () => {
    const container = mount(<Meter value={50} max={0} label="Test meter" />);
    const fill = container.querySelector(".pk-meter__fill");
    expect(fill?.getAttribute("data-fill")).toBe("0");
  });
});

describe("Toast", () => {
  it("uses role status, not alert", () => {
    const container = mount(<Toast message="Operation successful" />);
    const toast = container.querySelector('[role="status"]');
    expect(toast).toBeTruthy();
  });

  it("renders the message", () => {
    const container = mount(<Toast message="Your changes have been saved" />);
    const message = container.querySelector(".pk-toast__message");
    expect(message?.textContent).toBe("Your changes have been saved");
  });

  it("renders the action button when provided", () => {
    const container = mount(<Toast message="Undo?" action={{ label: "Undo", onSelect: () => {} }} />);
    const actionBtn = container.querySelector(".pk-toast__action");
    expect(actionBtn?.textContent).toBe("Undo");
  });

  it("calls the action onSelect callback when clicked", () => {
    const onSelect = vi.fn();
    const container = mount(<Toast message="Undo?" action={{ label: "Undo", onSelect }} />);
    const actionBtn = container.querySelector(".pk-toast__action") as HTMLButtonElement;
    void act(() => actionBtn.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders the dismiss button when onDismiss is provided", () => {
    const container = mount(<Toast message="Info" onDismiss={() => {}} />);
    const dismissBtn = container.querySelector(".pk-toast__dismiss");
    expect(dismissBtn?.textContent).toBe("Dismiss");
  });

  it("calls onDismiss when dismiss is clicked", () => {
    const onDismiss = vi.fn();
    const container = mount(<Toast message="Info" onDismiss={onDismiss} />);
    const dismissBtn = container.querySelector(".pk-toast__dismiss") as HTMLButtonElement;
    void act(() => dismissBtn.click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("applies tone as a modifier class", () => {
    const container = mount(<Toast message="Error occurred" tone="danger" />);
    const toast = container.querySelector('[role="status"]');
    expect(toast?.className).toContain("pk-toast--danger");
  });

  it("defaults to tone ok", () => {
    const container = mount(<Toast message="Done" />);
    const toast = container.querySelector('[role="status"]');
    expect(toast?.className).toContain("pk-toast--ok");
  });

  it("does not render dismiss button when onDismiss is not provided", () => {
    const container = mount(<Toast message="Info" />);
    const dismissBtn = container.querySelector(".pk-toast__dismiss");
    expect(dismissBtn).toBeNull();
  });

  it("does not render action button when action is not provided", () => {
    const container = mount(<Toast message="Info" />);
    const actionBtn = container.querySelector(".pk-toast__action");
    expect(actionBtn).toBeNull();
  });
});
