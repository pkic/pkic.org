import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { WorkingGroupCard } from "../../assets/ts/site/WorkingGroupCard";
let container: HTMLDivElement;
afterEach(() => {
  if (container) {
    void act(() => render(null, container));
    container.remove();
  }
});
describe("working group discovery card", () => {
  it("omits an empty visual header while retaining the group destination", () => {
    container = document.createElement("div");
    void act(() => render(<WorkingGroupCard item={{ title: "All Members", href: "#/groups/members" }} />, container));
    expect(container.querySelector(".pkic-wg-spotlight-header")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("#/groups/members");
  });
  it("retains meaningful abbreviations for groups without a registered glyph", () => {
    container = document.createElement("div");
    void act(() =>
      render(<WorkingGroupCard item={{ title: "All Members", href: "#/groups/members", tag: "PKIC" }} />, container),
    );
    expect(container.querySelector(".pkic-wg-spotlight--pkic .pkic-wg-spotlight-header")).not.toBeNull();
    expect(container.querySelector(".pkic-wg-spotlight-abbr")?.textContent).toBe("PKIC");
    expect(container.querySelector(".pkic-wg-spotlight-icon")).toBeNull();
  });
  it("retains the published group header when an abbreviation and glyph exist", () => {
    container = document.createElement("div");
    void act(() =>
      render(
        <WorkingGroupCard item={{ title: "CBOM Working Group", href: "#/groups/cbom", tag: "CBOM" }} />,
        container,
      ),
    );
    expect(container.querySelector(".pkic-wg-spotlight-abbr")?.textContent).toBe("CBOM");
    expect(container.querySelector(".pkic-wg-spotlight-icon svg")).not.toBeNull();
  });
});
