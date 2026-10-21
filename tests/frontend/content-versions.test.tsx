import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";
import { WorkingGroupSidebar, WorkingGroupSidebarTree } from "../../assets/ts/site/WorkingGroupSidebar";
import type { SiteSidebarTree } from "../../assets/shared/site-content";

const tree: SiteSidebarTree = {
  root: { href: "/model/", label: "Model", current: false },
  sections: [],
  versions: {
    label: "Switch model version",
    items: [
      {
        id: "patch",
        version: "1.1.2",
        status: "released",
        label: "1.1.2",
        href: "/model/1.1.2/",
        current: true,
        latest: true,
        fallback: false,
      },
      {
        id: "minor",
        version: "1.2.0",
        status: "released",
        label: "1.2.0",
        href: "/model/1.2.0/",
        current: false,
        latest: false,
        fallback: false,
      },
      {
        id: "major",
        version: "2.0.0",
        status: "released",
        label: "2.0.0",
        href: "/model/2/",
        current: false,
        latest: false,
        fallback: false,
      },
      {
        id: "draft",
        version: "3.0.0",
        status: "draft",
        label: "3.0.0 — Draft",
        href: "/model/draft/",
        current: false,
        latest: false,
        fallback: false,
      },
    ],
  },
};

describe("shared model tree version navigation", () => {
  it("renders the same version control inside a popup tree and a sticky sidebar", () => {
    const popup = render(<WorkingGroupSidebarTree tree={tree} />);
    const sidebar = render(<WorkingGroupSidebar tree={tree} wgId="PQC" />);
    expect(sidebar).toContain(popup);
    expect(popup).not.toContain("All releases and downloads");
    expect(popup).not.toContain("wg-version-hint--fallback");
    const fallbackTree = structuredClone(tree);
    fallbackTree.versions!.items[0]!.fallback = true;
    expect(render(<WorkingGroupSidebarTree tree={fallbackTree} />)).toContain("aria-description=");
    expect(render(<WorkingGroupSidebarTree tree={fallbackTree} />)).not.toContain(">Overview<");
    expect(popup).toContain('aria-label="Switch model version"');
  });
  it("shows direct links to the latest release, selected older release, and every draft", () => {
    const root = document.createElement("div");
    root.innerHTML = render(<WorkingGroupSidebarTree tree={tree} />);
    expect(root.querySelectorAll("details")).toHaveLength(0);
    expect([...root.querySelectorAll(".wg-version-item")].map((node) => node.getAttribute("href"))).toEqual([
      "/model/1.1.2/",
      "/model/draft/",
    ]);
    const older = structuredClone(tree);
    older.versions!.items[0]!.current = false;
    older.versions!.items[1]!.current = true;
    root.innerHTML = render(<WorkingGroupSidebarTree tree={older} />);
    expect(root.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe("/model/1.2.0/");
  });
});
