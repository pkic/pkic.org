// @vitest-environment jsdom
/**
 * The organization create and profile forms.
 *
 * Split from the directory suite, which is about listing and navigating
 * organizations. These are about editing one — a different surface, a
 * different set of failure paths.
 */
import type { ComponentChildren } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  organizationCreateSchema,
  organizationDetailResponseSchema,
  organizationManagementUpdateSchema,
} from "../../assets/shared/schemas/organization-management";
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
import { OrganizationProfile } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationProfile";

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
    // The create page needs the created record's address, so the callback
    // carries the id the response returned rather than a bare signal.
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(detail().organization.id);
  });

  it("adds and removes identity groups, each announced by its own legend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(detail())),
    );
    const container = mount(<OrganizationCreateForm onCreated={vi.fn()} onCancel={vi.fn()} />);

    // Each identity carries its own link editor, which is several controls and
    // so is named by a legend of its own inside the identity it belongs to.
    expect(groupNames(container)).toEqual(["Initial identities", "Identity 1", "Profile links"]);
    // A single identity cannot be removed, so no orphan remove control.
    expect(buttonNames(container)).not.toContain("Remove identity 1");

    await act(async () => buttonNamed(container, "Add identity").click());
    expect(groupNames(container)).toEqual([
      "Initial identities",
      "Identity 1",
      "Profile links",
      "Identity 2",
      "Profile links",
    ]);

    await act(async () => buttonNamed(container, "Remove identity 2").click());
    expect(groupNames(container)).toEqual(["Initial identities", "Identity 1", "Profile links"]);
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
    // The membership category is not among them: it qualifies the record's
    // subject, so the page states it once, as a badge beside the organization's
    // name. `portal-organization-detail-shell` holds that end of the contract.
    expect(terms).toEqual(["Website", "Slogan", "Description", "Blog", "Press", "Careers", "Member since", "Created"]);
    expect(container.querySelectorAll("dd")).toHaveLength(terms.length);
    // An absent value is a dash rather than an empty cell, and the list — not
    // this surface — decides what one looks like. The fixture has no slogan.
    const slogan = container.querySelectorAll("dd")[1];
    expect(slogan?.textContent).toBe("—");
    // A stored URL is the link it is, so the record is navigable rather than
    // eight lines of text to copy out by hand.
    expect(container.querySelector<HTMLAnchorElement>("dd a")?.href).toBe("https://example.test/");
    // Contacts are a separate, secondary region the page places itself; the
    // record panel no longer renders them from the inside.
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
