// @vitest-environment jsdom
import type { ComponentChildren } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  organizationCreateSchema,
  organizationDetailResponseSchema,
  organizationManagementUpdateSchema,
  organizationsListResponseSchema,
} from "../../assets/shared/schemas/organization-management";
import { identitiesListResponseSchema, identityCreateSchema } from "../../assets/shared/schemas/identity";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import {
  buttonNamed,
  buttonNames,
  chooseOption,
  controlFor,
  groupNames,
  namedGroup,
  submitForm,
  typeInto,
} from "./helpers/labelled-control";
import { OrganizationCreateForm } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationCreateForm";
import { OrganizationDetail } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationDetail";
import { OrganizationProfile } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationProfile";
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
      return json(url.pathname.endsWith("/identities") ? identityPage() : detail());
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
        if (url.pathname.endsWith("/identities")) return json(identityPage());
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
      return json(url.pathname.endsWith("/identities") ? identityPage() : detail());
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

describe("portal organization create form", () => {
  it("names every control through a label and posts the shared create contract", async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
        const rawBody = init?.body;
        requests.push({
          method: init?.method ?? "GET",
          path: url.pathname,
          body: typeof rawBody === "string" ? JSON.parse(rawBody) : null,
        });
        return json(detail());
      }),
    );
    const onCreated = vi.fn();
    const container = mount(<OrganizationCreateForm onCreated={onCreated} onCancel={vi.fn()} />);

    // The surface is addressable by name rather than by a container class,
    // which is what the end-to-end specs now rely on.
    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Add organization");

    await typeInto(controlFor(container, "Organization name"), "Example Organization");
    await typeInto(controlFor(container, "Member since"), "2026-01-15");
    await typeInto(controlFor(container, "Website"), "https://example.test");
    await chooseOption(controlFor(container, "Membership category"), "F");

    const identity = namedGroup(container, "Identity 1");
    await typeInto(controlFor(identity, "Name"), "Ada Lovelace");
    await typeInto(controlFor(identity, "Email"), "ada@example.test");
    await typeInto(controlFor(identity, "Job title"), "Engineer");
    await typeInto(controlFor(container, "Immediate activation reason"), "Initial setup");

    await submitForm(container);

    const posted = requests.find((request) => request.method === "POST");
    expect(posted?.path).toBe("/api/v1/organizations");
    expect(organizationCreateSchema.parse(posted?.body)).toEqual({
      name: "Example Organization",
      website: "https://example.test",
      membershipCategory: "F",
      memberSince: "2026-01-15",
      identities: [{ name: "Ada Lovelace", email: "ada@example.test", jobTitle: "Engineer" }],
      workingGroupSlugs: [],
      activationReason: "Initial setup",
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("adds and removes identity groups, each announced by its own legend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(detail())),
    );
    const container = mount(<OrganizationCreateForm onCreated={vi.fn()} onCancel={vi.fn()} />);

    expect(groupNames(container)).toEqual(["Initial identities", "Identity 1"]);
    // A single identity cannot be removed, so no orphan remove control.
    expect(buttonNames(container)).not.toContain("Remove identity 1");

    await act(async () => buttonNamed(container, "Add identity").click());
    expect(groupNames(container)).toEqual(["Initial identities", "Identity 1", "Identity 2"]);

    await act(async () => buttonNamed(container, "Remove identity 2").click());
    expect(groupNames(container)).toEqual(["Initial identities", "Identity 1"]);
  });

  it("announces a rejected creation as a blocking alert and keeps the draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "NAME_TAKEN", message: "That name is already in use." } }), {
            status: 409,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const onCreated = vi.fn();
    const container = mount(<OrganizationCreateForm onCreated={onCreated} onCancel={vi.fn()} />);

    await typeInto(controlFor(container, "Organization name"), "Example Organization");
    await submitForm(container);

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("That name is already in use.");
    expect(onCreated).not.toHaveBeenCalled();
    expect(controlFor(container, "Organization name").value).toBe("Example Organization");
  });
});

describe("portal organization profile", () => {
  it("presents the read-only record as a term/value list inside a named region", () => {
    const container = mount(
      <OrganizationProfile organization={detail().organization} canWrite={false} onSaved={() => Promise.resolve()} />,
    );

    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Profile");
    const list = container.querySelector("dl");
    expect(list?.className).toContain("pk-datalist");
    const terms = [...container.querySelectorAll("dt")].map((term) => term.textContent);
    expect(terms).toEqual([
      "Membership category",
      "Website",
      "Slogan",
      "Description",
      "Blog",
      "Press",
      "Careers",
      "Member since",
      "Created",
    ]);
    expect(container.querySelectorAll("dd")).toHaveLength(terms.length);
    // The category reads as a word, not as a colour: the badge carries text.
    expect(container.querySelector(".pk-badge")?.textContent).toBe("F");
    expect(container.textContent).not.toContain("Contacts");
    expect(container.querySelector("table")).toBeNull();
  });

  it("patches the shared update contract from label-addressed controls", async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
        const rawBody = init?.body;
        requests.push({
          method: init?.method ?? "GET",
          path: url.pathname,
          body: typeof rawBody === "string" ? JSON.parse(rawBody) : null,
        });
        return json(detail());
      }),
    );
    const onSaved = vi.fn(() => Promise.resolve());
    const container = mount(<OrganizationProfile organization={detail().organization} canWrite onSaved={onSaved} />);

    await act(async () => buttonNamed(container, "Edit").click());

    await typeInto(controlFor(container, "Slogan"), "Trust, verified");
    await submitForm(container);

    const patched = requests.find((request) => request.method === "PATCH");
    expect(patched?.path).toBe(`/api/v1/organizations/${organizationId}`);
    const parsed = organizationManagementUpdateSchema.parse(patched?.body);
    expect(parsed.slogan).toBe("Trust, verified");
    expect(parsed.name).toBe("Example Organization");
    expect(parsed.membershipCategory).toBe("F");
    expect(parsed.revision).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.blogUrl).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("keeps the editor open and announces a rejected save", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "STALE_REVISION", message: "Someone else saved first." } }), {
            status: 409,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const onSaved = vi.fn(() => Promise.resolve());
    const container = mount(<OrganizationProfile organization={detail().organization} canWrite onSaved={onSaved} />);

    await act(async () => buttonNamed(container, "Edit").click());
    await typeInto(controlFor(container, "Slogan"), "Trust, verified");
    await submitForm(container);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Someone else saved first.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(controlFor(container, "Slogan").value).toBe("Trust, verified");
  });
});
