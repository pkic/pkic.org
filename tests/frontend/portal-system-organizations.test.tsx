// @vitest-environment jsdom
import type { ComponentChildren } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  organizationDetailResponseSchema,
  organizationsListResponseSchema,
} from "../../assets/shared/schemas/organization-management";
import { OrganizationDetail } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationDetail";
import { Organizations } from "../../assets/ts/member-flows/portal/sections/system-organizations/Organizations";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/system/organizations", vi.fn()] }));

const mounted: HTMLElement[] = [];
const organizationId = "00000000-0000-4000-8000-000000000010";
const userId = "00000000-0000-4000-8000-000000000011";

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

function detail() {
  return organizationDetailResponseSchema.parse({
    organization: {
      id: organizationId,
      name: "Example Organization",
      membershipCategory: "F",
      memberSince: "2026-01-01",
      memberCount: 1,
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
      representatives: [
        {
          representativeId: "00000000-0000-4000-8000-000000000012",
          membershipId: "00000000-0000-4000-8000-000000000013",
          userId,
          name: "Ada Lovelace",
          email: "ada@example.test",
          jobTitle: "Engineer",
          links: [],
          status: "active",
          showOnOrgProfile: true,
          isPrimaryContact: true,
          isSecondaryContact: false,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
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
    const fetchMock = vi.fn(async () => json(detail()));
    vi.stubGlobal("fetch", fetchMock);

    const readOnly = mount(
      <OrganizationDetail organizationId={organizationId} canRead canWrite={false} canManageRepresentatives={false} />,
    );
    await settle();
    expect(readOnly.textContent).not.toContain("Edit");
    expect(readOnly.textContent).not.toContain("Add representative");
    expect(readOnly.textContent).not.toContain("Remove");

    const writer = mount(
      <OrganizationDetail organizationId={organizationId} canRead canWrite canManageRepresentatives />,
    );
    await settle();
    expect(writer.textContent).toContain("Edit");
    expect(writer.textContent).toContain("Contacts");
    expect(writer.textContent).toContain("Add representative");
    expect(writer.textContent).toContain("Remove");
  });

  it("submits the canonical representative command and accepts its mutation receipt", async () => {
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
          return json({ success: true, representativeId: "00000000-0000-4000-8000-000000000099" });
        }
        return json(detail());
      }),
    );

    const container = mount(
      <OrganizationDetail organizationId={organizationId} canRead canWrite={false} canManageRepresentatives />,
    );
    await settle();
    const addButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Add representative",
    );
    expect(addButton).toBeTruthy();
    await act(async () => addButton?.click());

    const name = container.querySelector<HTMLInputElement>("#organization-representative-name")!;
    const email = container.querySelector<HTMLInputElement>("#organization-representative-email")!;
    const jobTitle = container.querySelector<HTMLInputElement>("#organization-representative-job-title")!;
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
      path: `/api/v1/organizations/${organizationId}/representatives`,
      body: {
        kind: "email",
        name: "Grace Hopper",
        email: "grace@example.test",
        jobTitle: "Engineer",
        showOnOrganizationProfile: true,
      },
    });
  });
});
