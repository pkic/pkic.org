// @vitest-environment jsdom
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { DetailsSummary } from "../../assets/ts/components/DetailsSummary";

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

/**
 * The term/value pairs of one list, read the way assistive technology walks
 * them: a `dt` and the `dd` that immediately follows it, both direct children
 * of the same `dl`. The Bootstrap version wrapped each pair in a styling
 * `div`, so this is also what stops that wrapper coming back — it breaks the
 * association, and `pk-datalist`'s two-column grid, at the same time.
 */
function pairsIn(list: Element): [string, string][] {
  return [...list.querySelectorAll(":scope > dt")].map((term) => {
    const value = term.nextElementSibling;
    return [term.textContent ?? "", value?.tagName === "DD" ? (value.textContent ?? "") : ""];
  });
}

describe("DetailsSummary", () => {
  it("humanizes snake_case and camelCase keys into sentence case", () => {
    const container = mount(<DetailsSummary value={{ previous_status: "draft", campaignId: "camp-1" }} />);
    const terms = Array.from(container.querySelectorAll("dt")).map((el) => el.textContent);
    expect(terms).toContain("Previous status");
    expect(terms).toContain("Campaign id");
    expect(container.textContent).not.toContain("previous_status");
    expect(container.textContent).not.toContain("campaignId");
  });

  it("formats an ISO-8601 instant value through the shared formatDateTime helper", () => {
    const container = mount(<DetailsSummary value={{ occurred_at: "2026-08-21T10:00:00.000Z" }} />);
    const dd = container.querySelector("dd");
    expect(dd?.textContent).not.toBe("2026-08-21T10:00:00.000Z");
    expect(dd?.textContent).toBe(
      new Date("2026-08-21T10:00:00.000Z").toLocaleString(undefined, {
        dateStyle: "short",
        timeStyle: "short",
      }),
    );
  });

  it("renders booleans as yes/no and null as an em dash", () => {
    const container = mount(<DetailsSummary value={{ active: true, archived: false, deleted_at: null }} />);
    expect(pairsIn(container.querySelector("dl")!)).toEqual([
      ["Active", "yes"],
      ["Archived", "no"],
      ["Deleted at", "—"],
    ]);
  });

  it("joins an array of primitives with a comma", () => {
    const container = mount(<DetailsSummary value={{ tags: ["alpha", "beta", "gamma"] }} />);
    const dd = container.querySelector("dd");
    expect(dd?.textContent).toBe("alpha, beta, gamma");
  });

  it("renders a nested object one level deep as an indented sub-list", () => {
    const container = mount(<DetailsSummary value={{ change: { field: "title", from: "Old", to: "New" } }} />);
    const sublist = container.querySelector("dd > dl");
    expect(sublist).not.toBeNull();
    expect(pairsIn(sublist!)).toEqual([
      ["Field", "title"],
      ["From", "Old"],
      ["To", "New"],
    ]);
    expect(container.querySelector("pre")).toBeNull();
  });

  it("falls back to a collapsed raw view when nesting goes past one level", () => {
    const container = mount(<DetailsSummary value={{ change: { field: { nested: "too deep" } } }} />);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    // A native <details>/<summary> is the disclosure: already reachable by
    // keyboard and announced as expandable, with no role or handler added.
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("Raw details");
    const pre = details?.querySelector("pre");
    expect(pre?.textContent).toContain('"nested": "too deep"');
    expect(container.querySelector("dl")).toBeNull();
  });

  it("falls back to a collapsed raw view for a non-object root", () => {
    const container = mount(<DetailsSummary value={["one", "two"]} />);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.querySelector("pre")?.textContent).toContain('"one"');
  });

  it("renders nothing for an empty object", () => {
    const container = mount(<DetailsSummary value={{}} />);
    expect(container.innerHTML).toBe("");
  });

  it("keeps a value the summary cannot read rather than dropping it", () => {
    // The failure path: a payload past the shape the list can express. It has
    // to survive, because an audit entry that silently loses its details is
    // worse than one that shows them raw.
    const container = mount(<DetailsSummary value={{ a: { b: { c: { d: 1 } } } }} />);
    expect(container.querySelector("dl")).toBeNull();
    expect(container.querySelector("pre")?.textContent).toContain('"d": 1');
  });

  it("renders nothing for undefined or null", () => {
    const undefinedContainer = mount(<DetailsSummary value={undefined} />);
    expect(undefinedContainer.innerHTML).toBe("");

    const nullContainer = mount(<DetailsSummary value={null} />);
    expect(nullContainer.innerHTML).toBe("");
  });
});
