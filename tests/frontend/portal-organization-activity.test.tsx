// @vitest-environment jsdom
/**
 * The organization account record's Activity tabs.
 *
 * What matters here is not that three tables render — it is that a tab costs
 * nothing until it is opened, that each one speaks the shared list dialect on
 * the wire, that a row leads to the record it names, and that a column is
 * narrowed from its own menu rather than from a bar above the table.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  organizationEventsListResponseSchema,
  organizationGroupsListResponseSchema,
  organizationProposalsListResponseSchema,
} from "../../assets/shared/schemas/organization-activity";
import { ADMIN_LIST_PAGE_SIZE_DEFAULT } from "../../assets/ts/components/Pager";
import { OrganizationActivity } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationActivity";
import { chooseColumnFilter, columnFilterOptions } from "./helpers/column-menu";
import { tabNames, tabNamed, isCurrentTab } from "./helpers/tabs";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/organizations", vi.fn()] }));

const organizationId = "00000000-0000-4000-8000-000000000010";
const groupId = "00000000-0000-4000-8000-000000000021";
const upcomingEventId = "00000000-0000-4000-8000-000000000031";
const undatedEventId = "00000000-0000-4000-8000-000000000032";
const proposalId = "00000000-0000-4000-8000-000000000041";

const mounted: HTMLElement[] = [];
let requests: URL[] = [];

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

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const page = { limit: ADMIN_LIST_PAGE_SIZE_DEFAULT, offset: 0, total: 1, hasMore: false };

function groupsPage() {
  return organizationGroupsListResponseSchema.parse({
    groups: [
      {
        groupId,
        groupSlug: "post-quantum-cryptography",
        groupName: "Post-Quantum Cryptography",
        groupKind: "working_group",
        groupKindLabel: "Working Group",
        representativeCount: 2,
        firstJoinedAt: "2026-01-05T00:00:00.000Z",
        latestJoinedAt: "2026-03-09T00:00:00.000Z",
      },
    ],
    page,
  });
}

function eventsPage() {
  return organizationEventsListResponseSchema.parse({
    events: [
      {
        eventId: upcomingEventId,
        eventSlug: "pki-summit-2099",
        eventName: "PKI Summit",
        startsAt: "2099-03-01T09:00:00.000Z",
        endsAt: "2099-03-02T17:00:00.000Z",
        registrationCount: 2,
        participantRoles: ["speaker"],
        upcoming: true,
      },
      {
        eventId: undatedEventId,
        eventSlug: "undated-workshop",
        eventName: "Undated Workshop",
        startsAt: null,
        endsAt: null,
        registrationCount: 1,
        participantRoles: [],
        upcoming: false,
      },
    ],
    page: { ...page, total: 2 },
  });
}

function proposalsPage() {
  return organizationProposalsListResponseSchema.parse({
    proposals: [
      {
        proposalId,
        eventSlug: "pqc-2027",
        eventName: "PQC Conference",
        title: "Hybrid certificates",
        proposalType: "talk",
        status: "accepted",
        submittedAt: "2026-02-01T00:00:00.000Z",
        proposerName: "Ada Lovelace",
        proposerEmail: "ada@example.test",
      },
    ],
    page,
  });
}

function sponsorshipsPage() {
  return { sponsorships: [], page: { ...page, total: 0 } };
}

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      requests.push(url);
      if (url.pathname.endsWith("/groups")) return Promise.resolve(json(groupsPage()));
      if (url.pathname.endsWith("/events")) return Promise.resolve(json(eventsPage()));
      if (url.pathname.endsWith("/proposals")) return Promise.resolve(json(proposalsPage()));
      if (url.pathname === "/api/v1/sponsors") return Promise.resolve(json(sponsorshipsPage()));
      throw new Error(`unexpected request to ${url.pathname}`);
    }),
  );
}

/** Selects a tab by its visible name and lets its panel's query resolve. */
async function selectTab(container: HTMLElement, label: string): Promise<void> {
  const tab = tabNamed(container, label);
  if (!tab) throw new Error(`no tab named "${label}"`);
  await act(async () => {
    tab.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await settle();
}

function paths(): string[] {
  return requests.map((url) => url.pathname);
}

function lastQueryFor(collection: string): URLSearchParams {
  const match = [...requests].reverse().find((url) => url.pathname.endsWith(`/${collection}`));
  if (!match) throw new Error(`no request was made for ${collection}`);
  return match.searchParams;
}

beforeEach(() => {
  requests = [];
  stubFetch();
});

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("organization activity tabs", () => {
  it("fetches only the tab that is open, and each tab only when it is opened", async () => {
    const container = mount(<OrganizationActivity organizationId={organizationId} canReadSponsorships />);
    await settle();

    expect(tabNames(container)).toEqual(["Groups", "Events", "Proposals", "Sponsorships"]);
    expect(isCurrentTab(tabNamed(container, "Groups"))).toBe(true);

    // Opening the record costs one bounded query, not four.
    expect(paths()).toEqual([`/api/v1/organizations/${organizationId}/groups`]);

    await selectTab(container, "Events");
    expect(paths()).toContain(`/api/v1/organizations/${organizationId}/events`);
    expect(paths()).not.toContain(`/api/v1/organizations/${organizationId}/proposals`);

    await selectTab(container, "Proposals");
    expect(paths()).toContain(`/api/v1/organizations/${organizationId}/proposals`);
    expect(paths().filter((path) => path === "/api/v1/sponsors")).toEqual([]);

    await selectTab(container, "Sponsorships");
    expect(paths()).toContain("/api/v1/sponsors");

    // A closed tab's table is unmounted, so only one collection is on screen.
    expect([...container.querySelectorAll("caption")].map((caption) => caption.textContent)).toEqual(["Sponsorships"]);
  });

  it("offers no sponsorships tab, and asks for none, without sponsorships:read", async () => {
    const container = mount(<OrganizationActivity organizationId={organizationId} canReadSponsorships={false} />);
    await settle();

    expect(tabNames(container)).toEqual(["Groups", "Events", "Proposals"]);
    await selectTab(container, "Proposals");
    expect(paths()).not.toContain("/api/v1/sponsors");
  });

  it("asks each collection in the shared list dialect", async () => {
    const container = mount(<OrganizationActivity organizationId={organizationId} canReadSponsorships />);
    await settle();

    const groups = lastQueryFor("groups");
    // The page size is the shared list default, not a per-surface number.
    expect(groups.get("limit")).toBe(String(ADMIN_LIST_PAGE_SIZE_DEFAULT));
    expect(groups.get("offset")).toBe("0");
    // Groups default to the contract's own sort, so nothing is sent.
    expect(groups.has("sort")).toBe(false);

    await selectTab(container, "Events");
    const events = lastQueryFor("events");
    expect(events.get("sort")).toBe("-startsAt");
    expect(events.get("limit")).toBe(String(ADMIN_LIST_PAGE_SIZE_DEFAULT));

    await selectTab(container, "Proposals");
    expect(lastQueryFor("proposals").get("sort")).toBe("-submittedAt");
  });

  it("sends a group search as the shared q parameter", async () => {
    const container = mount(<OrganizationActivity organizationId={organizationId} canReadSponsorships />);
    await settle();

    const search = container.querySelector<HTMLInputElement>('input[type="search"], input[placeholder*="Search"]');
    expect(search).not.toBeNull();
    await act(async () => {
      search!.value = "crypto";
      search!.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      search!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(lastQueryFor("groups").get("q")).toBe("crypto");
  });

  it("narrows events from the When column's own menu", async () => {
    const container = mount(<OrganizationActivity organizationId={organizationId} canReadSponsorships />);
    await settle();
    await selectTab(container, "Events");

    // The vocabulary is the contract's, offered where the column is — not as
    // a select in the toolbar.
    expect(columnFilterOptions(container, "When")).toEqual(["Upcoming and past", "Upcoming", "Past"]);

    await chooseColumnFilter(container, "When", "Past");
    await settle();
    expect(lastQueryFor("events").get("when")).toBe("past");

    await chooseColumnFilter(container, "When", "Upcoming");
    await settle();
    expect(lastQueryFor("events").get("when")).toBe("upcoming");

    // The open state clears the parameter rather than sending an empty one.
    await chooseColumnFilter(container, "When", "Upcoming and past");
    await settle();
    expect(lastQueryFor("events").has("when")).toBe(false);
  });

  it("narrows proposals from the Status column's own menu, using the canonical vocabulary", async () => {
    const container = mount(<OrganizationActivity organizationId={organizationId} canReadSponsorships />);
    await settle();
    await selectTab(container, "Proposals");

    const options = columnFilterOptions(container, "Status");
    expect(options[0]).toBe("All statuses");
    expect(options).toContain("Active (excludes withdrawn/rejected/spam)");
    expect(options).toContain("Under review");
    expect(options).toContain("Needs work");

    await chooseColumnFilter(container, "Status", "Accepted");
    await settle();
    expect(lastQueryFor("proposals").get("status")).toBe("accepted");
  });

  it("opens the record each row names, at the route the portal actually serves", async () => {
    const container = mount(<OrganizationActivity organizationId={organizationId} canReadSponsorships />);
    await settle();

    const groupLink = container.querySelector<HTMLAnchorElement>('a[href^="#/groups/"]');
    expect(groupLink?.getAttribute("href")).toBe(`#/groups/${groupId}`);

    await selectTab(container, "Events");
    expect(container.querySelector<HTMLAnchorElement>('a[href^="#/events/"]')?.getAttribute("href")).toBe(
      "#/events/pki-summit-2099",
    );

    await selectTab(container, "Proposals");
    expect(container.querySelector<HTMLAnchorElement>('a[href^="#/events/"]')?.getAttribute("href")).toBe(
      `#/events/pqc-2027/proposals/detail/${proposalId}`,
    );
  });

  it("states what a row means rather than echoing stored keys", async () => {
    const container = mount(<OrganizationActivity organizationId={organizationId} canReadSponsorships />);
    await settle();

    // The group type reads as its reference-data label, not as `working_group`.
    expect(container.textContent).toContain("Working Group");
    expect(container.textContent).not.toContain("working_group");

    await selectTab(container, "Events");
    // An event with no schedule is neither upcoming nor past, and says so.
    expect(container.textContent).toContain("Unscheduled");
    expect(container.textContent).toContain("Upcoming");
  });

  it("names its empty states with a way forward rather than a bare 'none'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json({ groups: [], page: { ...page, total: 0 } }))),
    );
    const container = mount(<OrganizationActivity organizationId={organizationId} canReadSponsorships={false} />);
    await settle();
    await settle();

    expect(container.textContent).toContain(
      "No group participation yet — representatives join groups from their group pages.",
    );
  });
});
