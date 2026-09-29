// @vitest-environment jsdom
/**
 * Layout components: Panel, Tabs, Breadcrumb.
 *
 * Tests structural and accessibility concerns: heading hierarchy, link
 * semantics, navigation role, separator DOM presence, and aria-current.
 */

import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";

import { Panel, PanelBody, PanelHeader } from "../../assets/ts/ui/Panel";
import { Tabs } from "../../assets/ts/ui/Tabs";
import { Breadcrumb } from "../../assets/ts/ui/Breadcrumb";

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

describe("Panel", () => {
  it("renders a section with the panel class", () => {
    const container = mount(<Panel>Content</Panel>);
    const section = container.querySelector("section");
    expect(section).not.toBeNull();
    expect(section?.className).toContain("pk-panel");
  });

  it("renders PanelHeader with an h3 by default", () => {
    const container = mount(
      <Panel>
        <PanelHeader title="Test" />
      </Panel>,
    );
    const h3 = container.querySelector("h3");
    expect(h3).not.toBeNull();
    expect(h3?.className).toContain("pk-panel__title");
    expect(h3?.textContent).toBe("Test");
  });

  it("renders PanelHeader with h2 when headingLevel is 2", () => {
    const container = mount(
      <Panel>
        <PanelHeader title="Top" headingLevel={2} />
      </Panel>,
    );
    const h2 = container.querySelector("h2");
    expect(h2).not.toBeNull();
    expect(h2?.className).toContain("pk-panel__title");
    expect(h2?.textContent).toBe("Top");
  });

  it("renders PanelHeader with h4 when headingLevel is 4", () => {
    const container = mount(
      <Panel>
        <PanelHeader title="Sub" headingLevel={4} />
      </Panel>,
    );
    const h4 = container.querySelector("h4");
    expect(h4).not.toBeNull();
    expect(h4?.className).toContain("pk-panel__title");
    expect(h4?.textContent).toBe("Sub");
  });

  it("renders PanelHeader toolbar slot when children provided", () => {
    const container = mount(
      <Panel>
        <PanelHeader title="Header">
          <button>Action</button>
        </PanelHeader>
      </Panel>,
    );
    const toolbar = container.querySelector(".pk-panel__toolbar");
    expect(toolbar).not.toBeNull();
    expect(toolbar?.querySelector("button")).not.toBeNull();
  });

  it("renders PanelBody with padding", () => {
    const container = mount(
      <Panel>
        <PanelBody>Body content</PanelBody>
      </Panel>,
    );
    const body = container.querySelector(".pk-panel__body");
    expect(body).not.toBeNull();
    expect(body?.textContent).toBe("Body content");
  });
});

describe("Tabs", () => {
  const items = [
    { id: "tab-1", label: "First", href: "/first" },
    { id: "tab-2", label: "Second", href: "/second" },
    { id: "tab-3", label: "Third", href: "/third" },
  ];

  it("renders a nav with aria-label", () => {
    const container = mount(<Tabs items={items} activeId="tab-1" label="Navigation" />);
    const nav = container.querySelector("nav");
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute("aria-label")).toBe("Navigation");
  });

  it("renders links for each item", () => {
    const container = mount(<Tabs items={items} activeId="tab-1" label="Nav" />);
    const links = container.querySelectorAll("a");
    expect(links.length).toBe(3);
    expect(links[0]?.textContent).toBe("First");
    expect(links[1]?.textContent).toBe("Second");
    expect(links[2]?.textContent).toBe("Third");
  });

  it("marks the active item with aria-current='page'", () => {
    const container = mount(<Tabs items={items} activeId="tab-2" label="Nav" />);
    const links = container.querySelectorAll("a");
    expect(links[0]?.getAttribute("aria-current")).toBeNull();
    expect(links[1]?.getAttribute("aria-current")).toBe("page");
    expect(links[2]?.getAttribute("aria-current")).toBeNull();
  });

  it("does not use role='tab' or role='tablist'", () => {
    const container = mount(<Tabs items={items} activeId="tab-1" label="Nav" />);
    const nav = container.querySelector("nav");
    const links = container.querySelectorAll("a");
    expect(nav?.getAttribute("role")).toBeNull();
    for (const link of links) {
      expect(link.getAttribute("role")).toBeNull();
    }
  });

  it("sets href on each link", () => {
    const container = mount(<Tabs items={items} activeId="tab-1" label="Nav" />);
    const links = container.querySelectorAll("a");
    expect(links[0]?.getAttribute("href")).toBe("/first");
    expect(links[1]?.getAttribute("href")).toBe("/second");
    expect(links[2]?.getAttribute("href")).toBe("/third");
  });
});

describe("Breadcrumb", () => {
  const items = [{ label: "Home", href: "/" }, { label: "Products", href: "/products" }, { label: "Details" }];

  it("renders a nav with aria-label", () => {
    const container = mount(<Breadcrumb items={items} />);
    const nav = container.querySelector("nav");
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute("aria-label")).toBe("Breadcrumb");
  });

  it("renders a custom aria-label when provided", () => {
    const container = mount(<Breadcrumb items={items} label="Path" />);
    const nav = container.querySelector("nav");
    expect(nav?.getAttribute("aria-label")).toBe("Path");
  });

  it("renders an ordered list", () => {
    const container = mount(<Breadcrumb items={items} />);
    const ol = container.querySelector("ol");
    expect(ol).not.toBeNull();
    expect(ol?.className).toContain("pk-breadcrumb__list");
  });

  it("renders list items for each breadcrumb", () => {
    const container = mount(<Breadcrumb items={items} />);
    const lis = container.querySelectorAll("li");
    expect(lis.length).toBe(3);
  });

  it("renders links for items with href", () => {
    const container = mount(<Breadcrumb items={items} />);
    const links = container.querySelectorAll("a");
    expect(links.length).toBe(2);
    expect(links[0]?.textContent).toBe("Home");
    expect(links[1]?.textContent).toBe("Products");
  });

  it("renders the last item as plain text with aria-current='page'", () => {
    const container = mount(<Breadcrumb items={items} />);
    const lis = container.querySelectorAll("li");
    const lastLi = lis[2];
    const lastSpan = lastLi?.querySelector("[aria-current='page']");
    expect(lastSpan).not.toBeNull();
    expect(lastSpan?.tagName).toBe("SPAN");
    expect(lastSpan?.textContent).toBe("Details");
  });

  it("does not render a link for the last item", () => {
    const container = mount(<Breadcrumb items={items} />);
    const lis = container.querySelectorAll("li");
    const lastLi = lis[2];
    const link = lastLi?.querySelector("a");
    expect(link).toBeNull();
  });

  it("has no separator text nodes in the DOM", () => {
    const container = mount(<Breadcrumb items={items} />);
    const ol = container.querySelector("ol");
    if (!ol) throw new Error("ol not rendered");

    // Check all text nodes in the list
    const walker = document.createTreeWalker(ol, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    // Filter to only non-empty text nodes (excluding whitespace)
    const significantTextNodes = textNodes.filter((n) => n.textContent?.trim() !== "");

    // Text nodes should only be the breadcrumb labels inside spans or a tags,
    // not the separator "/" which should be in CSS ::before
    for (const textNode of significantTextNodes) {
      const parent = textNode.parentElement;
      // Text should be in a span, a, or li (li contains the span/a)
      expect(parent?.tagName).toMatch(/^(SPAN|A|LI)$/);
    }

    // Verify no "/" appears as a text node
    const slashInText = significantTextNodes.some((n) => n.textContent?.includes("/"));
    expect(slashInText).toBe(false);
  });

  it("renders breadcrumbs without href as plain text", () => {
    const customItems = [{ label: "Static" }, { label: "Current" }];
    const container = mount(<Breadcrumb items={customItems} />);
    const links = container.querySelectorAll("a");
    expect(links.length).toBe(0);
    const spans = container.querySelectorAll("span");
    // One for the last item (aria-current), one for the first if it's not linked
    expect(spans.length).toBeGreaterThan(0);
  });
});
