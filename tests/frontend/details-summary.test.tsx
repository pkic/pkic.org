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
    const rows = Array.from(container.querySelectorAll(".details-summary-row")).map((row) => row.textContent);
    expect(rows.find((r) => r?.includes("Active"))).toContain("yes");
    expect(rows.find((r) => r?.includes("Archived"))).toContain("no");
    expect(rows.find((r) => r?.includes("Deleted at"))).toContain("—");
  });

  it("joins an array of primitives with a comma", () => {
    const container = mount(<DetailsSummary value={{ tags: ["alpha", "beta", "gamma"] }} />);
    const dd = container.querySelector("dd");
    expect(dd?.textContent).toBe("alpha, beta, gamma");
  });

  it("renders a nested object one level deep as an indented sub-list", () => {
    const container = mount(<DetailsSummary value={{ change: { field: "title", from: "Old", to: "New" } }} />);
    const sublist = container.querySelector(".details-summary-sublist");
    expect(sublist).not.toBeNull();
    expect(sublist?.textContent).toContain("Field");
    expect(sublist?.textContent).toContain("title");
    expect(sublist?.textContent).toContain("From");
    expect(sublist?.textContent).toContain("Old");
    expect(container.querySelector("pre")).toBeNull();
  });

  it("falls back to a collapsed raw view when nesting goes past one level", () => {
    const container = mount(<DetailsSummary value={{ change: { field: { nested: "too deep" } } }} />);
    const details = container.querySelector("details.details-summary-raw");
    expect(details).not.toBeNull();
    expect(details?.querySelector("summary")?.textContent).toBe("Raw details");
    const pre = details?.querySelector("pre");
    expect(pre?.textContent).toContain('"nested": "too deep"');
    expect(container.querySelector("dl.details-summary")).toBeNull();
  });

  it("falls back to a collapsed raw view for a non-object root", () => {
    const container = mount(<DetailsSummary value={["one", "two"]} />);
    const details = container.querySelector("details.details-summary-raw");
    expect(details).not.toBeNull();
    expect(details?.querySelector("pre")?.textContent).toContain('"one"');
  });

  it("renders nothing for an empty object", () => {
    const container = mount(<DetailsSummary value={{}} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for undefined or null", () => {
    const undefinedContainer = mount(<DetailsSummary value={undefined} />);
    expect(undefinedContainer.innerHTML).toBe("");

    const nullContainer = mount(<DetailsSummary value={null} />);
    expect(nullContainer.innerHTML).toBe("");
  });
});
