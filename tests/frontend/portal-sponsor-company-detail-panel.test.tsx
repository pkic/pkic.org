// @vitest-environment jsdom
/**
 * One company's sponsorships, and the detail beside them.
 *
 * The list was a Bootstrap `list-group` whose open item was marked by the
 * `active` class alone — a filled background, and nothing a reader who cannot
 * separate those grounds could use. What is asserted here is what a visual
 * review cannot see: that the list names itself, that each row activates
 * through a real control with a name that says where it goes, that the open
 * row says so in words, and that the wait and the failure both announce
 * themselves rather than leaving an empty column.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SponsorshipCompany, SponsorshipsListResponse } from "../../assets/shared/schemas/sponsorship-management";
import { CompanyDetailPanel } from "../../assets/ts/member-flows/portal/sections/sponsors/management/CompanyDetailPanel";
import type { useCompanySponsorships } from "../../assets/ts/member-flows/portal/sections/sponsors/management/useCompanySponsorships";

// The detail pane fetches its own record; this suite is about the list beside
// it, so it is replaced with a marker rather than stubbed request by request.
vi.mock("../../assets/ts/member-flows/portal/sections/sponsors/management/SponsorshipDetail", () => ({
  SponsorshipDetail: ({ id }: { id: string }) => <div data-testid="sponsorship-detail">Detail for {id}</div>,
}));

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

const COMPANY: SponsorshipCompany = {
  key: "organization:00000000-0000-4000-8000-000000000001",
  label: "Analytical Engines",
} as SponsorshipCompany;

type CompanySponsorship = SponsorshipsListResponse["sponsorships"][number];

function sponsorship(overrides: Partial<CompanySponsorship> = {}): CompanySponsorship {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    sponsorType: "organization",
    organizationId: "00000000-0000-4000-8000-000000000001",
    organizationName: "Analytical Engines",
    nonMemberName: null,
    nonMemberWebsite: null,
    nonMemberLogoUrl: null,
    contactName: null,
    contactEmail: null,
    eventId: null,
    eventName: "Summit 2026",
    tier: "Gold",
    pipelineStage: "active",
    startDate: null,
    renewalDate: null,
    assignedToUserId: null,
    assignedToName: null,
    notes: null,
    priceAmountCents: null,
    priceCurrency: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as CompanySponsorship;
}

type CompanyState = ReturnType<typeof useCompanySponsorships>;

function companyState(overrides: Partial<CompanyState> = {}): CompanyState {
  return {
    selectedCompany: COMPANY,
    companySponsorships: [sponsorship()],
    companyPage: { limit: 25, offset: 0, total: 1, hasMore: false },
    companyLoading: false,
    companyLoadingMore: false,
    companyError: null,
    selectedId: null,
    setSelectedId: vi.fn(),
    selectCompany: vi.fn(),
    loadMore: vi.fn(),
    backToCompanies: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  } as CompanyState;
}

function panel(overrides: Partial<CompanyState> = {}) {
  return <CompanyDetailPanel selectedCompany={COMPANY} company={companyState(overrides)} />;
}

describe("one company's sponsorship list", () => {
  it("captions the list and names each row after where it goes", () => {
    const container = mount(panel());

    expect(container.querySelector("caption")?.textContent).toBe("Analytical Engines sponsorships");
    // The row's control says what it opens, not "View", and it is a link to
    // the sponsorship's own page — a record with facets is routed, not
    // expanded beside the table.
    const rowLink = container.querySelector<HTMLAnchorElement>("tbody a");
    expect(rowLink?.textContent).toBe("Open Gold — Summit 2026");
    expect(rowLink?.getAttribute("href")).toBe("#/sponsors/00000000-0000-4000-8000-000000000101");
  });

  it("activates a row through a real link rather than a handler on the tr", () => {
    const container = mount(panel());

    const row = container.querySelector("tbody tr")!;
    // A <tr> is not focusable and takes no Enter key, so the handler must not
    // live on it — the control inside the first cell is what activates, and
    // a link can be opened in a new tab.
    expect(row.getAttribute("onclick")).toBeNull();
    expect(container.querySelector("tbody a")?.tagName).toBe("A");
    // Nothing expands in place any more: no "Showing" marker, no side panel.
    expect(container.querySelector("tbody")?.textContent).not.toContain("Showing");
    expect(container.querySelector('[data-testid="sponsorship-detail"]')).toBeNull();
  });

  it("says why the list is empty rather than showing an unexplained blank", () => {
    const container = mount(panel({ companySponsorships: [] }));

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("No sponsorships for this company");
  });

  it("announces the wait and shows no list behind it", () => {
    const container = mount(panel({ companyLoading: true, companySponsorships: [] }));

    expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading this company's sponsorships…");
    expect(container.querySelector("table")).toBeNull();
  });

  it("states a failed load as a sentence instead of a status code", () => {
    const container = mount(panel({ companyError: "HTTP 403" }));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You don't have access to this");
    expect(container.textContent).not.toContain("HTTP 403");
    expect(container.querySelector("table")).toBeNull();
  });

  it("offers the next page through a real button and leaves it out when there is none", () => {
    const loadMore = vi.fn();
    const more = mount(panel({ loadMore, companyPage: { limit: 25, offset: 0, total: 40, hasMore: true } }));
    const button = [...more.querySelectorAll("button")].find((candidate) => candidate.textContent === "Load more")!;
    void act(() => button.click());
    expect(loadMore).toHaveBeenCalledTimes(1);

    const done = mount(panel());
    expect([...done.querySelectorAll("button")].some((candidate) => candidate.textContent === "Load more")).toBe(false);
  });

  it("returns to the company list through the trail, a real link to the sponsors route", () => {
    const container = mount(panel());

    // No back button: the page's trail names where it sits, and "Sponsors" is
    // a link the route reads to leave this company.
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.includes("Back"))).toBe(false);
    const crumb = [...container.querySelectorAll<HTMLAnchorElement>("a")].find((a) => a.textContent === "Sponsors");
    expect(crumb?.getAttribute("href")).toBe("#/sponsors");
  });
});
