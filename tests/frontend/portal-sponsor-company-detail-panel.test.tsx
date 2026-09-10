// @vitest-environment jsdom
/**
 * One company's sponsorships.
 *
 * The list used to arrive as a prop: a hook fetched a 200-row page, merged
 * "Load more" onto it, and handed a presentational table rows it could
 * neither search nor sort. Issue #42 is that this is the shared table's work,
 * and the endpoint behind the list has taken `q`, every sort column here, and
 * both pipeline filters since it was written.
 *
 * So what is asserted is the query string: a search, a sort and a filter each
 * reach D1, because the alternative implementation — narrowing a fetched page
 * in the browser — is exactly what the shared table exists to prevent. The
 * rest is what a visual review cannot see: that the list names itself, and
 * that each row activates through a real link saying where it goes.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  sponsorshipsListResponseSchema,
  type SponsorshipCompany,
  type SponsorshipsListResponse,
} from "../../assets/shared/schemas/sponsorship-management";
import { CompanyDetailPanel } from "../../assets/ts/member-flows/portal/sections/sponsors/management/CompanyDetailPanel";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const SPONSORSHIP_ID = "00000000-0000-4000-8000-000000000101";

const mounted: HTMLElement[] = [];

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

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  window.location.hash = "";
});

const COMPANY: SponsorshipCompany = {
  key: `org:${ORGANIZATION_ID}`,
  label: "Analytical Engines",
  website: null,
  sponsorshipCount: 1,
  stages: "active",
};

type CompanySponsorship = SponsorshipsListResponse["sponsorships"][number];

function sponsorship(overrides: Partial<CompanySponsorship> = {}): CompanySponsorship {
  return {
    id: SPONSORSHIP_ID,
    sponsorType: "event",
    organizationId: ORGANIZATION_ID,
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
  };
}

/** Serves one page, parsed through the shared contract so a drift in it fails here. */
function listPage(rows: CompanySponsorship[]): Response {
  return Response.json(
    sponsorshipsListResponseSchema.parse({
      sponsorships: rows,
      page: { limit: 50, offset: 0, total: rows.length, hasMore: false },
    }),
  );
}

function stubList(rows: CompanySponsorship[] = [sponsorship()]): URL[] {
  const requested: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      requested.push(new URL(String(input), "https://app.test"));
      return listPage(rows);
    }),
  );
  return requested;
}

async function panel(company: SponsorshipCompany = COMPANY): Promise<HTMLElement> {
  const container = mount(<CompanyDetailPanel selectedCompany={company} />);
  await settle();
  return container;
}

describe("one company's sponsorship list", () => {
  it("asks the sponsorships endpoint for this company's bounded page", async () => {
    const requested = stubList();
    await panel();

    const [url] = requested;
    expect(url.pathname).toBe("/api/v1/sponsors");
    // Staff visibility, the company the page is about, and a bounded page —
    // the browser receives one page, never the pipeline to narrow itself.
    expect(url.searchParams.get("visibility")).toBe("all");
    expect(url.searchParams.get("organizationId")).toBe(ORGANIZATION_ID);
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("offset")).toBe("0");
  });

  it("names a company that is only one unnamed sponsorship by that sponsorship", async () => {
    const requested = stubList();
    await panel({ ...COMPANY, key: `sponsorship:${SPONSORSHIP_ID}`, label: "Unspecified sponsor" });

    // A sponsorship with no organization, sponsor name or contact groups
    // under itself; its page is the same list query as every other company's,
    // rather than a record fetch rendered as a list of one.
    expect(requested[0].searchParams.get("sponsorshipId")).toBe(SPONSORSHIP_ID);
  });

  it("sends the reader's search to the query instead of filtering the page it holds", async () => {
    const requested = stubList();
    const container = await panel();

    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search).not.toBeNull();
    search!.value = "summit";
    await act(async () => {
      search!.dispatchEvent(new Event("input", { bubbles: true }));
      await settle();
    });
    await act(async () => {
      search!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await settle();
    });

    expect(requested.map((url) => url.searchParams.get("q"))).toContain("summit");
  });

  it("sorts in D1 through a column that says what the query understands", async () => {
    const requested = stubList();
    const container = await panel();

    const tier = [...container.querySelectorAll<HTMLButtonElement>("th button")].find((button) =>
      button.textContent?.includes("Tier"),
    );
    expect(tier).toBeDefined();
    await act(async () => {
      tier!.click();
      await settle();
    });

    expect(requested.map((url) => url.searchParams.get("sort"))).toContain("tier");
  });

  it("narrows by pipeline stage through the column's own menu, in the query", async () => {
    const requested = stubList();
    const container = await panel();

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Stage column options"]');
    if (!trigger) throw new Error("the stage column menu is not rendered");
    await act(async () => {
      trigger.click();
      await settle();
    });
    const contacted = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((item) =>
      item.textContent?.includes("Contacted"),
    );
    if (!contacted) throw new Error("the stage choices are not rendered");
    await act(async () => {
      contacted.click();
      await settle();
    });

    expect(requested.some((url) => url.searchParams.get("stage") === "contacted")).toBe(true);
  });

  it("captions the list and names each row after where it goes", async () => {
    stubList();
    const container = await panel();

    expect(container.querySelector("caption")?.textContent).toBe("Analytical Engines sponsorships");
    // The row's control says what it opens, not "View", and it is a link to
    // the sponsorship's own page — a record with facets is routed, not
    // expanded beside the table.
    const rowLink = container.querySelector<HTMLAnchorElement>("tbody a");
    expect(rowLink?.textContent).toBe("Open Gold — Summit 2026");
    expect(rowLink?.getAttribute("href")).toBe(`#/sponsors/${SPONSORSHIP_ID}`);
    // A <tr> is not focusable and takes no Enter key, so the handler must not
    // live on it — the control inside the cell is what activates.
    expect(container.querySelector("tbody tr")?.getAttribute("onclick")).toBeNull();
  });

  it("says why the list is empty rather than showing an unexplained blank", async () => {
    stubList([]);
    const container = await panel();

    expect(container.querySelector('[role="status"]')?.textContent).toContain("No sponsorships for this company");
  });

  it("states a failed load as a sentence instead of a status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "nope" }, { status: 403 })),
    );
    const container = await panel();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You don't have access to this");
    expect(container.textContent).not.toContain("HTTP 403");
    expect(container.querySelector("tbody tr")).toBeNull();
  });

  it("returns to the company list through the trail, a real link to the sponsors route", async () => {
    stubList();
    const container = await panel();

    // No back button: the page's trail names where it sits, and "Sponsors" is
    // a link the route reads to leave this company.
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.includes("Back"))).toBe(false);
    const crumb = [...container.querySelectorAll<HTMLAnchorElement>("a")].find((a) => a.textContent === "Sponsors");
    expect(crumb?.getAttribute("href")).toBe("#/sponsors");
  });
});
