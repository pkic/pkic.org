// @vitest-environment jsdom
/**
 * The Settings section: an index of pages, and one page per address.
 *
 * What this replaces was a hub with a tab strip, where "Membership Settings"
 * was a single tab holding three unrelated subjects and no settings page had
 * an address, a heading, or a link anyone could send (#40). The strip is gone,
 * so what is asserted here is that each page is genuinely a page and that
 * nothing on the screen still selects between them.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsSection } from "../../assets/ts/member-flows/portal/sections/settings/SettingsSection";
import { portalSessionFixture } from "../helpers/portal-session";
import { tabs } from "./helpers/tabs";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

// Each page is a lazy chunk that fetches on mount; the section's routing is
// what is under test, so the two pages it opens here are stubbed.
vi.mock("../../assets/ts/member-flows/portal/sections/SystemAuditLog", () => ({
  SystemAuditLog: () => <h2>Audit log</h2>,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/membership-settings/MembershipCategories", () => ({
  MembershipCategories: () => <h2>Membership categories</h2>,
}));

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

/** Lets the Suspense boundary around a lazy page resolve. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** A staff session holding exactly the named global permissions. */
function staffWith(...permissions: string[]) {
  return portalSessionFixture({
    staff: true,
    staffRole: "staff",
    grants: permissions.map((permission) => ({ permission, contextType: null, contextId: null })),
  });
}

function linkNames(root: ParentNode): string[] {
  return [...root.querySelectorAll("ul[aria-label='Settings pages'] a")].map((link) => link.textContent?.trim() ?? "");
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

describe("settings section", () => {
  it("opens on an index of the pages the account may read, each linked at its own address", () => {
    const section = mount(<SettingsSection session={staffWith("membership:read", "audit:read")} />);

    expect(section.querySelector("h2")?.textContent).toBe("Settings");
    // The settings that shared one membership page are separate entries now,
    // and each links somewhere a reader can be sent.
    expect(linkNames(section)).toEqual([
      "Application workflow",
      "Applicant reminders",
      "Membership application form",
      "Membership categories",
      "Audit log",
    ]);
    const addresses = [...section.querySelectorAll("ul[aria-label='Settings pages'] a")].map((link) =>
      link.getAttribute("href"),
    );
    expect(addresses).toEqual([
      "#/settings/application-workflow",
      "#/settings/applicant-reminders",
      "#/settings/membership-application-form",
      "#/settings/membership-categories",
      "#/settings/audit-log",
    ]);
    // Each entry says what the page is for, which is the whole reason an
    // index earns its place beside the sidebar list of the same names.
    expect(section.textContent).toContain("Review deadlines, and who is notified");
  });

  it("no longer offers a strip that selects a settings page, in the index or on a page", async () => {
    const index = mount(<SettingsSection session={staffWith("membership:read", "audit:read")} />);
    expect(tabs(index)).toHaveLength(0);

    const page = mount(<SettingsSection session={staffWith("audit:read")} page="audit-log" />);
    await settle();
    expect(tabs(page)).toHaveLength(0);
  });

  it("opens the page an address names, headed by itself rather than by the section", async () => {
    const page = mount(<SettingsSection session={staffWith("audit:read")} page="audit-log" />);
    await settle();

    // The page names itself; nothing above it repeats "Settings".
    expect(page.querySelector("h2")?.textContent).toBe("Audit log");
    expect(page.textContent).not.toContain("Settings");
  });

  it("opens each of the three pages the membership tab used to hold", async () => {
    const page = mount(<SettingsSection session={staffWith("membership:read")} page="membership-categories" />);
    await settle();

    expect(page.querySelector("h2")?.textContent).toBe("Membership categories");
  });

  it("says a requested page is unavailable, rather than silently showing another one", () => {
    // The reader followed a link into a page their grants do not reach.
    const page = mount(<SettingsSection session={staffWith("audit:read")} page="access-control" />);

    expect(page.querySelector("[role='status']")?.textContent).toContain(
      "This settings page is not available to your account.",
    );
  });

  it("announces a session with no settings permissions rather than leaving a muted line", () => {
    const section = mount(<SettingsSection session={portalSessionFixture({ member: true })} />);

    expect(section.querySelector("[role='status']")?.textContent).toContain(
      "No settings permissions are assigned to this account.",
    );
    expect(linkNames(section)).toEqual([]);
  });
});
