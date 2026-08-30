// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { myProfileSchema } from "../../assets/shared/schemas/me";
import { organizationRepresentativesListResponseSchema } from "../../assets/shared/schemas/organization-representation";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { MyProfile } from "../../assets/ts/member-flows/portal/sections/MyProfile";
import { profile } from "../../assets/ts/member-flows/portal/state";

vi.mock("../../assets/ts/member-flows/shared/headshot/AdminHeadshotManager", () => ({
  AdminHeadshotManager: () => <div>Headshot</div>,
}));

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/profile", vi.fn()] }));

const organizationId = "00000000-0000-4000-8000-000000000010";
const contactUserId = "00000000-0000-4000-8000-000000000011";
const primaryUserId = "00000000-0000-4000-8000-000000000012";
const coworkerUserId = "00000000-0000-4000-8000-000000000013";
const memberId = "00000000-0000-4000-8000-000000000014";
const blockedUserId = "00000000-0000-4000-8000-000000000015";
const alternateEmailId = "00000000-0000-4000-8000-000000000016";

let container: HTMLDivElement;

function currentProfile(isOrgContact: boolean) {
  return myProfileSchema.parse({
    userId: contactUserId,
    emailId: null,
    email: "contact@example.test",
    emailAddresses: [
      {
        id: null,
        email: "contact@example.test",
        primary: true,
        verifiedAt: "2026-01-01T00:00:00.000Z",
        verificationMethod: "magic_link",
      },
      {
        id: alternateEmailId,
        email: "contact@example.org",
        primary: false,
        verifiedAt: "2026-01-02T00:00:00.000Z",
        verificationMethod: "magic_link",
      },
    ],
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
    headshotUrl: null,
    source: "organization_contact" as const,
    showOnOrganizationProfile,
    joinedAt: now,
    leftAt: blocked ? now : null,
    blockedAt: blocked ? now : null,
    blockedByUserId: blocked ? contactUserId : null,
    createdAt: now,
    updatedAt: now,
    emailId: null,
    jobTitle: null,
    biography: null,
    links: [],
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
  it("updates the selected verified email and profile only for the active organization capacity", async () => {
    const requests: Array<{ method: string; body: unknown }> = [];
    const initial = currentProfile(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : undefined;
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : request!.url,
          location.origin,
        );
        const method = init?.method ?? request?.method ?? "GET";
        if (method === "GET" && url.pathname.endsWith("/representatives")) return json(representativePage());
        if (method === "PATCH" && url.pathname === "/api/v1/users/current") {
          const body = JSON.parse(String(init?.body));
          requests.push({ method, body });
          return json({
            ...initial,
            emailId: alternateEmailId,
            email: "contact@example.org",
            jobTitle: body.jobTitle,
          });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );
    profile.value = initial;
    void act(() => render(<MyProfile />, container));
    await settle();

    const emailSelect = container.querySelector<HTMLSelectElement>("#portal-representation-email")!;
    expect([...emailSelect.options].map((option) => option.textContent)).toEqual([
      "contact@example.test (primary)",
      "contact@example.org",
    ]);
    emailSelect.value = alternateEmailId;
    void act(() => {
      emailSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const jobTitle = [...container.querySelectorAll<HTMLInputElement>("input")].find(
      (input) => input.value === "Officer",
    )!;
    jobTitle.value = "Organization-specific officer";
    void act(() => {
      jobTitle.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = emailSelect.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(requests).toEqual([
      {
        method: "PATCH",
        body: expect.objectContaining({
          emailId: alternateEmailId,
          jobTitle: "Organization-specific officer",
        }),
      },
    ]);
    expect(profile.value).toMatchObject({
      emailId: alternateEmailId,
      email: "contact@example.org",
      jobTitle: "Organization-specific officer",
    });
  });

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
    void act(() =>
      render(
        <>
          <ConfirmDialogHost />
          <MyProfile />
        </>,
        container,
      ),
    );
    await settle();

    expect(container.querySelectorAll('[aria-label="Actions for Coworker Person"]')).toHaveLength(1);
    expect(container.textContent).toContain("Blocked Person");
    expect(container.textContent).toContain("Removed — blocked from re-adding");

    // The "Add a coworker" form stays behind its toolbar action until clicked.
    expect(container.querySelector('input[name="name"]')).toBeNull();
    const addCoworkerButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Add coworker",
    );
    expect(addCoworkerButton).toBeTruthy();
    await act(async () => addCoworkerButton!.click());
    expect(container.textContent).toContain("Add a coworker");
    expect(container.querySelector('input[name="name"]')).not.toBeNull();
    const cancelAddCoworker = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Cancel" && button.closest("form") === null,
    );
    await act(async () => cancelAddCoworker!.click());
    expect(container.querySelector('input[name="name"]')).toBeNull();

    async function openMenu(name: string): Promise<void> {
      const trigger = await waitForElement(() =>
        container.querySelector<HTMLButtonElement>(`[aria-label="Actions for ${name}"]:not(:disabled)`),
      );
      await act(async () => trigger!.click());
    }

    async function clickMenuItem(label: string): Promise<void> {
      const item = await waitForElement(
        () =>
          Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
            (button) => button.textContent?.trim() === label,
          ) ?? null,
      );
      await act(async () => item!.click());
    }

    async function acceptConfirmDialog(confirmLabel: string): Promise<void> {
      const dialog = await waitForElement(() => container.querySelector('[role="alertdialog"]'));
      const confirmButton = Array.from(dialog!.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent === confirmLabel,
      );
      if (!confirmButton) throw new Error(`missing confirm dialog button: ${confirmLabel}`);
      await act(async () => confirmButton.click());
    }

    await openMenu("Coworker Person");
    await clickMenuItem("Show on profile");
    await waitForCondition(
      () => requests.filter((request) => request.url.pathname === "/api/v1/users/current").length === 1,
    );

    await openMenu("Coworker Person");
    await clickMenuItem("Remove from organization");
    await acceptConfirmDialog("Remove from organization");
    await waitForCondition(
      () => requests.filter((request) => request.url.pathname === "/api/v1/users/current").length === 2,
    );

    await openMenu("Blocked Person");
    await clickMenuItem("Restore");
    await acceptConfirmDialog("Restore representative");
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
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
