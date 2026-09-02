// @vitest-environment jsdom
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  donationDetailResponseSchema,
  donationsListResponseSchema,
  donationPromotersListResponseSchema,
  donationSyncRequestSchema,
} from "../../assets/shared/schemas/donation-management";
import { donationAnalyticsResponseSchema } from "../../assets/shared/schemas/analytics";
import { Donations } from "../../assets/ts/member-flows/portal/sections/system-donations/Donations";
import { DonationDetailPage } from "../../assets/ts/member-flows/portal/sections/system-donations/DonationDetailPage";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/donations", vi.fn()] }));

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

function response() {
  return new Response(
    JSON.stringify(
      donationsListResponseSchema.parse({
        donations: [],
        page: { limit: 50, offset: 0, total: 0, hasMore: false },
        summary: { byStatus: {}, backfillable: 0, syncable: 0 },
      }),
    ),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function donation() {
  return {
    id: "donation-1",
    checkout_session_id: "cs_test_1",
    payment_intent_id: null,
    name: "Ada Lovelace",
    email: "ada@example.test",
    organization: null,
    currency: "usd",
    gross_amount: 1000,
    net_amount: null,
    source: null,
    status: "completed" as const,
    payment_method_type: null,
    session_expires_at: null,
    settled_amount: null,
    settled_currency: null,
    created_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:00:00Z",
  };
}

function promotersResponse(promoters: unknown[]) {
  return new Response(
    JSON.stringify(
      donationPromotersListResponseSchema.parse({
        promoters,
        page: { limit: 50, offset: 0, total: promoters.length, hasMore: false },
        summary: {
          promoterCount: promoters.length,
          totalOwnGrossUsd: 5_000,
          totalAttributedGrossUsd: 12_500,
          totalClicks: 42,
          totalAttributedCompleted: 3,
        },
      }),
    ),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function promoter() {
  return {
    code: "ADA1",
    name: "Ada Lovelace",
    checkout_session_id: "cs_test_promoter",
    clicks: 42,
    own_gross: 5_000,
    own_gross_usd: 5_000,
    own_currency: "usd",
    attributed_total: 5,
    attributed_completed: 3,
    attributed_gross: 12_500,
    attributed_gross_usd: 12_500,
    currency: "usd",
    created_at: "2026-01-01T00:00:00Z",
  };
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

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  portalSession.value = null;
});

describe("portal system donations", () => {
  it("does not request donation records without donations:read", async () => {
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock);

    const container = mount(<Donations canRead={false} canSync={false} />);
    await settle();

    expect(container.textContent).toContain("donations:read");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets a synchronizer reconcile donations without fetching donor records", async () => {
    const requests: Array<{ url: URL; method: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push({
          url,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        });
        return new Response(
          JSON.stringify({
            synced: 0,
            completed: 0,
            awaitingPayment: 0,
            expired: 0,
            failed: 0,
            errors: 0,
            results: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const container = mount(<Donations canRead={false} canSync />);
    await settle();
    expect(requests).toEqual([]);
    expect(container.textContent).toContain("Sync donations");

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Sync donations"))!
        .click();
    });
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url.pathname).toBe("/api/v1/donations/sync");
    expect(requests[0]?.method).toBe("POST");
    // Checked against the contract the route enforces rather than a literal:
    // `donationSyncRequestSchema` is `.strict()`, so this also proves the
    // button sends nothing the server would reject, and that a full
    // reconciliation is an empty body rather than a stray `pendingOnly`.
    const syncBody = donationSyncRequestSchema.safeParse(requests[0]?.body);
    expect(syncBody.success ? syncBody.data : syncBody.error.message).toEqual({});
  });

  it("uses only canonical system list requests and hides sync controls without donations:sync", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return response();
      }),
    );

    const container = mount(<Donations canSync={false} />);
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.pathname).toBe("/api/v1/donations");
    expect(requests.some((url) => url.pathname.startsWith("/api/v1/admin/donations"))).toBe(false);
    expect(container.textContent).not.toContain("Sync all");
    expect(container.textContent).not.toContain("Sync pending");
    expect(container.textContent).toContain("No donations recorded yet");
  });

  it("uses canonical system endpoints for promoter and detail views", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        if (url.pathname === "/api/v1/donations/promoters") {
          return new Response(
            JSON.stringify(
              donationPromotersListResponseSchema.parse({
                promoters: [],
                page: { limit: 50, offset: 0, total: 0, hasMore: false },
                summary: {
                  promoterCount: 0,
                  totalOwnGrossUsd: 0,
                  totalAttributedGrossUsd: 0,
                  totalClicks: 0,
                  totalAttributedCompleted: 0,
                },
              }),
            ),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify(donationDetailResponseSchema.parse({ donation: donation() })), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const promoters = mount(<Donations subTab="promoters" />);
    await settle();
    expect(requests[0]?.pathname).toBe("/api/v1/donations/promoters");
    expect(promoters.textContent).toContain("No promoter links yet");

    const detail = mount(<DonationDetailPage donationId="donation-1" />);
    await settle();
    expect(requests.at(-1)?.pathname).toBe("/api/v1/donations/donation-1");
    expect(detail.textContent).toContain("Ada Lovelace");
  });

  it("renders the donation analytics on the Stats tab for a global analytics reader", async () => {
    portalSession.value = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "analytics:read", contextType: null, contextId: null }],
    });
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return new Response(
          JSON.stringify({
            generatedAt: "2026-08-28T12:00:00.000Z",
            donations: {
              byStatus: { completed: 1 },
              byCurrency: [],
              totals: { grossUsd: 1_000, netUsd: 900 },
              daily: [],
              weekly: [],
              monthly: [],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const container = mount(<Donations subTab="stats" />);
    await settle();

    expect(requests[0]?.pathname).toBe("/api/v1/analytics/donations");
    expect(container.textContent).toContain("Total Gross (USD)");
    expect(container.textContent).toContain("Stats");
  });

  it("does not offer the Stats tab or fetch analytics without analytics:read", async () => {
    portalSession.value = portalSessionFixture({ staff: true, staffRole: "user", grants: [] });
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return response();
      }),
    );

    const container = mount(<Donations subTab="stats" />);
    await settle();

    expect(container.textContent).not.toContain("Stats");
    expect(requests.some((url) => url.pathname === "/api/v1/analytics/donations")).toBe(false);
  });

  it("names the donation table and exposes each status filter's pressed state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );

    const container = mount(<Donations canSync={false} />);
    await settle();

    // A <table> with no <caption> is announced as "table"; this page carries
    // several, so each one has to say which it is.
    expect(captions(container)).toContain("Donations");

    // The status filter is the Status column's own menu, like every list's
    // filters; the choice in force is a checked radio item, so it survives
    // without sight of the control. No chips above the table any more.
    expect(container.querySelector("button[aria-pressed]")).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Status column options"]');
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // The column sorts as well, so its menu opens with the two sort
    // directions; the six statuses ("All" first) follow, each with its count.
    const choices = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).filter(
      (c) => !c.textContent?.includes("Sort "),
    );
    expect(
      choices.map((c) =>
        c.textContent
          ?.replace(/^✓/, "")
          .trim()
          .replace(/ \(\d+\)$/, ""),
      ),
    ).toEqual(["All", "Pending", "Awaiting", "Completed", "Expired", "Failed"]);
    const checked = choices.filter((c) => c.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toContain("All");
  });

  it("names the promoter leaderboard and reaches each share link by keyboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        return url.pathname === "/api/v1/donations/promoters" ? promotersResponse([promoter()]) : response();
      }),
    );

    const container = mount(<Donations subTab="promoters" />);
    await settle();

    expect(captions(container)).toContain("Promoter share links, ranked by total impact");
    expect(Array.from(container.querySelectorAll("th")).map((cell) => cell.textContent)).toContain("Total impact");

    // The share link is a real anchor, not a click handler on a card div, so
    // it is in the tab order and can be opened in a new tab.
    const link = container.querySelector<HTMLAnchorElement>('a[href="/donate/r/ADA1"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("/donate/r/ADA1");
    expect(container.textContent).toContain("Ada Lovelace");
  });

  it("reports a failed promoter request as an alert instead of an empty leaderboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        return url.pathname === "/api/v1/donations/promoters" ? serverError() : response();
      }),
    );

    const container = mount(<Donations subTab="promoters" />);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Something went wrong on our side");
    // "No promoter links yet" would claim the list is empty when it is unknown.
    expect(container.textContent).not.toContain("No promoter links yet");
    expect(captions(container)).not.toContain("Promoter share links, ranked by total impact");
  });

  it("names every analytics table and reports a failed analytics request as an alert", async () => {
    portalSession.value = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "analytics:read", contextType: null, contextId: null }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => analyticsResponse()),
    );

    const ok = mount(<Donations subTab="stats" />);
    await settle();

    expect(captions(ok)).toEqual(
      expect.arrayContaining([
        "Donations by status and currency",
        "Donations — Daily (last 30 days)",
        "Donations — Weekly (last 12 weeks)",
        "Donations — Monthly (last 12 months)",
      ]),
    );
    expect(ok.textContent).toContain("Total Gross (USD)");

    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => serverError()),
    );

    const failed = mount(<Donations subTab="stats" />);
    await settle();

    expect(failed.querySelector('[role="alert"]')?.textContent).toContain("Something went wrong on our side");
    expect(captions(failed)).toEqual([]);
  });

  it("presents the donation record as a term/value list a screen reader can walk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              donationDetailResponseSchema.parse({
                donation: { ...donation(), organization: "Analytical Engines Ltd", payment_intent_id: "pi_test_1" },
              }),
            ),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const detail = mount(<DonationDetailPage donationId="donation-1" />);
    await settle();

    // The record is one named region, not an unlabeled div of divs.
    const record = detail.querySelector('[aria-label="Donation from Ada Lovelace"]');
    expect(record).not.toBeNull();
    const terms = [...detail.querySelectorAll("dl.pk-datalist > dt")].map((term) => term.textContent);
    expect(terms).toEqual([
      "Email",
      "Organization",
      "Gross",
      "Net",
      "Method",
      "Source",
      "Session ID",
      "Payment intent",
      "Created",
      "Completed",
    ]);
    expect(detail.querySelectorAll("dl.pk-datalist > dd")).toHaveLength(terms.length);
    // The badge is fetched from a URL, so it stays a link rather than a button.
    const badge = detail.querySelector<HTMLAnchorElement>("a[download]");
    expect(badge?.textContent).toBe("Download badge");
  });

  it("states a permission refusal in words and asks the API for nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const denied = mount(<DonationDetailPage donationId="donation-1" canRead={false} />);
    await settle();

    const alert = denied.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("donations:read");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("states a failed donation fetch as a sentence rather than the record it could not load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => serverError()),
    );

    const detail = mount(<DonationDetailPage donationId="donation-1" />);
    await settle();

    expect(detail.querySelector('[role="alert"]')?.textContent).toContain("Something went wrong on our side");
    expect(detail.querySelector("dl.pk-datalist")).toBeNull();
  });
});
