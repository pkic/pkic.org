// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { myProfileSchema } from "../../assets/shared/schemas/me";
import { organizationRepresentativesListResponseSchema } from "../../assets/shared/schemas/organization-representation";
import { MyProfile } from "../../assets/ts/member-flows/portal/sections/MyProfile";
import { profile } from "../../assets/ts/member-flows/portal/state";

vi.mock("../../assets/ts/member-flows/shared/headshot/AdminHeadshotManager", () => ({
  AdminHeadshotManager: () => <div>Headshot</div>,
}));

const organizationId = "00000000-0000-4000-8000-000000000010";
const contactUserId = "00000000-0000-4000-8000-000000000011";
const primaryUserId = "00000000-0000-4000-8000-000000000012";
const coworkerUserId = "00000000-0000-4000-8000-000000000013";
const memberId = "00000000-0000-4000-8000-000000000014";
const blockedUserId = "00000000-0000-4000-8000-000000000015";

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
        memberId,
        organizationId,
        organizationName: "Example Organization",
        membershipCategory: "F",
      },
    ],
  });
}

function representativePage() {
  const now = "2026-01-01T00:00:00.000Z";
  const representative = (
    id: string,
    userId: string,
    userName: string,
    email: string,
    blocked: boolean,
    showOnOrganizationProfile = true,
  ) => ({
    id,
    memberId,
    organizationId,
    organizationName: "Example Organization",
    userId,
    userName,
    email,
    source: "organization_contact" as const,
    showOnOrganizationProfile,
    joinedAt: now,
    leftAt: blocked ? now : null,
    blockedAt: blocked ? now : null,
    blockedByUserId: blocked ? contactUserId : null,
    createdAt: now,
    updatedAt: now,
  });
  return organizationRepresentativesListResponseSchema.parse({
    representatives: [
      representative(
        "00000000-0000-4000-8000-000000000021",
        contactUserId,
        "Contact Person",
        "contact@example.test",
        false,
      ),
      representative(
        "00000000-0000-4000-8000-000000000022",
        primaryUserId,
        "Primary Person",
        "primary@example.test",
        false,
      ),
      representative(
        "00000000-0000-4000-8000-000000000023",
        coworkerUserId,
        "Coworker Person",
        "coworker@example.test",
        false,
        false,
      ),
      representative(
        "00000000-0000-4000-8000-000000000024",
        blockedUserId,
        "Blocked Person",
        "blocked@example.test",
        true,
      ),
    ],
    page: { limit: 25, offset: 0, total: 4, hasMore: false },
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

async function waitForElement<T extends Element>(find: () => T | null): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const element = find();
    if (element) return element;
    await settle();
  }
  throw new Error("Expected element was not rendered.");
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (condition()) return;
    await settle();
  }
  throw new Error("Expected condition was not reached.");
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

  it("uses canonical lifecycle routes to update, block, and restore while protecting self and primary contacts", async () => {
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
        if (url.pathname === "/api/v1/users/current") return json(refreshed);
        if (method === "GET" && url.pathname.endsWith("/representatives")) return json(representativePage());
        if (method === "PATCH") {
          refreshed = currentProfile(true);
          return json({ success: true, representativeId: coworkerUserId });
        }
        if (method === "DELETE") return json({ success: true });
        if (method === "POST" && url.pathname.endsWith("/restore")) return json({ success: true });
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );
    profile.value = refreshed;
    void act(() => render(<MyProfile />, container));
    await settle();

    const visibility = await waitForElement(() =>
      container.querySelector<HTMLInputElement>('[aria-label="Show Coworker Person on organization profile"]'),
    );
    expect(
      Array.from(container.querySelectorAll("button")).filter((button) => button.textContent === "Block"),
    ).toHaveLength(1);
    expect(container.textContent).toContain("Blocked Person");
    expect(container.textContent).toContain("Restore");

    await act(async () => {
      visibility!.checked = true;
      visibility!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitForCondition(
      () => requests.filter((request) => request.url.pathname === "/api/v1/users/current").length === 1,
    );

    const block = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Block Coworker Person as representative"]:not(:disabled)',
      ),
    );
    await act(async () => {
      block!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForCondition(
      () => requests.filter((request) => request.url.pathname === "/api/v1/users/current").length === 2,
    );

    const restore = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Restore Blocked Person as representative"]:not(:disabled)',
      ),
    );
    await act(async () => {
      restore!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForCondition(
      () => requests.filter((request) => request.url.pathname === "/api/v1/users/current").length === 3,
    );

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
        expect.objectContaining({
          url: expect.objectContaining({
            pathname: `/api/v1/organizations/${organizationId}/representatives/${blockedUserId}/restore`,
          }),
          method: "POST",
          body: {},
        }),
      ]),
    );
    expect(requests.some((request) => request.url.pathname.startsWith("/api/v1/admin/organizations"))).toBe(false);
    expect(requests.filter((request) => request.url.pathname === "/api/v1/users/current")).toHaveLength(3);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
