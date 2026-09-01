// @vitest-environment jsdom
/**
 * The system-management shell: the strip that chooses a section, and what it
 * says when a session can reach none of them.
 *
 * The Bootstrap version hand-rolled the strip as `nav nav-tabs` with a
 * `nav-link active` class, and told a reader with no permissions so through a
 * muted paragraph that nothing announced. The sections are URLs, so the strip
 * is navigation: links marked `aria-current="page"`, which is what the
 * portal's Tabs renders when it is handed `hrefFor`. The sections themselves
 * are lazily imported, so what is asserted here is the shell.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SystemManagement } from "../../assets/ts/member-flows/portal/sections/SystemManagement";
import { portalSessionFixture } from "../helpers/portal-session";
import { isCurrentTab, tabNames, tabs } from "./helpers/tabs";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

// The audit log is a lazy chunk that fetches on mount; the shell is what is
// under test, so it is stubbed rather than driven.
vi.mock("../../assets/ts/member-flows/portal/sections/SystemAuditLog", () => ({
  SystemAuditLog: () => <p>audit log</p>,
}));

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

/** A staff session holding exactly the named global permissions. */
function staffWith(...permissions: string[]) {
  return portalSessionFixture({
    staff: true,
    staffRole: "staff",
    grants: permissions.map((permission) => ({ permission, contextType: null, contextId: null })),
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

describe("system management shell", () => {
  it("announces a session with no system permissions rather than leaving a muted line", () => {
    const shell = mount(<SystemManagement session={portalSessionFixture({ member: true })} />);

    const empty = shell.querySelector("[role='status']");
    expect(empty?.textContent).toContain("No system-management permissions are assigned to this account.");
    expect(tabs(shell)).toHaveLength(0);
  });

  it("says a requested section is unavailable, rather than silently showing another one", () => {
    // The reader followed a link into a section their grants do not reach.
    const shell = mount(<SystemManagement session={staffWith("audit:read")} view="access-control" />);

    expect(shell.querySelector("[role='status']")?.textContent).toContain(
      "This system-management section is not available to your account.",
    );
  });

  it("renders the section strip as named navigation, with the current one marked as a page", () => {
    const shell = mount(<SystemManagement session={staffWith("audit:read", "analytics:read")} />);

    const strip = shell.querySelector("nav.pk-tabs");
    expect(strip?.getAttribute("aria-label")).toBe("System management");
    // Navigation, not the ARIA tab pattern: a link that claims `role="tab"`
    // promises arrow-key movement between panels and then navigates instead.
    expect(shell.querySelector("[role='tablist']")).toBeNull();
    for (const tab of tabs(shell)) {
      expect(tab.tagName.toLowerCase()).toBe("a");
      expect(tab.getAttribute("href")).toMatch(/^#\/system\//);
    }
    expect(tabNames(shell).length).toBeGreaterThan(0);
    expect(tabs(shell).filter((tab) => isCurrentTab(tab))).toHaveLength(1);
  });

  it("marks the section named by the route, not always the first one", () => {
    const session = staffWith("audit:read", "analytics:read");
    const first = mount(<SystemManagement session={session} />);
    // With no route segment the first reachable section is the current one.
    expect(tabs(first).find((tab) => isCurrentTab(tab))?.textContent).toBe("Analytics");

    const requested = mount(<SystemManagement session={session} view="audit-log" />);
    expect(tabs(requested).find((tab) => isCurrentTab(tab))?.textContent).toBe("Audit Log");
  });

  it("names the audit-log region through the heading it already renders", async () => {
    // The section itself is eager; only the log inside it is a lazy chunk, so
    // the region and its heading are there once Suspense has resolved.
    const shell = mount(<SystemManagement session={staffWith("audit:read")} view="audit-log" />);
    for (let tick = 0; tick < 3; tick += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    const section = shell.querySelector("section[aria-labelledby]");
    const headingId = section?.getAttribute("aria-labelledby");
    expect(headingId).toBe("system-audit-log-heading");
    expect(shell.querySelector(`[id="${headingId!}"]`)?.textContent).toBe("System Audit Log");
  });
});
