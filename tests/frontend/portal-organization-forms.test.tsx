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
  chooseOption,
  controlFor,
  groupNames,
  labelNames,
  namedGroup,
  submitForm,
  typeInto,
} from "./helpers/labelled-control";
import { OrganizationCreateForm } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationCreateForm";
import {
  OrganizationAbout,
  OrganizationLinks,
} from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationProfile";
import { OrganizationDetail } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationDetail";

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

    const organizationGroup = namedGroup(container, "Details");
    await typeInto(controlFor(organizationGroup, "Organization name"), "Example Organization");
    await typeInto(controlFor(organizationGroup, "Member since"), "2026-01-15");
    await chooseOption(controlFor(organizationGroup, "Membership category"), "F");

    // The website and the additional links are one concept, grouped as the
    // organization's web presence rather than scattered through the form.
    const webPresence = namedGroup(container, "Web presence");
    await typeInto(controlFor(webPresence, "Website"), "https://example.test");
    const linkInput = webPresence.querySelector<HTMLInputElement>('[aria-label="Additional organization URL"]');
    if (!linkInput) throw new Error("missing organization link input");
    await typeInto(linkInput, "https://www.linkedin.com/company/example");
    const addLink = webPresence.querySelector<HTMLButtonElement>('[aria-label="Add profile link"]');
    await act(async () => addLink?.click());
    // The chip carries the automatic hostname label the help text promises.
    expect(webPresence.textContent).toContain("LinkedIn");

    await act(async () => buttonNamed(container, "Add person").click());
    const person = namedGroup(container, "Person 1");
    await typeInto(controlFor(person, "Name"), "Ada Lovelace");
    await typeInto(controlFor(person, "Email"), "ada@example.test");
    await typeInto(controlFor(person, "Job title"), "Engineer");
    await typeInto(controlFor(container, "Reason for activating without an invitation"), "Initial setup");

    await submitForm(container);

    const posted = requests.find((request) => request.method === "POST");
    expect(posted?.path).toBe("/api/v1/organizations");
    expect(organizationCreateSchema.parse(posted?.body)).toEqual({
      name: "Example Organization",
      website: "https://example.test",
      links: ["https://www.linkedin.com/company/example"],
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

  it("creates an organization with no people and sends no activation reason", async () => {
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

    await typeInto(controlFor(container, "Organization name"), "Example Organization");
    await submitForm(container);

    const posted = requests.find((request) => request.method === "POST");
    const parsed = organizationCreateSchema.parse(posted?.body);
    expect(parsed.identities).toEqual([]);
    // No one is being activated, so no reason is demanded — or sent.
    expect(parsed.activationReason).toBeUndefined();
    expect(onCreated).toHaveBeenCalledWith(detail().organization.id);
  });

  it("asks for the activation reason exactly while a person is on the form, and requires it then", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(detail())),
    );
    const container = mount(<OrganizationCreateForm onCreated={vi.fn()} onCancel={vi.fn()} />);
    const reasonLabel = "Reason for activating without an invitation";

    // With nobody to activate there is nothing to justify, so the field is
    // absent rather than disabled or optional.
    expect(labelNames(container)).not.toContain(reasonLabel);

    await act(async () => buttonNamed(container, "Add person").click());
    const reason = controlFor(container, reasonLabel);
    expect(reason.required).toBe(true);

    await act(async () => buttonNamed(container, "Remove person 1").click());
    expect(labelNames(container)).not.toContain(reasonLabel);
  });

  it("adds and removes person cards, each announced by its own legend", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(detail())),
    );
    const container = mount(<OrganizationCreateForm onCreated={vi.fn()} onCancel={vi.fn()} />);

    // The form is three named groups in one column, and it starts with no
    // person cards: an organization can exist before anyone represents it.
    expect(groupNames(container)).toEqual(["Details", "Web presence", "People"]);

    await act(async () => buttonNamed(container, "Add person").click());
    await act(async () => buttonNamed(container, "Add person").click());
    expect(groupNames(container)).toEqual(["Details", "Web presence", "People", "Person 1", "Person 2"]);
    // A quick-create is not the place to curate someone's LinkedIn: the card
    // holds name, email, and job title, and links are added later on the
    // person. No per-person link editor, so no rival "Profile links" group.
    expect(groupNames(container)).not.toContain("Profile links");

    await act(async () => buttonNamed(container, "Remove person 2").click());
    expect(groupNames(container)).toEqual(["Details", "Web presence", "People", "Person 1"]);
    await act(async () => buttonNamed(container, "Remove person 1").click());
    expect(groupNames(container)).toEqual(["Details", "Web presence", "People"]);
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
  it("presents what the organization says about itself as prose inside a named region", () => {
    const container = mount(<OrganizationAbout organization={detail().organization} />);

    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("About");
    // Prose is prose: no term/value rows announcing "Description" as a field,
    // no table, no inputs while reading.
    expect(container.querySelector("dl")).toBeNull();
    expect(container.querySelector("input, textarea")).toBeNull();
    expect(container.textContent).not.toContain("Member since");
    expect(container.textContent).not.toContain("Contacts");
  });

  it("names each stored URL for what it is, under the mark", () => {
    const container = mount(<OrganizationLinks organization={detail().organization} />);
    // A stored URL is paired with the term that names it, rather than shown as
    // eight lines of text to copy out by hand; absent ones are not listed.
    const terms = [...container.querySelectorAll("dl.pk-datalist > dt")].map((term) => term.textContent);
    expect(terms).toEqual(["Website"]);
    const links = [...container.querySelectorAll<HTMLAnchorElement>("dl.pk-datalist a")];
    expect(links[0]?.href).toBe("https://example.test/");
    // The scheme is not read out: it is the same on every row and the address
    // is what a reader is scanning for.
    expect(links[0]?.textContent).toBe("example.test");
  });

  /**
   * Enters the record's edit mode.
   *
   * Editing is a command on the record, so it lives in the header's menu
   * rather than as a button beside the name — the same place the contact
   * record keeps its own.
   */
  async function openEditMode(container: HTMLElement): Promise<void> {
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Record actions"]');
    if (!trigger) throw new Error("the record offers no actions menu");
    await act(async () => trigger.click());
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === "Edit organization…",
    );
    if (!item) throw new Error('the record offers no "Edit organization…"');
    await act(async () => item.click());
  }

  function stubAccount(onPatch: (body: unknown) => Response) {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString(), location.origin);
        const method = init?.method ?? "GET";
        const rawBody = init?.body;
        const body = typeof rawBody === "string" ? JSON.parse(rawBody) : null;
        requests.push({ method, path: url.pathname, body });
        if (method === "PATCH") return onPatch(body);
        if (url.pathname.endsWith("/identities")) {
          return json({ identities: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
        }
        if (url.pathname.endsWith("/groups")) {
          return json({ groups: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
        }
        return json(detail());
      }),
    );
    return requests;
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function openEditing(): Promise<HTMLElement> {
    const container = mount(
      <OrganizationDetail
        organizationId={organizationId}
        canRead
        canWrite
        canManageIdentities
        canReadSponsorships={false}
      />,
    );
    await settle();
    await openEditMode(container);
    return container;
  }

  async function leave(control: HTMLElement): Promise<void> {
    await act(async () => {
      control.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  }

  function fieldOf(control: HTMLElement): HTMLElement {
    const field = control.closest<HTMLElement>(".pk-field");
    if (!field) throw new Error("control is not inside a Field");
    return field;
  }

  it("edits the whole account in place through labelled fields and patches the shared update contract once", async () => {
    const requests = stubAccount(() => json(detail()));
    const container = await openEditing();

    // The cards keep their places; their content becomes the design system's
    // fields, each named through a label, each typed for its value.
    expect(fieldOf(controlFor(container, "Slogan")).closest('section[aria-label="About"]')).not.toBeNull();
    expect(controlFor(container, "Blog feed").type).toBe("url");
    expect(controlFor(container, "Blog feed").getAttribute("inputmode")).toBe("url");
    expect(controlFor(container, "Member since").type).toBe("date");
    expect(controlFor<HTMLSelectElement>(container, "Category").tagName).toBe("SELECT");
    expect(controlFor<HTMLSelectElement>(container, "Primary contact").tagName).toBe("SELECT");
    expect(controlFor<HTMLTextAreaElement>(container, "Description").tagName).toBe("TEXTAREA");

    await typeInto(controlFor(container, "Slogan"), "Trust, verified");
    await typeInto(controlFor(container, "Blog"), "https://example.test/blog");
    // The title follows the name as it is typed.
    await typeInto(controlFor(container, "Name"), "Example Org");
    expect(container.querySelector("header h2")?.textContent).toBe("Example Org");

    await act(async () => buttonNamed(container, "Save").click());
    await settle();

    const patched = requests.filter((request) => request.method === "PATCH");
    expect(patched).toHaveLength(1);
    expect(patched[0]?.path).toBe(`/api/v1/organizations/${organizationId}`);
    const parsed = organizationManagementUpdateSchema.parse(patched[0]?.body);
    expect(parsed.slogan).toBe("Trust, verified");
    expect(parsed.blogUrl).toBe("https://example.test/blog");
    expect(parsed.name).toBe("Example Org");
    expect(parsed.membershipCategory).toBe("F");
    expect(parsed.website).toBe("https://example.test");
    expect(parsed.revision).toBe("2026-01-01T00:00:00.000Z");
    // Saved: the page reads again, with no fields left standing.
    expect([...container.querySelectorAll("label")].some((label) => label.textContent === "Slogan")).toBe(false);
  });

  it("checks a field live, the way the join form does, and refuses the save at the field", async () => {
    const requests = stubAccount(() => json(detail()));
    const container = await openEditing();

    const feed = controlFor(container, "Blog feed");
    await typeInto(feed, "rss please");
    await leave(feed);
    // Refused as typed: the field shows the invalid state with its reason.
    expect(fieldOf(feed).classList.contains("pk-field--invalid")).toBe(true);
    expect(feed.getAttribute("aria-invalid")).toBe("true");
    expect(fieldOf(feed).querySelector('[role="alert"]')?.textContent).toBeTruthy();

    await act(async () => buttonNamed(container, "Save").click());
    await settle();
    // Nothing was sent; the refused field holds focus.
    expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(0);
    expect(document.activeElement).toBe(feed);

    // Corrected: the same field shows it is good now.
    await typeInto(feed, "https://example.test/feed.xml");
    await leave(feed);
    expect(fieldOf(feed).classList.contains("pk-field--ok")).toBe(true);
    expect(feed.getAttribute("aria-invalid")).toBeNull();
  });

  it("marks the field a server refusal names, and keeps the page editing", async () => {
    stubAccount(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: "VALIDATION",
              message: "Invalid request",
              details: { fieldErrors: { website: ["Must be an HTTP(S) URL"] } },
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        ),
    );
    const container = await openEditing();
    await act(async () => buttonNamed(container, "Save").click());
    await settle();

    const website = controlFor(container, "Website");
    expect(fieldOf(website).classList.contains("pk-field--invalid")).toBe(true);
    expect(fieldOf(website).querySelector('[role="alert"]')?.textContent).toContain("Must be an HTTP(S) URL");
    expect(document.activeElement).toBe(website);
  });

  it("keeps the page editing and announces a rejected save", async () => {
    stubAccount(
      () =>
        new Response(JSON.stringify({ error: { code: "STALE_REVISION", message: "Someone else saved first." } }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
    );
    const container = await openEditing();
    await typeInto(controlFor(container, "Slogan"), "Trust, verified");
    await act(async () => buttonNamed(container, "Save").click());
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Someone else saved first.");
    expect(controlFor(container, "Slogan").value).toBe("Trust, verified");
  });
});
