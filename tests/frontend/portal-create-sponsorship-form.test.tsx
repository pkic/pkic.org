// @vitest-environment jsdom
/**
 * The staff form that opens a sponsorship.
 *
 * What is asserted here is what a visual review cannot see: that every
 * control is reachable through its own label's `for`/`id` pair, that the
 * organization and event are chosen from the canonical server-backed lists
 * rather than typed as raw UUIDs, that one `disabled` takes the whole group
 * out of play while the create is in flight, that a refusal is announced
 * rather than merely coloured, and that what the form finally sends
 * satisfies the canonical request contract rather than a literal copy of
 * itself.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sponsorshipCreateSchema, type Sponsorship } from "../../assets/shared/schemas/sponsorship-management";
import { CreateSponsorshipForm } from "../../assets/ts/member-flows/portal/sections/sponsors/management/CreateSponsorshipForm";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import {
  buttonNamed,
  buttonNames,
  chooseComboboxOption,
  chooseOption,
  controlFor,
  labelNames,
  openCombobox,
  submitForm,
  typeInto,
} from "./helpers/labelled-control";

const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
const EVENT_ID = "pqc-conference-2026";
const NOW = "2026-08-31T09:00:00.000Z";

const CREATED: Sponsorship = {
  id: "30000000-0000-4000-8000-000000000001",
  sponsorType: "consortium",
  organizationId: ORGANIZATION_ID,
  organizationName: "Example Organization",
  nonMemberName: null,
  nonMemberWebsite: null,
  nonMemberLogoUrl: null,
  contactName: null,
  contactEmail: null,
  eventId: null,
  eventName: null,
  tier: null,
  pipelineStage: "new_inquiry",
  startDate: null,
  renewalDate: null,
  assignedToUserId: null,
  assignedToName: null,
  notes: null,
  priceAmountCents: null,
  priceCurrency: null,
  createdAt: NOW,
  updatedAt: NOW,
};

/** One directory page, shaped like the canonical organizations list contract. */
function organizationsPage() {
  return {
    organizations: [
      {
        id: ORGANIZATION_ID,
        name: "Example Organization",
        membershipCategory: "P1",
        memberSince: "2020-01-01",
        activeIdentityCount: 3,
        primaryContactName: null,
        primaryContactEmail: null,
        createdAt: NOW,
        updatedAt: NOW,
        website: null,
        description: null,
        slogan: null,
        logoUrl: null,
      },
    ],
    page: { limit: 25, offset: 0, total: 1, count: 1, hasMore: false },
  };
}

/** One events page, shaped like the canonical events list contract (management arm). */
function eventsPage() {
  return {
    events: [
      {
        id: EVENT_ID,
        slug: "pqc-conference-2026",
        name: "PQC Conference 2026",
        timezone: "Europe/Amsterdam",
        startsAt: "2026-10-01T08:00:00.000Z",
        endsAt: null,
        profileKey: "conference",
        sourceMode: "portal",
        registrationPolicy: "optional",
        visibility: "public",
        inviteLimitAttendee: 5,
        updatedAt: NOW,
        ownerGroupId: null,
        ownerGroupName: null,
        sourcePath: null,
        basePath: null,
        totalRegistrations: 0,
        confirmedRegistrations: 0,
        pendingInvites: 0,
      },
    ],
    page: { limit: 25, offset: 0, total: 1, count: 1, hasMore: false },
  };
}

let container: HTMLElement | null = null;

function mount(node: ComponentChild): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

function mountForm(props: Partial<Parameters<typeof CreateSponsorshipForm>[0]> = {}): HTMLElement {
  return mount(<CreateSponsorshipForm onCreated={vi.fn()} onCancel={vi.fn()} {...props} />);
}

/** Lets the pickers' initial collection fetches land before interacting. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Serves the canonical organization and event lists to the pickers, captures
 * every POST body into `bodies`, and answers the create with `status`.
 */
function stubFetch(bodies: unknown[], status = 200, requests: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      const method = init?.method ?? "GET";
      requests.push(`${method} ${url.pathname}`);
      const json = (value: unknown, code = 200) =>
        new Response(JSON.stringify(value), { status: code, headers: { "content-type": "application/json" } });

      if (method === "GET" && url.pathname === "/api/v1/organizations") return json(organizationsPage());
      if (method === "GET" && url.pathname === "/api/v1/events") return json(eventsPage());

      bodies.push(JSON.parse(String(init?.body)));
      if (status !== 200) {
        return json({ error: { code: "forbidden", message: `HTTP ${String(status)}` } }, status);
      }
      return json({ sponsorship: CREATED });
    }),
  );
}

/** The pickers are offered to accounts that can read the organization directory. */
function signInAsDirectoryReader(): void {
  portalSession.value = portalSessionFixture({ staff: true });
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  document.getElementById("portal-toast-area")?.remove();
  portalSession.value = null;
  vi.unstubAllGlobals();
});

describe("create sponsorship form", () => {
  it("names every control through its own label, with the organization offered as a search rather than an id", async () => {
    signInAsDirectoryReader();
    stubFetch([]);
    const page = mountForm();
    await settle();

    expect(labelNames(page)).toEqual(["Type", "Member organization", "Tier", "Contact name", "Contact email"]);

    // Resolved through the `for`/`id` pair itself, so each lookup fails
    // exactly when the labelling contract is broken.
    expect(controlFor<HTMLSelectElement>(page, "Type").tagName).toBe("SELECT");
    expect(controlFor(page, "Contact email").type).toBe("email");

    // The organization is chosen from the canonical directory list, not
    // typed as a UUID: the labelled control is a real combobox.
    const organization = controlFor(page, "Member organization");
    expect(organization.getAttribute("role")).toBe("combobox");
    expect(organization.getAttribute("aria-haspopup")).toBe("listbox");

    // Nothing is announced as invalid before anything has been checked.
    expect(page.querySelector("[aria-invalid]")).toBeNull();

    // The form itself carries the name that says what it is for.
    expect(page.querySelector("form")?.getAttribute("aria-label")).toBe("Create sponsorship");
  });

  it("offers the fields the chosen sponsor type actually stores", async () => {
    signInAsDirectoryReader();
    stubFetch([]);
    const page = mountForm();
    await settle();

    expect(labelNames(page)).toContain("Member organization");
    expect(labelNames(page)).not.toContain("Event");

    await chooseOption(controlFor<HTMLSelectElement>(page, "Type"), "event");
    await settle();

    // An event sponsorship may be a non-member, so the organization
    // requirement is replaced rather than merely relaxed.
    expect(labelNames(page)).not.toContain("Member organization");
    expect(labelNames(page)).toEqual(["Type", "Event", "Non-member name", "Tier", "Contact name", "Contact email"]);
    // The event too is chosen from the canonical events list.
    expect(controlFor(page, "Event").getAttribute("role")).toBe("combobox");
  });

  it("hides the cancel control when there is nothing to cancel back to", async () => {
    signInAsDirectoryReader();
    stubFetch([]);
    const page = mountForm({ showCancel: false });
    await settle();
    expect(buttonNames(page)).toEqual(["Create"]);
  });

  it("sends a create that satisfies the canonical POST contract, with the organization picked from the directory list", async () => {
    signInAsDirectoryReader();
    const bodies: unknown[] = [];
    const requests: string[] = [];
    stubFetch(bodies, 200, requests);
    const toastArea = document.createElement("div");
    toastArea.id = "portal-toast-area";
    document.body.append(toastArea);
    const onCreated = vi.fn();
    const page = mountForm({ onCreated });
    await settle();

    // The picker queried the canonical organizations list, not a bespoke one.
    expect(requests.some((request) => request === "GET /api/v1/organizations")).toBe(true);

    await chooseComboboxOption(page, "Member organization", ORGANIZATION_ID);
    await typeInto(controlFor(page, "Tier"), "Gold");
    await typeInto(controlFor(page, "Contact email"), "sponsor@example.test");
    await submitForm(page);

    expect(bodies).toHaveLength(1);
    // Checked against the shared contract, not against a literal copy of what
    // the component just sent.
    const parsed = sponsorshipCreateSchema.parse(bodies[0]);
    expect(parsed).toMatchObject({
      sponsorType: "consortium",
      organizationId: ORGANIZATION_ID,
      tier: "Gold",
      contactEmail: "sponsor@example.test",
    });
    // A field left blank travels as null rather than as an empty string the
    // contract would reject — and a field the consortium type does not offer
    // does not travel at all.
    expect(parsed.contactName).toBeNull();
    expect(bodies[0]).not.toHaveProperty("eventId");
    expect(bodies[0]).not.toHaveProperty("nonMemberName");

    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(toastArea.textContent).toContain("Sponsorship created");
    // The chosen organization reads back by name, not by UUID.
    expect(controlFor(page, "Member organization").value).toBe("Example Organization");
  });

  it("sends an event-linked non-member create that satisfies the canonical POST contract", async () => {
    signInAsDirectoryReader();
    const bodies: unknown[] = [];
    const requests: string[] = [];
    stubFetch(bodies, 200, requests);
    const toastArea = document.createElement("div");
    toastArea.id = "portal-toast-area";
    document.body.append(toastArea);
    const onCreated = vi.fn();
    const page = mountForm({ onCreated });
    await settle();

    await chooseOption(controlFor<HTMLSelectElement>(page, "Type"), "event");
    await settle();
    // The picker queried the canonical events list the portal already uses.
    expect(requests.some((request) => request === "GET /api/v1/events")).toBe(true);

    await chooseComboboxOption(page, "Event", EVENT_ID);
    await typeInto(controlFor(page, "Non-member name"), "Acme Widgets");
    await typeInto(controlFor(page, "Contact name"), "Ada Sponsor");
    await typeInto(controlFor(page, "Contact email"), "ada@example.test");
    await submitForm(page);

    expect(bodies).toHaveLength(1);
    const parsed = sponsorshipCreateSchema.parse(bodies[0]);
    expect(parsed).toMatchObject({
      sponsorType: "event",
      eventId: EVENT_ID,
      nonMemberName: "Acme Widgets",
      contactName: "Ada Sponsor",
      contactEmail: "ada@example.test",
    });
    // An event sponsorship never carries the consortium-only field.
    expect(bodies[0]).not.toHaveProperty("organizationId");
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("sends a bare event create — no event, no names — that still satisfies the contract", async () => {
    signInAsDirectoryReader();
    const bodies: unknown[] = [];
    stubFetch(bodies);
    const toastArea = document.createElement("div");
    toastArea.id = "portal-toast-area";
    document.body.append(toastArea);
    const onCreated = vi.fn();
    const page = mountForm({ onCreated });
    await settle();

    await chooseOption(controlFor<HTMLSelectElement>(page, "Type"), "event");
    await settle();
    await typeInto(controlFor(page, "Contact name"), "Walk-up Contact");
    await submitForm(page);

    expect(bodies).toHaveLength(1);
    const parsed = sponsorshipCreateSchema.parse(bodies[0]);
    expect(parsed).toMatchObject({ sponsorType: "event", contactName: "Walk-up Contact" });
    expect(parsed.eventId).toBeNull();
    expect(parsed.nonMemberName).toBeNull();
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("does not let a value picked for one sponsor type ride along invisibly after a type switch (issue #22)", async () => {
    signInAsDirectoryReader();
    const bodies: unknown[] = [];
    stubFetch(bodies);
    const toastArea = document.createElement("div");
    toastArea.id = "portal-toast-area";
    document.body.append(toastArea);
    const onCreated = vi.fn();
    const page = mountForm({ onCreated });
    await settle();

    // The reader picks an organization for a consortium sponsorship, then
    // switches to an event sponsorship. The abandoned value must not travel:
    // it used to be sent anyway, so every type's create failed with an
    // unexplained "Invalid request".
    await chooseComboboxOption(page, "Member organization", ORGANIZATION_ID);
    await chooseOption(controlFor<HTMLSelectElement>(page, "Type"), "event");
    await settle();
    await typeInto(controlFor(page, "Non-member name"), "Acme Widgets");
    await submitForm(page);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty("organizationId");
    const parsed = sponsorshipCreateSchema.parse(bodies[0]);
    expect(parsed).toMatchObject({ sponsorType: "event", nonMemberName: "Acme Widgets" });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("refuses an empty organization selection beside the picker without a round trip, and keeps the draft", async () => {
    signInAsDirectoryReader();
    const bodies: unknown[] = [];
    stubFetch(bodies);
    const onCreated = vi.fn();
    const page = mountForm({ onCreated });
    await settle();

    // A consortium sponsorship without an organization is refused by the
    // shared contract before anything is sent.
    await typeInto(controlFor(page, "Contact name"), "Example Contact");
    await submitForm(page);

    expect(bodies).toEqual([]);
    expect(onCreated).not.toHaveBeenCalled();

    // The picker draws no message slot of its own, so the refusal is
    // announced as an alert immediately beside it.
    const alerts = [...page.querySelectorAll('[role="alert"]')];
    expect(alerts.some((alert) => alert.textContent?.includes("organizationId is required"))).toBe(true);
    // The draft survives, so the refusal is a correction rather than a restart.
    expect(controlFor(page, "Contact name").value).toBe("Example Contact");
  });

  it("falls back to the raw id field for an account that cannot read the organization directory", async () => {
    // A sponsorship writer without `organizations:read` would only see the
    // picker fail; they keep the raw id input instead.
    portalSession.value = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "sponsorships:write", contextType: null, contextId: null }],
    });
    const bodies: unknown[] = [];
    const requests: string[] = [];
    stubFetch(bodies, 200, requests);
    const toastArea = document.createElement("div");
    toastArea.id = "portal-toast-area";
    document.body.append(toastArea);
    const onCreated = vi.fn();
    const page = mountForm({ onCreated });

    // The one field the contract refuses as empty is the one the markup
    // announces as required, in words as well as with a marker.
    const organization = controlFor(page, "Organization ID");
    expect(organization.required).toBe(true);
    expect(page.textContent).toContain("(required)");

    // The help text is not merely adjacent — it is pointed at.
    const describedBy = organization.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(page.querySelector(`#${describedBy!}`)?.textContent).toContain("member organization");

    // No directory query is made on behalf of an account that may not list it.
    expect(requests.some((request) => request.startsWith("GET /api/v1/organizations"))).toBe(false);

    await typeInto(organization, ORGANIZATION_ID);
    await submitForm(page);

    expect(bodies).toHaveLength(1);
    const parsed = sponsorshipCreateSchema.parse(bodies[0]);
    expect(parsed).toMatchObject({ sponsorType: "consortium", organizationId: ORGANIZATION_ID });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("names a contract refusal on the fallback field itself without a round trip, and keeps the draft", async () => {
    portalSession.value = portalSessionFixture({ staff: true, staffRole: "user", grants: [] });
    const bodies: unknown[] = [];
    stubFetch(bodies);
    const onCreated = vi.fn();
    const page = mountForm({ onCreated });

    // An organization name is not an organization id; the shared contract
    // refuses it before anything is sent.
    await typeInto(controlFor(page, "Organization ID"), "Acme Widgets");
    await submitForm(page);

    expect(bodies).toEqual([]);
    expect(onCreated).not.toHaveBeenCalled();

    const organization = controlFor(page, "Organization ID");
    expect(organization.getAttribute("aria-invalid")).toBe("true");
    const describedBy = organization.getAttribute("aria-describedby");
    const message = page.querySelector(`#${describedBy!}`);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toBeTruthy();
    // The draft survives, so the refusal is a correction rather than a restart.
    expect(organization.value).toBe("Acme Widgets");
  });

  it("lands the server's validation details on the fields they name, per the shared details contract", async () => {
    signInAsDirectoryReader();
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if ((init?.method ?? "GET") === "GET" && url.pathname === "/api/v1/organizations") {
          return new Response(JSON.stringify(organizationsPage()), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid request",
              details: { formErrors: [], fieldErrors: { tier: ["This tier is not configured"] } },
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const page = mountForm();
    await settle();

    await chooseComboboxOption(page, "Member organization", ORGANIZATION_ID);
    await typeInto(controlFor(page, "Tier"), "Unobtainium");
    await submitForm(page);

    expect(bodies).toHaveLength(1);
    const tier = controlFor(page, "Tier");
    expect(tier.getAttribute("aria-invalid")).toBe("true");
    const describedBy = tier.getAttribute("aria-describedby");
    expect(page.querySelector(`#${describedBy!}`)?.textContent).toContain("This tier is not configured");
  });

  it("announces a refusal as an alert, in English rather than transport phrasing, and keeps the draft", async () => {
    signInAsDirectoryReader();
    const bodies: unknown[] = [];
    stubFetch(bodies, 403);
    const onCreated = vi.fn();
    const page = mountForm({ onCreated });
    await settle();

    await chooseComboboxOption(page, "Member organization", ORGANIZATION_ID);
    await typeInto(controlFor(page, "Contact name"), "Example Contact");
    await submitForm(page);

    expect(bodies).toHaveLength(1);
    const alert = page.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("You don't have access to this");
    expect(page.textContent).not.toContain("HTTP 403");

    // A refusal is a retry, not a restart: the draft survives and the form is
    // usable again — the chosen organization still reads back by name.
    expect(onCreated).not.toHaveBeenCalled();
    expect(controlFor(page, "Member organization").value).toBe("Example Organization");
    expect(controlFor(page, "Contact name").value).toBe("Example Contact");
    expect(page.querySelector("fieldset")?.disabled).toBe(false);
    expect(buttonNamed(page, "Create").getAttribute("aria-busy")).toBeNull();
  });

  it("takes every control out of play with one disabled group while the create is in flight", async () => {
    signInAsDirectoryReader();
    let release: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if ((init?.method ?? "GET") === "GET" && url.pathname === "/api/v1/organizations") {
          return new Response(JSON.stringify(organizationsPage()), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return new Response(JSON.stringify({ sponsorship: CREATED }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const page = mountForm();
    await settle();

    await chooseComboboxOption(page, "Member organization", ORGANIZATION_ID);
    await act(() => {
      page.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const group = page.querySelector("fieldset");
    expect(group?.disabled).toBe(true);
    // The state is inherited from the group rather than reflected onto each
    // element, so `:disabled` is what says it. The organization combobox
    // counts among the inputs the group takes out of play.
    const controls = [...page.querySelectorAll("fieldset input, fieldset select")];
    expect(controls).toHaveLength(5);
    expect(controls.every((control) => control.matches(":disabled"))).toBe(true);

    // Busy, not disabled: a disabled control loses focus and throws the
    // reader out of the form they were in the middle of.
    const create = buttonNamed(page, "Create");
    expect(create.getAttribute("aria-busy")).toBe("true");
    expect(create.disabled).toBe(false);

    release?.();
  });

  it("cancels without sending anything", async () => {
    signInAsDirectoryReader();
    const bodies: unknown[] = [];
    stubFetch(bodies);
    const onCancel = vi.fn();
    const page = mountForm({ onCancel });
    await settle();

    await act(() => buttonNamed(page, "Cancel").click());

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(bodies).toEqual([]);
  });

  it("lists the directory's organizations in the picker under their names", async () => {
    signInAsDirectoryReader();
    stubFetch([]);
    const page = mountForm();
    await settle();

    const options = await openCombobox(page, "Member organization");
    expect(options.map((option) => option.textContent)).toEqual(["Example Organization"]);
    expect(options.map((option) => option.getAttribute("data-key"))).toEqual([ORGANIZATION_ID]);
  });
});
