// @vitest-environment jsdom
/**
 * Each domain's analytics page is a reserved address under its section. The
 * section's own `:id` route would read "analytics" as a record's id and open
 * a detail page for a member, an organization or a user that does not exist,
 * so the shell has to resolve the analytics address first.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortalShell } from "../../assets/ts/member-flows/portal/shell/PortalShell";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";

vi.mock("../../assets/ts/member-flows/portal/shell/portal-sections", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  MembershipAnalytics: () => <h2>Membership analytics page</h2>,
  OrganizationAnalytics: () => <h2>Organization analytics page</h2>,
  UserAnalytics: () => <h2>User analytics page</h2>,
  Members: ({ initialMemberSegment }: { initialMemberSegment?: string }) => (
    <h2>Member record page {initialMemberSegment}</h2>
  ),
  Organizations: () => <h2>Organization directory page</h2>,
  OrganizationDetail: () => <h2>Organization record page</h2>,
  Users: ({ userId }: { userId?: string }) => <h2>User record page {userId}</h2>,
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
          JSON.stringify({ groups: [], organizations: [], page: { limit: 12, offset: 0, total: 0, hasMore: false } }),
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

describe("portal analytics addresses", () => {
  it.each([
    ["#/members/analytics", "Membership analytics page"],
    ["#/organizations/analytics", "Organization analytics page"],
    ["#/users/analytics", "User analytics page"],
  ])("resolves %s to its own page rather than a record", async (hash, page) => {
    const content = await open(hash);
    expect(content).toContain(page);
    expect(content).not.toContain("record page");
  });

  it("still opens a record for any other segment", async () => {
    expect(await open("#/users/some-user-id")).toContain("User record page some-user-id");
  });
});
