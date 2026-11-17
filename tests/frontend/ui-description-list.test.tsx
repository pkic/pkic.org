// @vitest-environment jsdom
/**
 * The DescriptionList's contract.
 *
 * It is a `<dl>`, not a two-column grid of divs, because a term and its value
 * are related and only the element says so. The other load-bearing case is the
 * absent value: a blank `dd` reads as a rendering fault, so a value that is not
 * there is stated rather than skipped.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { DescriptionList } from "../../assets/ts/ui/DescriptionList";

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

function pairs(container: HTMLElement): Array<[string, string]> {
  const terms = [...container.querySelectorAll("dt")].map((dt) => dt.textContent ?? "");
  const values = [...container.querySelectorAll("dd")].map((dd) => dd.textContent ?? "");
  return terms.map((term, index) => [term, values[index]]);
}

describe("DescriptionList", () => {
  it("renders a description list, not a grid of anonymous boxes", () => {
    const container = mount(
      <DescriptionList
        items={[
          { term: "Legal name", value: "SecureCA Inc" },
          { term: "Headquarters", value: "Trondheim, Norway" },
        ]}
      />,
    );
    const list = container.querySelector("dl");
    expect(list).not.toBeNull();
    expect(list?.className).toContain("pk-datalist");
    expect(pairs(container)).toEqual([
      ["Legal name", "SecureCA Inc"],
      ["Headquarters", "Trondheim, Norway"],
    ]);
  });

  it("renders an em dash where a value is missing rather than an empty row", () => {
    const container = mount(
      <DescriptionList
        items={[
          { term: "Absent" },
          { term: "Null", value: null },
          { term: "Blank", value: "" },
          { term: "Conditional", value: false },
        ]}
      />,
    );
    expect(pairs(container)).toEqual([
      ["Absent", "—"],
      ["Null", "—"],
      ["Blank", "—"],
      ["Conditional", "—"],
    ]);
    expect(container.querySelectorAll(".pk-datalist__empty")).toHaveLength(4);
  });

  it("treats zero as a value, because a count of none is something to say", () => {
    const container = mount(<DescriptionList items={[{ term: "Open findings", value: 0 }]} />);
    expect(pairs(container)).toEqual([["Open findings", "0"]]);
    expect(container.querySelector(".pk-datalist__empty")).toBeNull();
  });

  it("renders a value's markup, so a URL can stay a link", () => {
    const container = mount(
      <DescriptionList
        items={[{ term: "Practice statement", value: <a href="https://example.test/cps">https://example.test/cps</a> }]}
      />,
    );
    const link = container.querySelector("dd a");
    expect(link?.getAttribute("href")).toBe("https://example.test/cps");
  });

  it("carries the compact density as a modifier on the block", () => {
    const roomy = mount(<DescriptionList items={[{ term: "Submitted", value: "2026-08-14" }]} />);
    expect(roomy.querySelector("dl")?.className).not.toContain("pk-datalist--compact");

    const compact = mount(<DescriptionList density="compact" items={[{ term: "Submitted", value: "2026-08-14" }]} />);
    expect(compact.querySelector("dl")?.className).toContain("pk-datalist--compact");
  });

  it("keeps repeated labels paired with their values after rows change", () => {
    const container = mount(
      <DescriptionList
        items={[
          { key: "identity:1", term: "Availability", value: "Listed on the organization page" },
          { key: "identity:2", term: "Availability", value: "Not listed" },
          { term: "Availability", value: "Only this person" },
        ]}
      />,
    );
    void act(() =>
      render(
        <DescriptionList
          items={[
            { key: "identity:2", term: "Availability", value: "Not listed" },
            { term: "Availability", value: "Only this person" },
          ]}
        />,
        container,
      ),
    );
    expect(pairs(container)).toEqual([
      ["Availability", "Not listed"],
      ["Availability", "Only this person"],
    ]);
    void act(() =>
      render(<DescriptionList items={[{ term: "Availability", value: "Signed-in members" }]} />, container),
    );
    expect(pairs(container)).toEqual([["Availability", "Signed-in members"]]);
  });

  it("preserves a focused action when a conditional row is inserted and removed above it", () => {
    const email = { term: "Email", value: <button type="button">Change email</button> };
    const container = mount(<DescriptionList items={[email]} />);
    const value = container.querySelector("dd");
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    button!.focus();

    for (const items of [[{ term: "Name", value: "Example Participant" }, email], [email]]) {
      void act(() => render(<DescriptionList items={items} />, container));
      expect(container.querySelector("button")).toBe(button);
      expect(button?.parentElement).toBe(value);
      expect(document.activeElement).toBe(button);
    }
  });

  it("preserves explicitly keyed rows through reorder, relabeling, and removal of duplicate terms", () => {
    const first = { key: "identity:1", term: "Availability", value: "Not listed" };
    const second = { key: "identity:2", term: "Availability", value: <button type="button">Change visibility</button> };
    const availability = { term: "Availability", value: "Only this person" };
    const container = mount(<DescriptionList items={[first, second, availability]} />);
    const value = container.querySelectorAll("dd")[1];
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    button!.focus();

    for (const items of [
      [second, first, availability],
      [{ ...second, term: "Renamed organization" }, availability],
    ]) {
      void act(() => render(<DescriptionList items={items} />, container));
      expect(container.querySelector("dd")).toBe(value);
      expect(container.querySelector("button")).toBe(button);
      expect(document.activeElement).toBe(button);
    }
  });

  it("warns about duplicate effective keys only during development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.stubEnv("DEV", true);
      mount(<DescriptionList items={[{ term: "Comments" }, { key: "Comments", term: "Other label" }]} />);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate row key "Comments"'));
      warn.mockClear();
      mount(
        <DescriptionList
          items={[
            { key: "one", term: "Comments" },
            { key: "two", term: "Comments" },
          ]}
        />,
      );
      expect(warn).not.toHaveBeenCalled();
      vi.stubEnv("DEV", false);
      mount(<DescriptionList items={[{ term: "Comments" }, { term: "Comments" }]} />);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      warn.mockRestore();
    }
  });

  it("renders nothing but an empty list when there is nothing to show", () => {
    const container = mount(<DescriptionList items={[]} />);
    expect(container.querySelector("dl")?.children).toHaveLength(0);
  });
});
