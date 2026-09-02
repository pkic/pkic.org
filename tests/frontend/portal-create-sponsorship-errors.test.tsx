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

import { type Sponsorship } from "../../assets/shared/schemas/sponsorship-management";
import { CreateSponsorshipForm } from "../../assets/ts/member-flows/portal/sections/sponsors/management/CreateSponsorshipForm";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { buttonNamed, chooseComboboxOption, controlFor, submitForm, typeInto } from "./helpers/labelled-control";

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

describe("create sponsorship form error surfacing", () => {
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
});
