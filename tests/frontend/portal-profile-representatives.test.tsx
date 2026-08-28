// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { myProfileSchema } from "../../assets/shared/schemas/me";
import { MyProfile } from "../../assets/ts/member-flows/portal/sections/MyProfile";
import { profile } from "../../assets/ts/member-flows/portal/state";

vi.mock("../../assets/ts/member-flows/shared/headshot/AdminHeadshotManager", () => ({
  AdminHeadshotManager: () => <div>Headshot</div>,
}));

const organizationId = "00000000-0000-4000-8000-000000000010";
const contactUserId = "00000000-0000-4000-8000-000000000011";
const primaryUserId = "00000000-0000-4000-8000-000000000012";
const coworkerUserId = "00000000-0000-4000-8000-000000000013";

let container: HTMLDivElement;

function currentProfile(isOrgContact: boolean) {
  return myProfileSchema.parse({
    userId: contactUserId,
    email: "contact@example.test",
    firstName: "Contact",
    lastName: "Person",
    preferredName: null,
    jobTitle: "Officer",
    biography: null,
    links: [],
    membershipCategory: "F",
    organizationId,
    organizationName: "Example Organization",
    memberSince: "2026-01-01",
    showOnOrgProfile: true,
    headshotUrl: null,
    canEditOrganizationName: false,
    isOrgContact,
    organizationRepresentatives: [
      {
        userId: contactUserId,
        name: "Contact Person",
        email: "contact@example.test",
        showOnOrgProfile: true,
        isPrimaryContact: false,
        isSecondaryContact: true,
      },
      {
        userId: primaryUserId,
        name: "Primary Person",
        email: "primary@example.test",
        showOnOrgProfile: true,
        isPrimaryContact: true,
        isSecondaryContact: false,
      },
      {
        userId: coworkerUserId,
        name: "Coworker Person",
        email: "coworker@example.test",
        showOnOrgProfile: false,
        isPrimaryContact: false,
        isSecondaryContact: false,
      },
    ],
    activeMemberships: [
      {
        memberId: "00000000-0000-4000-8000-000000000014",
        organizationId,
        organizationName: "Example Organization",
        membershipCategory: "F",
      },
    ],
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  profile.value = null;
  vi.unstubAllGlobals();
});

describe("portal organization-contact representative controls", () => {
  it("does not expose contact actions to an ordinary representative", () => {
    profile.value = currentProfile(false);
    void act(() => render(<MyProfile />, container));

    expect(container.textContent).not.toContain("Add a coworker");
    expect(
      Array.from(container.querySelectorAll("button")).filter((button) => button.textContent === "Remove"),
    ).toHaveLength(0);
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(1);
  });

  it("uses the canonical route for contact-authorized visibility and removal, while protecting self and primary contacts", async () => {
    const requests: Array<{ url: URL; method: string; body: unknown }> = [];
    let refreshed = currentProfile(true);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : undefined;
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : request!.url,
          location.origin,
        );
        const method = init?.method ?? request?.method ?? "GET";
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ url, method, body });
        if (url.pathname === "/api/v1/me") return json(refreshed);
        if (method === "PATCH") {
          refreshed = currentProfile(true);
          return json({ success: true, representativeId: coworkerUserId });
        }
        if (method === "DELETE") return json({ success: true });
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );
    profile.value = refreshed;
    void act(() => render(<MyProfile />, container));

    const visibility = container.querySelector<HTMLInputElement>(
      `#organization-representative-visibility-${coworkerUserId}`,
    );
    expect(visibility).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll("button")).filter((button) => button.textContent === "Remove"),
    ).toHaveLength(1);

    await act(async () => {
      visibility!.checked = true;
      visibility!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    const remove = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Remove");
    await act(async () => {
      remove!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: expect.objectContaining({
            pathname: `/api/v1/organizations/${organizationId}/representatives/${coworkerUserId}`,
          }),
          method: "PATCH",
          body: { showOnOrganizationProfile: true },
        }),
        expect.objectContaining({
          url: expect.objectContaining({
            pathname: `/api/v1/organizations/${organizationId}/representatives/${coworkerUserId}`,
          }),
          method: "DELETE",
        }),
      ]),
    );
    expect(requests.some((request) => request.url.pathname.startsWith("/api/v1/admin/organizations"))).toBe(false);
    expect(requests.filter((request) => request.url.pathname === "/api/v1/me")).toHaveLength(2);
  });
});
