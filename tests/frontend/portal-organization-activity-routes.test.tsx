// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortalShell } from "../../assets/ts/member-flows/portal/shell/PortalShell";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { OrganizationActivity } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationActivity";

vi.mock("../../assets/ts/member-flows/portal/shell/portal-sections", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  OrganizationDetail: ({ organizationId }: { organizationId: string }) => (
    <section aria-label={`Organization ${organizationId}`}>
      <OrganizationActivity organizationId={organizationId} canReadSponsorships />
    </section>
  ),
}));

let container: HTMLDivElement;

async function open(hash: string): Promise<string> {
  window.location.hash = hash;
  await act(() => {
    render(<PortalShell />, container);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container.querySelector("main")?.textContent ?? container.textContent ?? "";
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  // jsdom lays nothing out, so the shell's scroll reset has nothing to scroll.
  vi.stubGlobal("scrollTo", vi.fn());
  Element.prototype.scrollTo = vi.fn();
  portalSession.value = portalSessionFixture({ staff: true, member: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            groups: [],
            events: [],
            proposals: [],
            sponsorships: [],
            organizations: [],
            page: { limit: 12, offset: 0, total: 0, hasMore: false },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    ),
  );
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  portalSession.value = null;
  window.location.hash = "";
  vi.unstubAllGlobals();
});

describe("organization activity routes", () => {
  it.each(["Events", "Proposals", "Sponsorships"])("keeps the organization mounted when opening %s", async (tab) => {
    await open("#/organizations/organization-id");
    const trigger = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (button) => button.textContent === tab,
    );
    expect(trigger).toBeDefined();
    await act(async () => {
      trigger!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(location.hash).toContain(`/organizations/organization-id/${tab.toLowerCase()}`);
    expect(container.querySelector('[aria-label="Organization organization-id"]')).not.toBeNull();
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(tab);
  });

  it.each(["events", "proposals", "sponsorships"])("opens a bookmarked %s activity", async (tab) => {
    await open(`#/organizations/organization-id/${tab}`);
    expect(container.querySelector('[aria-label="Organization organization-id"]')).not.toBeNull();
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.toLowerCase()).toBe(tab);
  });
});
