// @vitest-environment jsdom
/**
 * The staff form that opens a sponsorship.
 *
 * What is asserted here is what a visual review cannot see: that every
 * control is reachable through its own label's `for`/`id` pair, that the
 * guidance beside a control is tied to it by `aria-describedby`, that one
 * `disabled` takes the whole group out of play while the create is in
 * flight, that a refusal is announced rather than merely coloured, and that
 * what the form finally sends satisfies the canonical request contract
 * rather than a literal copy of itself.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sponsorshipCreateSchema, type Sponsorship } from "../../assets/shared/schemas/sponsorship-management";
import { CreateSponsorshipForm } from "../../assets/ts/member-flows/portal/sections/sponsors/management/CreateSponsorshipForm";
import {
  buttonNamed,
  buttonNames,
  chooseOption,
  controlFor,
  labelNames,
  submitForm,
  typeInto,
} from "./helpers/labelled-control";

const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
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

/** Captures every POST body and answers with `status`. */
function stubFetch(bodies: unknown[], status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (status !== 200) {
        return new Response(JSON.stringify({ error: { code: "forbidden", message: `HTTP ${String(status)}` } }), {
          status,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ sponsorship: CREATED }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  document.getElementById("portal-toast-area")?.remove();
  vi.unstubAllGlobals();
});

describe("create sponsorship form", () => {
  it("names every control through its own label and ties the guidance to the control it describes", () => {
    const page = mountForm();

    expect(labelNames(page)).toEqual(["Type", "Organization ID", "Tier", "Contact name", "Contact email"]);

    // Resolved through the `for`/`id` pair itself, so each lookup fails
    // exactly when the labelling contract is broken.
    expect(controlFor<HTMLSelectElement>(page, "Type").tagName).toBe("SELECT");
    expect(controlFor(page, "Contact email").type).toBe("email");

    // The one field the contract refuses as empty is the one the markup
    // announces as required, in words as well as with a marker.
    const organization = controlFor(page, "Organization ID");
    expect(organization.required).toBe(true);
    expect(page.textContent).toContain("(required)");

    // The help text is not merely adjacent — it is pointed at.
    const describedBy = organization.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(page.querySelector(`#${describedBy!}`)?.textContent).toContain("member organization");

    // Nothing is announced as invalid before anything has been checked.
    expect(page.querySelector("[aria-invalid]")).toBeNull();

    // The form itself carries the name that says what it is for.
    expect(page.querySelector("form")?.getAttribute("aria-label")).toBe("Create sponsorship");
  });

  it("offers the fields the chosen sponsor type actually stores", async () => {
    const page = mountForm();

    expect(labelNames(page)).toContain("Organization ID");
    expect(labelNames(page)).not.toContain("Event ID");

    await chooseOption(controlFor<HTMLSelectElement>(page, "Type"), "event");

    // An event sponsorship may be a non-member, so the organization
    // requirement is replaced rather than merely relaxed.
    expect(labelNames(page)).not.toContain("Organization ID");
    expect(labelNames(page)).toEqual(["Type", "Event ID", "Non-member name", "Tier", "Contact name", "Contact email"]);
  });

  it("hides the cancel control when there is nothing to cancel back to", () => {
    expect(buttonNames(mountForm({ showCancel: false }))).toEqual(["Create"]);
  });

  it("sends a create that satisfies the canonical POST contract", async () => {
    const bodies: unknown[] = [];
    stubFetch(bodies);
    const toastArea = document.createElement("div");
    toastArea.id = "portal-toast-area";
    document.body.append(toastArea);
    const onCreated = vi.fn();
    const page = mountForm({ onCreated });

    await typeInto(controlFor(page, "Organization ID"), ORGANIZATION_ID);
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
    // The fields left blank travel as null rather than as empty strings the
    // contract would reject.
    expect(parsed.eventId).toBeNull();
    expect(parsed.nonMemberName).toBeNull();
    expect(parsed.contactName).toBeNull();

    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(toastArea.textContent).toContain("Sponsorship created");
  });

  it("announces a refusal as an alert, in English rather than transport phrasing, and keeps the draft", async () => {
    const bodies: unknown[] = [];
    stubFetch(bodies, 403);
    const onCreated = vi.fn();
    const page = mountForm({ onCreated });

    await typeInto(controlFor(page, "Organization ID"), ORGANIZATION_ID);
    await typeInto(controlFor(page, "Contact name"), "Example Contact");
    await submitForm(page);

    expect(bodies).toHaveLength(1);
    const alert = page.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("You don't have access to this");
    expect(page.textContent).not.toContain("HTTP 403");

    // A refusal is a retry, not a restart: the draft survives and the form is
    // usable again.
    expect(onCreated).not.toHaveBeenCalled();
    expect(controlFor(page, "Organization ID").value).toBe(ORGANIZATION_ID);
    expect(controlFor(page, "Contact name").value).toBe("Example Contact");
    expect(page.querySelector("fieldset")?.disabled).toBe(false);
    expect(buttonNamed(page, "Create").getAttribute("aria-busy")).toBeNull();
  });

  it("takes every control out of play with one disabled group while the create is in flight", async () => {
    let release: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
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

    await typeInto(controlFor(page, "Organization ID"), ORGANIZATION_ID);
    await act(() => {
      page.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const group = page.querySelector("fieldset");
    expect(group?.disabled).toBe(true);
    // The state is inherited from the group rather than reflected onto each
    // element, so `:disabled` is what says it.
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
    const bodies: unknown[] = [];
    stubFetch(bodies);
    const onCancel = vi.fn();
    const page = mountForm({ onCancel });

    await act(() => buttonNamed(page, "Cancel").click());

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(bodies).toEqual([]);
  });
});
