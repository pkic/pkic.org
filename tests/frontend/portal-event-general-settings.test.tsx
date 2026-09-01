// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventDetail } from "../../assets/ts/member-flows/portal/sections/events/types";
import { GeneralTab } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/GeneralTab";
import { Settings } from "../../assets/ts/member-flows/portal/sections/events/detail/Settings";
import { eventTeamRolesResponseSchema } from "../../assets/shared/schemas/event-team";
import { eventDetailTabsForCapabilities } from "../../assets/ts/member-flows/portal/sections/events/detail/EventDetail";
import { SponsorTiersTab } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/SponsorTiersTab";
import { controlFor } from "./helpers/labelled-control";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

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

const portalEvent = {
  id: "10000000-0000-4000-8000-000000000001",
  slug: "portal-workshop",
  name: "Portal workshop",
  timezone: "Europe/Amsterdam",
  startsAt: "2026-09-01T15:00:00.000Z",
  endsAt: "2026-09-01T16:00:00.000Z",
  profileKey: "workshop",
  registrationPolicy: "public",
  visibility: "public",
  inviteLimitAttendee: 5,
  updatedAt: "2026-08-29T00:00:00.000Z",
  basePath: null,
  userRetentionDays: null,
  venue: null,
  virtualUrl: null,
  heroImageUrl: null,
  location: null,
  sessionTypes: null,
  ownerGroupId: "20000000-0000-4000-8000-000000000001",
  sourceMode: "portal",
  seriesId: null,
  links: [],
  capabilities: ["read"],
  settings: { forms: { event_registration: "legacy-attendee-form" } },
} as EventDetail;

/** The same event seen by someone who is allowed to change it. */
const writableEvent = { ...portalEvent, capabilities: ["read", "write"] } as EventDetail;

/** The only request the general tab makes before a save is the form catalog. */
function stubFormCatalog(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ forms: [], page: { limit: 100, offset: 0, total: 0, hasMore: false } })),
  );
}

async function submitForm(container: HTMLElement): Promise<void> {
  const form = container.querySelector("form");
  expect(form).not.toBeNull();
  await act(async () => {
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("admin event general settings", () => {
  it("does not render or submit portal-owned attendee registration controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        expect(url.pathname).toContain("/forms");
        return json({ forms: [], page: { limit: 100, offset: 0, total: 0, hasMore: false } });
      }),
    );

    const onUpdated = vi.fn();
    const container = mount(<GeneralTab event={portalEvent} onUpdated={onUpdated} />);
    await settle();
    expect(container.textContent).not.toContain("Registration form");
    expect(container.textContent).not.toContain("Registration mode");
    expect(container.textContent).toContain("Proposal form");
  });

  it("labels every control it renders and marks the one the form requires", async () => {
    stubFormCatalog();

    const container = mount(<GeneralTab event={writableEvent} onUpdated={vi.fn()} />);
    await settle();

    // A Field's label must point at a control that exists. An orphaned `for`
    // is invisible in a screenshot and leaves the control unnamed in a screen
    // reader's list of form fields.
    // `useId` produces ids containing characters a CSS selector would have to
    // escape, and `CSS.escape` is absent in jsdom, so the lookup walks ids.
    const byId = (id: string): HTMLElement | null =>
      [...container.querySelectorAll<HTMLElement>("[id]")].find((element) => element.id === id) ?? null;

    const labels = [...container.querySelectorAll<HTMLLabelElement>("label.pk-field__label")];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const target = label.htmlFor ? byId(label.htmlFor) : null;
      expect(target, `label "${label.textContent ?? ""}" points at nothing`).not.toBeNull();
    }

    const named = (text: string): HTMLElement | null => {
      const label = labels.find((candidate) => (candidate.textContent ?? "").startsWith(text));
      return label?.htmlFor ? byId(label.htmlFor) : null;
    };

    const eventName = named("Event name");
    expect(eventName).toBeInstanceOf(HTMLInputElement);
    expect((eventName as HTMLInputElement).required).toBe(true);
    // The asterisk is decorative; the word behind it is what gets announced.
    expect(labels.find((label) => (label.textContent ?? "").startsWith("Event name"))?.textContent).toContain(
      "(required)",
    );

    // The slug is shown but not editable, and it says why rather than only
    // looking greyed out.
    const slug = named("Slug") as HTMLInputElement | null;
    expect(slug?.value).toBe("portal-workshop");
    expect(slug?.disabled).toBe(true);
    const describedBy = slug?.getAttribute("aria-describedby") ?? "";
    expect(describedBy).not.toBe("");
    expect(byId(describedBy)?.textContent).toContain("cannot be changed here");

    // The session-type toggle is the design system's drawn checkbox with its
    // own label, not a bare box beside loose text.
    const check = container.querySelector<HTMLInputElement>("input.pk-check__input");
    expect(check?.type).toBe("checkbox");
    expect(check?.closest("label.pk-check")?.textContent).toContain("Requires presentation");
  });

  it("announces a rejected save rather than tinting the message red", async () => {
    const attempts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if ((init?.method ?? "GET") === "PATCH") {
          attempts.push(url.pathname);
          return new Response(
            JSON.stringify({ error: { code: "CONFLICT", message: "Someone else changed this event." } }),
            { status: 409, headers: { "content-type": "application/json" } },
          );
        }
        return json({ forms: [], page: { limit: 100, offset: 0, total: 0, hasMore: false } });
      }),
    );

    const onUpdated = vi.fn();
    const container = mount(<GeneralTab event={writableEvent} onUpdated={onUpdated} />);
    await settle();

    await submitForm(container);

    expect(attempts).toEqual(["/api/v1/events/portal-workshop/settings"]);
    // role="alert" interrupts; a `text-danger` span says nothing at all to a
    // reader who cannot separate the hue from the success message's.
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Someone else changed this event.");
    expect(onUpdated).not.toHaveBeenCalled();
    // The form is left usable so the conflict can be resolved.
    expect(container.querySelector("fieldset")?.disabled).toBe(false);
  });

  it("tells a reader why the form is inert instead of only greying it out", async () => {
    stubFormCatalog();

    const container = mount(<GeneralTab event={portalEvent} onUpdated={vi.fn()} />);
    await settle();

    const notice = container.querySelector('[role="status"]');
    expect(notice?.textContent).toContain("Read-only");
    expect(notice?.textContent).toContain("You can view these settings but not change them.");
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
    expect([...container.querySelectorAll("button")].some((button) => button.type === "submit")).toBe(false);
  });

  it("shows team management only with the exact event-management capability", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        if (url.pathname.endsWith("/roles")) {
          return json(
            eventTeamRolesResponseSchema.parse({
              roles: [],
              page: { limit: 100, offset: 0, total: 0, hasMore: false },
            }),
          );
        }
        return json({ forms: [], page: { limit: 100, offset: 0, total: 0, hasMore: false } });
      }),
    );

    const reader = mount(<Settings event={portalEvent} onUpdated={vi.fn()} subTab="team" />);
    await settle();
    expect(reader.textContent).not.toContain("Add team member");
    expect(requests.some(({ pathname }) => pathname.endsWith("/roles"))).toBe(false);

    const manager = mount(
      <Settings event={{ ...portalEvent, capabilities: ["read", "manage"] }} onUpdated={vi.fn()} subTab="team" />,
    );
    await settle();
    await settle();
    expect(manager.textContent).toContain("Add team member");
    expect(requests.some(({ pathname }) => pathname === "/api/v1/events/portal-workshop/roles")).toBe(true);
  });

  it("keeps sponsor-tier actions hidden from an event reader", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ tiers: [{ tierName: "Community", hasAttendeeDataAccess: false }] })),
    );

    const container = mount(<Settings event={portalEvent} onUpdated={vi.fn()} subTab="sponsor-tiers" />);
    await settle();
    await settle();

    // The row is taken out of play by the `disabled` attribute on the
    // `<fieldset>` that groups it, which is what puts every control inside it
    // — including ones a child component renders — out of reach in one place.
    // `:disabled` is the state a user meets; `.disabled` only reflects the
    // attribute on the input itself, which is no longer where it lives.
    const tierName = [...container.querySelectorAll<HTMLInputElement>("input")].find(
      (input) => input.value === "Community",
    );
    expect(tierName).toBeDefined();
    expect(tierName!.matches(":disabled")).toBe(true);
    expect(container.textContent).not.toContain("+ Add tier");
    expect(container.textContent).not.toContain("Remove");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Save")).toBe(false);

    // Each tier is a named group whose name input is reached through its own
    // label, so a reader is not left with an unlabelled row of text boxes.
    const group = container.querySelector("fieldset");
    expect(group?.querySelector("legend")?.textContent).toBe("Tier 1");
    expect(controlFor(container, "Tier name").value).toBe("Community");
  });

  it("reports a refused sponsor-tier save as a failure, not as a mild caution", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return new Response(JSON.stringify({ error: { code: "CONFLICT", message: "Tiers changed elsewhere." } }), {
            status: 409,
            headers: { "content-type": "application/json" },
          });
        }
        return json({ tiers: [{ tierName: "Community", hasAttendeeDataAccess: false }] });
      }),
    );

    const container = mount(<SponsorTiersTab slug="portal-workshop" canWrite />);
    await settle();
    await settle();

    const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save")!;
    await act(async () => {
      save.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // A failure interrupts; the tick that means "saved" does not. Both carry
    // the words, so neither rests on its colour.
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Tiers changed elsewhere.");
    expect(container.textContent).not.toContain("✓ Saved");
  });

  it("does not expose event read projections without event read capability", () => {
    const withoutRead = eventDetailTabsForCapabilities([]).map(({ key }) => key);
    expect(withoutRead).not.toContain("registrations");
    expect(withoutRead).not.toContain("promoters");
    expect(withoutRead).not.toContain("stats");

    const withRead = eventDetailTabsForCapabilities(["read"]).map(({ key }) => key);
    expect(withRead).not.toContain("registrations");
    expect(withRead).toContain("promoters");
    expect(withRead).toContain("stats");

    const withManage = eventDetailTabsForCapabilities(["manage"]).map(({ key }) => key);
    expect(withManage).toContain("registrations");
  });

  it("replaces the General tab with a series-managed notice for a meeting-series event", async () => {
    const seriesEvent = {
      ...portalEvent,
      seriesId: "60000000-0000-4000-8000-000000000001",
      ownerGroupId: "20000000-0000-4000-8000-000000000001",
    };
    const container = mount(<Settings event={seriesEvent} onUpdated={vi.fn()} />);
    await settle();

    expect(container.textContent).not.toContain("Event name");
    expect(container.textContent).toContain("managed by a meeting series");
    // Tabs are links too now, so "not a tab" is what excludes them, not a role.
    const link = container.querySelector<HTMLAnchorElement>("a:not(.pk-tabs__link)");
    expect(link?.getAttribute("href")).toBe(
      "#/groups/20000000-0000-4000-8000-000000000001/meetings/60000000-0000-4000-8000-000000000001",
    );
  });

  it("explains an undetermined owning group instead of linking nowhere", async () => {
    const seriesEvent = {
      ...portalEvent,
      seriesId: "60000000-0000-4000-8000-000000000001",
      ownerGroupId: null,
    };
    const container = mount(<Settings event={seriesEvent} onUpdated={vi.fn()} />);
    await settle();

    expect(container.textContent).toContain("could not be determined");
    expect(container.querySelector("a:not(.pk-tabs__link)")).toBeNull();
  });

  it("keeps sponsor tiers and team working for a meeting-series event", async () => {
    const seriesEvent = {
      ...portalEvent,
      seriesId: "60000000-0000-4000-8000-000000000001",
      ownerGroupId: "20000000-0000-4000-8000-000000000001",
      capabilities: ["read", "manage"] as EventDetail["capabilities"],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ tiers: [] })),
    );
    const tiers = mount(<Settings event={seriesEvent} onUpdated={vi.fn()} subTab="sponsor-tiers" />);
    await settle();
    await settle();
    expect(tiers.textContent).toContain("attendee-data access in the portal");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ roles: [], page: { limit: 100, offset: 0, total: 0, hasMore: false } })),
    );
    const team = mount(<Settings event={seriesEvent} onUpdated={vi.fn()} subTab="team" />);
    await settle();
    await settle();
    expect(team.textContent).toContain("Add team member");
  });
});
