// @vitest-environment jsdom
/**
 * How the Access Control section resolves its own address.
 *
 * Split from `portal-system-access-control.test.tsx`, which is about what the
 * section does; this is about where it says it is. The two were one file and
 * the file outgrew the line budget, which is the signal to separate a
 * responsibility rather than to move unrelated code somewhere else.
 */
import { render, type JSX } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessControl } from "../../assets/ts/member-flows/portal/sections/access-control";
import { tabs, isCurrentTab } from "./helpers/tabs";

const navigate = vi.fn();

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: JSX.HTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={`#${href}`} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));

const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mount(node: preact.ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

beforeEach(() => {
  navigate.mockReset();
  window.location.hash = "";
});

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal access control addressing", () => {
  it("navigates the top-level tabs to their canonical /system/access-control/:tab URLs", () => {
    const container = mount(<AccessControl canGrant canRevoke resourceId="roles" />);
    const tabButtons = Array.from(tabs(container));
    expect(tabButtons.map((button) => button.textContent)).toEqual(["Access Grants", "Roles", "People"]);

    const peopleTab = tabButtons.find((button) => button.textContent === "People")!;
    void act(() => (peopleTab as HTMLButtonElement).click());
    expect(navigate).toHaveBeenCalledWith("/settings/access-control/people");

    const grantsTab = tabButtons.find((button) => button.textContent === "Access Grants")!;
    void act(() => (grantsTab as HTMLButtonElement).click());
    expect(navigate).toHaveBeenCalledWith("/settings/access-control/grants");
  });

  it("rewrites the bare section path to the tab it is actually showing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ grants: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );
    // The rewrite only happens while this section is still the address: the
    // effect runs after the render that mounted it, which can be a render the
    // reader has already navigated away from.
    window.location.hash = "#/settings/access-control";
    mount(<AccessControl canGrant canRevoke />);
    await settle();
    // Replaced rather than pushed: Back belongs to whoever linked here.
    expect(navigate).toHaveBeenCalledWith("/settings/access-control/grants", { replace: true });
  });

  it("leaves the address alone when the reader has already navigated away", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ grants: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );
    // The section mounts one last time on a render whose address is already
    // elsewhere; rewriting then would drag the reader back here.
    window.location.hash = "#/groups/10000000-0000-4000-8000-000000000001/members";
    mount(<AccessControl canGrant canRevoke />);
    await settle();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("leaves a URL that already names its tab alone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ grants: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );
    mount(<AccessControl canGrant canRevoke resourceId="grants" />);
    await settle();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("falls back to the grants tab for an unrecognized resourceId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ grants: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );
    const container = mount(<AccessControl canGrant canRevoke resourceId="not-a-real-tab" />);
    await settle();
    const activeTab = tabs(container).find(isCurrentTab);
    expect(activeTab?.textContent).toBe("Access Grants");
  });
});
