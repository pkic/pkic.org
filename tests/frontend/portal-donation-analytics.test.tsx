// @vitest-environment jsdom
/**
 * The donation analytics page: who may open it, and how its period views are
 * arranged now that they are tabs on one page rather than four tables stacked
 * down it (#43).
 */
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { donationAnalyticsResponseSchema } from "../../assets/shared/schemas/analytics";
import { Donations } from "../../assets/ts/member-flows/portal/sections/system-donations/Donations";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { isCurrentTab, tabNamed, tabNames } from "./helpers/tabs";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/donations/analytics", vi.fn()] }));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

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

function analyticsReader() {
  return portalSessionFixture({
    staff: true,
    staffRole: "user",
    grants: [{ permission: "analytics:read", contextType: null, contextId: null }],
  });
}

function period(month: string) {
  return {
    month,
    count: 4,
    completed: 3,
    pending: 1,
    failed: 0,
    expired: 0,
    gross: 4_000,
    grossUsd: 4_000,
    netUsd: 3_800,
  };
}

function analyticsResponse() {
  return new Response(
    JSON.stringify(
      donationAnalyticsResponseSchema.parse({
        generatedAt: "2026-08-28T12:00:00.000Z",
        donations: {
          byStatus: { completed: 3 },
          byCurrency: [
            {
              status: "completed",
              currency: "usd",
              count: 3,
              totalGross: 4_000,
              averageGross: 1_333,
              totalNet: 3_800,
              totalGrossUsd: 4_000,
            },
          ],
          totals: { grossUsd: 4_000, netUsd: 3_800 },
          daily: [],
          weekly: [],
          monthly: [period("2026-08")],
        },
      }),
    ),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** A route that fails, so the surface's error path is exercised rather than assumed. */
function serverError() {
  return new Response(JSON.stringify({ error: { code: "HTTP_ERROR", message: "HTTP 500" } }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
}

function captions(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("caption")).map((caption) => caption.textContent ?? "");
}

function requestRecorder(respond: () => Response): { requests: URL[] } {
  const requests: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      requests.push(url);
      return respond();
    }),
  );
  return { requests };
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  portalSession.value = null;
});

describe("portal donation analytics", () => {
  it("renders the analytics page for a global analytics reader", async () => {
    portalSession.value = analyticsReader();
    const { requests } = requestRecorder(analyticsResponse);

    const container = mount(<Donations pageSegment="analytics" />);
    await settle();

    expect(requests[0]?.pathname).toBe("/api/v1/analytics/donations");
    expect(container.textContent).toContain("Total Gross (USD)");
    // The page is its own place under Donations now, not a tab above the list.
    expect(container.querySelector(".pk-page-header__title")?.textContent).toBe("Donation analytics");
  });

  it("refuses the analytics page and fetches nothing without analytics:read", async () => {
    portalSession.value = portalSessionFixture({ staff: true, staffRole: "user", grants: [] });
    const { requests } = requestRecorder(analyticsResponse);

    const container = mount(<Donations pageSegment="analytics" />);
    await settle();

    // The refusal names the permission that is missing rather than quietly
    // showing the donation list at the analytics address.
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("analytics:read");
    expect(requests.some((url) => url.pathname === "/api/v1/analytics/donations")).toBe(false);
  });

  it("shows one period view at a time, each at its own address (#43)", async () => {
    portalSession.value = analyticsReader();
    requestRecorder(analyticsResponse);

    // The four tables used to be stacked down one page; each is a tab now, so
    // the view a reader opens is the only one on screen.
    const byStatus = mount(<Donations pageSegment="analytics" />);
    await settle();
    expect(tabNames(byStatus)).toEqual(["By status", "Daily", "Weekly", "Monthly"]);
    expect(captions(byStatus)).toEqual(["Donations by status and currency"]);
    // The totals belong to every view, so they stay above the strip.
    expect(byStatus.textContent).toContain("Total Gross (USD)");

    const weekly = mount(<Donations pageSegment="analytics" view="weekly" />);
    await settle();
    expect(captions(weekly)).toEqual(["Donations — Weekly (last 12 weeks)"]);
    expect(isCurrentTab(tabNamed(weekly, "Weekly"))).toBe(true);
    expect(isCurrentTab(tabNamed(weekly, "By status"))).toBe(false);

    const monthly = mount(<Donations pageSegment="analytics" view="monthly" />);
    await settle();
    // The monthly view draws its charts as well, and each of those names
    // itself; what matters is that no other period's table is on the page.
    expect(captions(monthly)).toContain("Donations — Monthly (last 12 months)");
    expect(captions(monthly)).not.toContain("Donations — Weekly (last 12 weeks)");

    // Every view is a link, so it can be shared and the back button works.
    expect(tabNamed(monthly, "Daily")?.getAttribute("href")).toBe("#/donations/analytics/daily");
    expect(tabNamed(monthly, "By status")?.getAttribute("href")).toBe("#/donations/analytics");
  });

  it("reports a failed analytics request as an alert rather than empty tables", async () => {
    portalSession.value = analyticsReader();
    requestRecorder(serverError);

    const failed = mount(<Donations pageSegment="analytics" view="daily" />);
    await settle();

    expect(failed.querySelector('[role="alert"]')?.textContent).toContain("Something went wrong on our side");
    expect(captions(failed)).toEqual([]);
  });
});
