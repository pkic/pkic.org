// @vitest-environment jsdom
/**
 * The staff form that opens a sponsorship: what it offers and what it sends.
 *
 * What is asserted here is what a visual review cannot see: that every
 * control is reachable through its own label's `for`/`id` pair, that the
 * organization and event are chosen from the canonical server-backed lists
 * rather than typed as raw UUIDs, that one `disabled` takes the whole group
 * out of play while the create is in flight, and that what the form finally
 * sends satisfies the canonical request contract rather than a literal copy
 * of itself. How the form refuses — contract refusals, server details, the
 * no-directory-permission fallback — is covered by
 * portal-create-sponsorship-form-refusals.test.tsx.
 */
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sponsorshipCreateSchema } from "../../assets/shared/schemas/sponsorship-management";
import {
  CREATED,
  EVENT_ID,
  ORGANIZATION_ID,
  cleanupForm,
  installToastArea,
  mountForm,
  organizationsPage,
  settle,
  signInAsDirectoryReader,
  stubFetch,
} from "./helpers/create-sponsorship-form";
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

afterEach(cleanupForm);

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
    const toastArea = installToastArea();
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
    installToastArea();
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
    installToastArea();
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
    installToastArea();
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
