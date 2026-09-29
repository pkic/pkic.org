// @vitest-environment jsdom
/**
 * The DescriptionList's contract.
 *
 * It is a `<dl>`, not a two-column grid of divs, because a term and its value
 * are related and only the element says so. The other load-bearing case is the
 * absent value: a blank `dd` reads as a rendering fault, so a value that is not
 * there is stated rather than skipped.
 */

import { afterEach, describe, expect, it } from "vitest";
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

  it("renders nothing but an empty list when there is nothing to show", () => {
    const container = mount(<DescriptionList items={[]} />);
    expect(container.querySelector("dl")?.children).toHaveLength(0);
  });
});
