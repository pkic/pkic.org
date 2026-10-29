// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { JoinPrompt } from "../../assets/ts/member-flows/portal/sections/JoinPrompt";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { myProfileSchema } from "../../assets/shared/schemas/me";

let host: HTMLDivElement;
afterEach(() => {
  if (host) {
    void act(() => render(null, host));
    host.remove();
  }
  portalSession.value = null;
  vi.unstubAllGlobals();
});
function stubStatus({ member = false, applications = 0, fail = false } = {}) {
  const session = portalSessionFixture({});
  portalSession.value = session;
  const person = myProfileSchema.parse({
    userId: session.identity.id,
    identityId: null,
    emailId: null,
    email: session.identity.email,
    emailAddresses: [],
    firstName: null,
    lastName: null,
    preferredName: null,
    jobTitle: null,
    biography: null,
    links: [],
    membershipCategory: null,
    organizationId: null,
    organizationName: null,
    memberSince: null,
    showOnOrgProfile: false,
    headshotUrl: null,
    isOrgContact: false,
    organizationIdentities: null,
    activeIdentities: member ? portalSessionFixture({ member: true }).member!.activeIdentities : [],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      if (fail) throw new Error("Unavailable");
      const url = new URL(String(input), location.origin);
      const body = url.pathname.endsWith("/applications")
        ? {
            applications: applications
              ? [{ id: "a1", stage: "submitted", membershipCategory: "H6", createdAt: "2026-10-29T10:00:00.000Z" }]
              : [],
            page: { limit: 1, offset: 0, total: applications, hasMore: applications > 0 },
          }
        : person;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
}
async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<JoinPrompt />, host));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
it("offers the verified public join flow to a non-member without submitting or choosing an applicant kind", async () => {
  stubStatus();
  await mount();
  expect(host.querySelector('a[href="/join/"]')).not.toBeNull();
  expect(host.querySelector("form")).toBeNull();
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});
it.each([{ member: true }, { applications: 1 }, { fail: true }])(
  "hides the invitation for existing membership, applications, or failed eligibility: %j",
  async (status) => {
    stubStatus(status);
    await mount();
    expect(host.querySelector('a[href="/join/"]')).toBeNull();
  },
);
it("shows someone who has applied their application and where to follow it, not the invitation", async () => {
  stubStatus({ applications: 1 });
  await mount();
  expect(host.textContent).toContain("Your membership application");
  expect(host.textContent).toContain("Status: Submitted");
  expect(host.querySelector('a[href$="#/application"]')?.textContent).toBe("View application");
  expect(host.querySelector('a[href="/join/"]')).toBeNull();
});
it("does not query eligibility or flash an invitation for an existing member", async () => {
  stubStatus();
  portalSession.value = portalSessionFixture({ member: true });
  await mount();
  expect(fetch).not.toHaveBeenCalled();
  expect(host.textContent).toBe("");
});
