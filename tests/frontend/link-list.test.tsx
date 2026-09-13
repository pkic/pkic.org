// @vitest-environment jsdom
/**
 * One vocabulary for a subject's links.
 *
 * Issue #13: LinkedIn got a badge and YouTube, X and Facebook got their raw
 * addresses. The fix was not "give the others a badge too" — it was to stop
 * any surface deciding for itself which platforms exist. So these tests are
 * about the property, not about LinkedIn: whatever the site, a link is a mark
 * and a name, and both come from the same shared table.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { LinkList } from "../../assets/ts/ui/LinkList";
import { getLinkLabel, getLinkMark, LINK_HOSTS } from "../../assets/shared/schemas/links";

let container: HTMLDivElement | null = null;
function mount(node: preact.VNode): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}
afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
});

describe("the shared link reference data", () => {
  it("gives every recognized site both a name and a mark", () => {
    // A site known to one and not the other is how "YouTube ↗" happens.
    const incomplete = Object.entries(LINK_HOSTS).filter(([, host]) => !host.label || !host.mark);
    expect(incomplete).toEqual([]);
  });

  it("recognizes a site whether or not the URL carries www.", () => {
    expect(getLinkLabel("https://www.linkedin.com/company/x")).toBe("LinkedIn");
    expect(getLinkLabel("https://linkedin.com/company/x")).toBe("LinkedIn");
    expect(getLinkMark("https://www.youtube.com/user/ejbca")).toBe(getLinkMark("https://youtube.com/user/ejbca"));
  });

  it("names an unrecognized site by its host and marks it as outbound", () => {
    expect(getLinkLabel("https://example.test/about")).toBe("example.test");
    expect(getLinkMark("https://example.test/about")).toBe("↗");
  });

  it("names a Mastodon account by its instance, from the path", () => {
    expect(getLinkMark("https://infosec.exchange/@someone")).toBe("@");
    expect(getLinkLabel("https://infosec.exchange/@someone")).toBe("infosec.exchange");
  });

  it("does not print mailto: scaffolding as a name", () => {
    // Not persistable through the links schema, but the codec is shared and a
    // legacy row must not surface "mailto:someone@example.test" as a label.
    expect(getLinkLabel("mailto:someone@example.test")).toBe("someone@example.test");
    expect(getLinkMark("mailto:someone@example.test")).toBe("@");
  });

  it("falls back to the string itself when it is not a URL at all", () => {
    expect(getLinkLabel("not a url")).toBe("not a url");
    expect(getLinkMark("not a url")).toBe("↗");
  });
});

describe("LinkList", () => {
  it("shows every platform the same way — a mark and the site's name", () => {
    const root = mount(
      <LinkList
        links={[
          "https://www.linkedin.com/company/wearekeyfactor",
          "https://x.com/KeyfactorComm",
          "https://www.youtube.com/user/ejbca",
          "https://www.facebook.com/keyfactor",
        ]}
      />,
    );
    const labels = [...root.querySelectorAll(".pk-link-list__label")].map((node) => node.textContent);
    expect(labels).toEqual(["LinkedIn", "X (Twitter)", "YouTube", "Facebook"]);
    // Four links, four marks: no platform renders as a bare address.
    expect(root.querySelectorAll("svg.pk-link-list__mark path")).toHaveLength(4);
    expect(root.querySelectorAll(".pk-link-list__label.pk-sr-only")).toHaveLength(4);
    for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a")) {
      expect(anchor.textContent).not.toContain("https://");
      expect(anchor.getAttribute("rel")).toContain("noopener");
    }
  });

  it("keeps the address reachable without printing it", () => {
    const root = mount(<LinkList links={["https://x.com/KeyfactorComm"]} />);
    expect(root.querySelector("a")?.getAttribute("title")).toBe("https://x.com/KeyfactorComm");
  });

  it("names the owner in each link so ten cards do not offer ten identical links", () => {
    const root = mount(<LinkList links={["https://x.com/a"]} ownerName="Ada Lovelace" />);
    // An owner-supplied label replaces the link's text outright, so it has to
    // carry the new-tab warning the text would otherwise have given.
    expect(root.querySelector("a")?.getAttribute("aria-label")).toBe(
      "Ada Lovelace on X (Twitter) (opens in a new tab)",
    );
  });

  it("warns that the link leaves the page even with no owner named", () => {
    const root = mount(<LinkList links={["https://x.com/a"]} />);
    const anchor = root.querySelector("a");
    expect(anchor?.textContent).toContain("(opens in a new tab)");
    expect(anchor?.querySelector(".pk-sr-only")).not.toBeNull();
  });

  it("names the list itself when the surrounding heading does not", () => {
    const root = mount(<LinkList links={["https://x.com/a"]} label="Event links" />);
    expect(root.querySelector("ul")?.getAttribute("aria-label")).toBe("Event links");
  });

  it("renders nothing rather than an empty list", () => {
    expect(mount(<LinkList links={[]} />).innerHTML).toBe("");
  });
});
