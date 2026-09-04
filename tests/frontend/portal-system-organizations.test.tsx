// @vitest-environment jsdom
import type { ComponentChildren } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  organizationDetailResponseSchema,
  organizationsListResponseSchema,
} from "../../assets/shared/schemas/organization-management";
import { identitiesListResponseSchema, identityCreateSchema } from "../../assets/shared/schemas/identity";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { controlFor, namedGroup, typeInto } from "./helpers/labelled-control";
import { OrganizationDetail } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationDetail";
import { Organizations } from "../../assets/ts/member-flows/portal/sections/system-organizations/Organizations";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/organizations", navigate] }));

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

function identityPage() {
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
  navigate.mockReset();
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
    // Nothing to list, but the one command the account holds is still offered
    // — and it goes to the create page rather than opening a form here.
    expect(container.textContent).toContain("Add organization");
    expect(container.textContent).not.toContain("No organizations found");
    const create = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Add organization",
    );
    await act(async () => {
      create?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(navigate).toHaveBeenCalledWith("/organizations/new");
  });

  it("sends Add organization to its own address instead of unfolding a form above the table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          organizationsListResponseSchema.parse({
            organizations: [detail().organization],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          }),
        ),
      ),
    );

    const container = mount(<Organizations canRead canCreate />);
    await settle();

    const create = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Add organization",
    );
    expect(create).not.toBeUndefined();
    await act(async () => {
      create?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(navigate).toHaveBeenCalledWith("/organizations/new");
    // The click navigates and nothing else: this mount still shows the table.
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("tbody tr")).not.toBeNull();
  });

  it("renders the reserved new segment as the create page, alone on the screen", async () => {
    const fetchMock = vi.fn(async () => json(detail()));
    vi.stubGlobal("fetch", fetchMock);

    const container = mount(<Organizations canRead canCreate organizationSegment="new" />);
    await settle();

    // The create page names what is being created and does not list anything,
    // so the directory is never fetched while it is open.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Add organization");
    expect(container.querySelector("table")).toBeNull();

    const back = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "← All organizations",
    );
    expect(back).not.toBeUndefined();
    await act(async () => {
      back?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(navigate).toHaveBeenCalledWith("/organizations");
  });

  it("returns an account that cannot create from the new segment to the directory", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          organizationsListResponseSchema.parse({
            organizations: [],
            page: { limit: 50, offset: 0, total: 0, hasMore: false },
          }),
        ),
      ),
    );

    mount(<Organizations canRead canCreate={false} organizationSegment="new" />);
    await settle();

    expect(navigate).toHaveBeenCalledWith("/organizations");
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

  it("names the organization table and gives each row a real link to open it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          organizationsListResponseSchema.parse({
            organizations: [detail().organization],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          }),
        ),
      ),
    );

    const container = mount(<Organizations canRead canCreate={false} />);
    await settle();

    // Several unnamed tables on a page are announced as several tables.
    expect(container.querySelector("caption")?.textContent).toBe("Organizations");
    // The row is activated by a real control that says where it goes, not by
    // a click handler on the `<tr>` that no keyboard can reach.
    const rowLink = container.querySelector<HTMLAnchorElement>("tbody a.pk-table__row-link");
    expect(rowLink?.textContent).toBe("Open Example Organization");
  });

  it("says an absent category and an absent contact in words, not in a red or grey tint", async () => {
    const organization = { ...detail().organization, membershipCategory: null, primaryContactName: null };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          organizationsListResponseSchema.parse({
            organizations: [organization],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          }),
        ),
      ),
    );

    const container = mount(<Organizations canRead canCreate={false} />);
    await settle();

    const row = container.querySelector("tbody tr");
    expect(row?.textContent).toContain("Not set");
    expect(row?.textContent).toContain("None");
    // Neither absence is carried by a colour class any more.
    expect(row?.querySelector("[class*='text-danger']")).toBeNull();
    expect(row?.querySelector("[class*='fst-italic']")).toBeNull();
  });

  it("announces a failed organization list as a sentence rather than an empty table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "unavailable" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const container = mount(<Organizations canRead canCreate={false} />);
    await settle();

    const alert = container.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("The service is temporarily unavailable.");
  });

  it("shows organization mutations only for their exact permissions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      return json(url.pathname.endsWith("/identities") ? identityPage() : detail());
    });
    vi.stubGlobal("fetch", fetchMock);

    const readOnly = mount(
      <OrganizationDetail
        organizationId={organizationId}
        canRead
        canWrite={false}
        canManageIdentities={false}
        canReadSponsorships={false}
      />,
    );
    await settle();
    await settle();
    // The commands live in menus now, and a reader who may not use them is
    // offered no menu at all — not a menu of disabled items.
    expect(readOnly.querySelector('button[aria-label="Record actions"]')).toBeNull();
    expect(readOnly.textContent).not.toContain("Remove");
    await settle();
    expect(readOnly.querySelector('button[aria-label="Representative settings"]')).toBeNull();

    const writer = mount(
      <OrganizationDetail
        organizationId={organizationId}
        canRead
        canWrite
        canManageIdentities
        canReadSponsorships={false}
      />,
    );
    await settle();
    expect(writer.querySelector('button[aria-label="Record actions"]')).not.toBeNull();
    expect(writer.textContent).toContain("Contacts");
    // Reading another facet is a tab away, and its bounded query runs then.
    const menuTrigger = await waitForElement(() =>
      writer.querySelector<HTMLButtonElement>('[aria-label="Actions for Ada Lovelace"]'),
    );
    expect(writer.querySelector('button[aria-label="Representative settings"]')).not.toBeNull();
    expect(writer.textContent).toContain("Active");

    await act(async () => menuTrigger.click());
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
        if (url.pathname.endsWith("/identities")) return json(identityPage());
        return json(detail());
      }),
    );

    const container = mount(
      <OrganizationDetail
        organizationId={organizationId}
        canRead
        canWrite={false}
        canManageIdentities
        canReadSponsorships={false}
      />,
    );
    await settle();
    const rosterMenu = container.querySelector<HTMLButtonElement>('button[aria-label="Representative settings"]');
    expect(rosterMenu).toBeTruthy();
    await act(async () => rosterMenu?.click());
    const addCommand = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent === "Add a new person…",
    );
    expect(addCommand).toBeTruthy();
    await act(async () => addCommand?.click());

    // The add form's controls are reached through the `<legend>` naming the
    // group and the `for`/`id` pair on each label, so the lookup fails exactly
    // when that contract does. The surface no longer hands out hand-written
    // ids for a test to select on.
    const addForm = namedGroup(container, "New person");
    for (const [label, value] of [
      ["Name", "Grace Hopper"],
      ["Email", "grace@example.test"],
      ["Job title", "Engineer"],
    ] as const) {
      await typeInto(controlFor(addForm, label), value);
    }
    await act(async () => {
      container
        .querySelector<HTMLFormElement>("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const posted = requests.find((request) => request.method === "POST");
    expect(posted?.path).toBe(`/api/v1/organizations/${organizationId}/identities`);
    expect(identityCreateSchema.parse(posted?.body)).toEqual({
      userReference: "email",
      name: "Grace Hopper",
      email: "grace@example.test",
      jobTitle: "Engineer",
      activation: { mode: "invitation" },
      showOnOrganizationProfile: true,
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
        return json(url.pathname.endsWith("/identities") ? identityPage() : detail());
      }),
    );

    const container = mount(
      <>
        <ConfirmDialogHost />
        <OrganizationDetail
          organizationId={organizationId}
          canRead
          canWrite
          canManageIdentities
          canReadSponsorships={false}
        />
      </>,
    );
    const menuTrigger = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="Actions for Ada Lovelace"]'),
    );
    await act(async () => menuTrigger.click());
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
      return json(url.pathname.endsWith("/identities") ? identityPage() : detail());
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = mount(
      <>
        <ConfirmDialogHost />
        <OrganizationDetail
          organizationId={organizationId}
          canRead
          canWrite
          canManageIdentities
          canReadSponsorships={false}
        />
      </>,
    );
    const menuTrigger = await waitForElement(() =>
      container.querySelector<HTMLButtonElement>('[aria-label="Actions for Ada Lovelace"]'),
    );
    await act(async () => menuTrigger.click());
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
