// @vitest-environment jsdom
import type { ComponentChildren } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  organizationDetailResponseSchema,
  organizationsListResponseSchema,
} from "../../assets/shared/schemas/organization-management";
import { identitiesListResponseSchema } from "../../assets/shared/schemas/identity";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { OrganizationDetail } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationDetail";
import { Organizations } from "../../assets/ts/member-flows/portal/sections/system-organizations/Organizations";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/organizations", vi.fn()] }));

const mounted: HTMLElement[] = [];
const organizationId = "00000000-0000-4000-8000-000000000010";
const userId = "00000000-0000-4000-8000-000000000011";
const identityId = "00000000-0000-4000-8000-000000000012";
const membershipId = "00000000-0000-4000-8000-000000000013";

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
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

function detail() {
  return organizationDetailResponseSchema.parse({
    organization: {
      id: organizationId,
      name: "Example Organization",
      membershipCategory: "F",
      memberSince: "2026-01-01",
      activeIdentityCount: 1,
      primaryContactName: "Ada Lovelace",
      primaryContactEmail: "ada@example.test",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      website: "https://example.test",
      description: "Example description",
      slogan: null,
      logoUrl: null,
      contentMarkdown: null,
      blogUrl: null,
      blogFeedUrl: null,
      pressUrl: null,
      pressFeedUrl: null,
      careersUrl: null,
      links: [],
      primaryContactUserId: userId,
      secondaryContactUserId: null,
      identities: [
        {
          identityId,
          membershipId,
          userId,
          name: "Ada Lovelace",
          emailId: null,
          email: "ada@example.test",
          headshotUrl: null,
          jobTitle: "Engineer",
          biography: null,
          links: [],
          state: "active",
          showOnOrgProfile: true,
          isPrimaryContact: true,
          isSecondaryContact: false,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  });
}

function representativePage() {
  return identitiesListResponseSchema.parse({
    identities: [
      {
        id: identityId,
        memberId: membershipId,
        organizationId,
        organizationName: "Example Organization",
        membershipCategory: "F",
        userId,
        userName: "Ada Lovelace",
        emailId: null,
        email: "ada@example.test",
        jobTitle: "Engineer",
        biography: null,
        links: [],
        headshotUrl: null,
        source: "staff",
        state: "active",
        showOnOrganizationProfile: true,
        invitedAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:00.000Z",
        endedAt: null,
        blockedAt: null,
        blockedByUserId: null,
        predecessorIdentityId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    page: { limit: 25, offset: 0, total: 1, hasMore: false },
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function dialogButton(root: HTMLElement, label: string): HTMLButtonElement {
  const dialog = root.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("no confirm dialog is open");
  const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`missing dialog button: ${label}`);
  return button;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal System Organizations", () => {
  it("does not request organization records for a membership writer without organizations:read", async () => {
    const fetchMock = vi.fn(async () => json(detail()));
    vi.stubGlobal("fetch", fetchMock);

    const container = mount(<Organizations canRead={false} canCreate />);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Add organization");
    expect(container.textContent).not.toContain("No organizations found");
  });

  it("lists through the canonical organization API and hides creation without membership:write", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return json(
          organizationsListResponseSchema.parse({
            organizations: [detail().organization],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          }),
        );
      }),
    );

    const container = mount(<Organizations canRead canCreate={false} />);
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe("/api/v1/organizations");
    expect(requests.some((request) => request.pathname.startsWith("/api/v1/admin/organizations"))).toBe(false);
    expect(container.textContent).toContain("Example Organization");
    expect(container.textContent).not.toContain("Add organization");
  });

  it("shows organization mutations only for their exact permissions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      return json(url.pathname.endsWith("/identities") ? representativePage() : detail());
    });
    vi.stubGlobal("fetch", fetchMock);

    const readOnly = mount(
      <OrganizationDetail organizationId={organizationId} canRead canWrite={false} canManageIdentities={false} />,
    );
    await settle();
    await settle();
    expect(readOnly.textContent).not.toContain("Edit");
    expect(readOnly.textContent).not.toContain("Add new person");
    expect(readOnly.textContent).not.toContain("Link existing user");
    expect(readOnly.textContent).not.toContain("Remove");

    const writer = mount(<OrganizationDetail organizationId={organizationId} canRead canWrite canManageIdentities />);
    const menuTrigger = await waitForElement(() =>
      writer.querySelector<HTMLButtonElement>('[aria-label="Actions for Ada Lovelace"]'),
    );
    expect(writer.textContent).toContain("Edit");
    expect(writer.textContent).toContain("Contacts");
    expect(writer.textContent).toContain("Add new person");
    expect(writer.textContent).toContain("Link existing user");
    expect(writer.textContent).toContain("Active");

    await act(async () => menuTrigger!.click());
    expect(writer.textContent).toContain("End identity");
  });

  it("submits the canonical identity invitation command and accepts its mutation receipt", async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? request?.method ?? "GET";
        const rawBody = init?.body ?? (request ? await request.clone().text() : null);
        requests.push({
          method,
          path: url.pathname,
          body: typeof rawBody === "string" && rawBody ? JSON.parse(rawBody) : null,
        });
        if (method === "POST") {
          return json({
            success: true,
            identityId: "00000000-0000-4000-8000-000000000099",
            state: "pending",
          });
        }
        if (url.pathname.endsWith("/identities")) return json(representativePage());
        return json(detail());
      }),
    );

    const container = mount(
      <OrganizationDetail organizationId={organizationId} canRead canWrite={false} canManageIdentities />,
    );
    await settle();
    const addButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Add new person",
    );
    expect(addButton).toBeTruthy();
    await act(async () => addButton?.click());

    const name = container.querySelector<HTMLInputElement>("#organization-identity-name")!;
    const email = container.querySelector<HTMLInputElement>("#organization-identity-email")!;
    const jobTitle = container.querySelector<HTMLInputElement>("#organization-identity-job-title")!;
    for (const [input, value] of [
      [name, "Grace Hopper"],
      [email, "grace@example.test"],
      [jobTitle, "Engineer"],
    ] as const) {
      input.value = value;
      await act(() => {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    await act(async () => {
      container
        .querySelector<HTMLFormElement>("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(requests.find((request) => request.method === "POST")).toEqual({
      method: "POST",
      path: `/api/v1/organizations/${organizationId}/identities`,
      body: {
        userReference: "email",
        name: "Grace Hopper",
        email: "grace@example.test",
        jobTitle: "Engineer",
        showOnOrganizationProfile: true,
      },
    });
  });

  it("ends an identity through the row menu only after the named confirmation is accepted", async () => {
    const requests: Array<{ method: string; path: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? "GET";
        requests.push({ method, path: url.pathname });
        if (method === "PATCH") return json({ success: true, identityId, state: "ended" });
        return json(url.pathname.endsWith("/identities") ? representativePage() : detail());
      }),
    );

    const container = mount(
      <>
        <ConfirmDialogHost />
        <OrganizationDetail organizationId={organizationId} canRead canWrite canManageIdentities />
      </>,
    );
    const menuTrigger = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="Actions for Ada Lovelace"]'),
    );
    await act(async () => menuTrigger!.click());
    const removeItem = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === "End identity",
    );
    if (!removeItem) throw new Error("missing End identity menu item");
    await act(async () => removeItem.click());

    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("End Ada Lovelace's identity for this organization?");
    expect(requests.some((request) => request.method === "PATCH")).toBe(false);

    await act(async () => dialogButton(container, "End identity").click());
    await settle();

    expect(requests).toContainEqual({
      method: "PATCH",
      path: `/api/v1/organizations/${organizationId}/identities/${identityId}`,
    });
  });

  it("keeps the identity active when the end confirmation is cancelled", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      return json(url.pathname.endsWith("/identities") ? representativePage() : detail());
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = mount(
      <>
        <ConfirmDialogHost />
        <OrganizationDetail organizationId={organizationId} canRead canWrite canManageIdentities />
      </>,
    );
    const menuTrigger = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="Actions for Ada Lovelace"]'),
    );
    await act(async () => menuTrigger!.click());
    const removeItem = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === "End identity",
    );
    if (!removeItem) throw new Error("missing End identity menu item");
    const callsBeforeCancel = fetchMock.mock.calls.length;
    await act(async () => removeItem.click());

    await act(async () => dialogButton(container, "Cancel").click());
    await settle();

    expect(fetchMock.mock.calls.length).toBe(callsBeforeCancel);
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
