// @vitest-environment jsdom
import { render, type VNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyticsOverview } from "../../assets/ts/member-flows/portal/sections/system-analytics/AnalyticsOverview";
import { RegistrationAnalytics } from "../../assets/ts/member-flows/portal/sections/system-analytics/RegistrationAnalytics";
import { SystemAnalytics } from "../../assets/ts/member-flows/portal/sections/system-analytics/SystemAnalytics";

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: { href: string; children: preact.ComponentChildren }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mountNode(node: VNode): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

function mount(initialTab?: string): HTMLElement {
  return mountNode(<SystemAnalytics initialTab={initialTab} />);
}

/** Every table name on the surface, the charts' hidden tables included. */
function captions(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("table > caption")).map((caption) => caption.textContent ?? "");
}

function headings(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("h2")).map((heading) => heading.textContent ?? "");
}

/** A response with no JSON body, which is what a server fault looks like here. */
function failure(status: number): Response {
  return new Response(null, { status });
}

const SUMMARY = {
  generatedAt: "2026-08-28T12:00:00.000Z",
  registrations: { byStatus: { registered: 2 }, total: 2 },
  invites: { byStatus: { sent: 1 }, total: 1 },
  email: { outboxByStatus: { queued: 1 }, totalQueued: 1, totalFailed: 3, totalBounced: 1 },
  donations: { byStatus: { completed: 1 }, totals: { grossUsd: 1_000, netUsd: 900 } },
  topEvents: [{ slug: "summit", name: "Summit", confirmed: 2, total: 2 }],
  recentActivity: [{ date: "2026-08-27", registrations: 2, invites: 1 }],
};

const REGISTRATIONS = {
  generatedAt: "2026-08-28T12:00:00.000Z",
  registrations: {
    byStatus: { registered: 2 },
    byAttendanceType: { in_person: 2 },
    total: 2,
    weekly: [{ week: "2026-W34", count: 2 }],
    monthly: [{ month: "2026-08", count: 2 }],
  },
};

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal System Analytics", () => {
  it("loads only the focused domain endpoint for the selected tab, never calls a legacy API, and no longer lists Donations", async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        paths.push(url.pathname);
        if (url.pathname.endsWith("/summary")) {
          return json({
            generatedAt: "2026-08-28T12:00:00.000Z",
            registrations: { byStatus: { registered: 2 }, total: 2 },
            invites: { byStatus: { sent: 1 }, total: 1 },
            email: { outboxByStatus: { queued: 1 }, totalQueued: 1, totalFailed: 0, totalBounced: 0 },
            donations: { byStatus: { completed: 1 }, totals: { grossUsd: 1_000, netUsd: 900 } },
            topEvents: [{ slug: "summit", name: "Summit", confirmed: 2, total: 2 }],
            recentActivity: [],
          });
        }
        if (url.pathname.endsWith("/registrations")) {
          return json({
            generatedAt: "2026-08-28T12:00:00.000Z",
            registrations: {
              byStatus: { registered: 2 },
              byAttendanceType: { in_person: 2 },
              total: 2,
              weekly: [{ week: "2026-W34", count: 2 }],
              monthly: [{ month: "2026-08", count: 2 }],
            },
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const overview = mount();
    await settle();
    expect(overview.textContent).toContain("Total Registrations");
    const tabLabels = Array.from(overview.querySelectorAll('nav[aria-label="System analytics"] a')).map(
      (a) => a.textContent,
    );
    expect(tabLabels).toEqual(["Overview", "Registrations"]);
    expect(tabLabels).not.toContain("Donations");
    expect(paths).toEqual(["/api/v1/analytics/summary"]);

    void act(() => render(null, overview));
    const registrations = mount("registrations");
    await settle();
    expect(registrations.textContent).toContain("2026-W34");
    expect(paths.at(-1)).toBe("/api/v1/analytics/registrations");
    expect(paths.some((path) => path.startsWith("/api/v1/admin/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("/api/v1/system/analytics/"))).toBe(false);
    expect(paths.some((path) => path.endsWith("/analytics/donations"))).toBe(false);

    // Even if a stale hash still points at the retired donations sub-tab,
    // System Analytics falls back to Overview rather than rendering it.
    void act(() => render(null, registrations));
    const staleDonationsTab = mount("donations");
    await settle();
    expect(staleDonationsTab.textContent).toContain("Total Registrations");
    expect(paths.at(-1)).toBe("/api/v1/analytics/summary");
  });

  it("escapes database-controlled status labels in generated chart markup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          generatedAt: "2026-08-28T12:00:00.000Z",
          registrations: { byStatus: { '<img src=x onerror="alert(1)">': 1 }, total: 1 },
          invites: { byStatus: {}, total: 0 },
          email: { outboxByStatus: {}, totalQueued: 0, totalFailed: 0, totalBounced: 0 },
          donations: { byStatus: {}, totals: { grossUsd: 0, netUsd: 0 } },
          topEvents: [],
          recentActivity: [],
        }),
      ),
    );

    const container = mount();
    await settle();
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).toContain("&lt;img");
  });
});

describe("System Analytics Overview on the design system", () => {
  it("names each region and table, and says an alarming count in words rather than in color", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(SUMMARY)),
    );

    const container = mountNode(<AnalyticsOverview />);
    await settle();

    // Each card is a Panel, so its title is a real heading instead of a `h6`
    // carrying its own type scale.
    expect(headings(container)).toEqual(["Registrations by Status", "Top Events", "Activity — last 30 days"]);
    expect(captions(container)).toContain("Top events by registrations");

    // Failed emails were tinted red. The tint is gone; the meaning is not.
    const failedEmails = Array.from(container.querySelectorAll(".pk-stat-card")).find((card) =>
      card.textContent?.includes("Failed Emails"),
    );
    expect(failedEmails?.textContent).toContain("Needs attention");

    expect(container.querySelector(".pk")).not.toBeNull();
    expect(container.querySelector(".card, .row, [class*='col-md'], .text-muted, .fw-bold")).toBeNull();
  });

  it("reports a failed summary request as an alert instead of an empty dashboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => failure(500)),
    );

    const container = mountNode(<AnalyticsOverview />);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(
      "Something went wrong on our side. Try again, and let us know if it keeps happening.",
    );
    expect(headings(container)).toEqual([]);
    expect(container.querySelector("table")).toBeNull();
  });

  it("announces the wait in a named status region while the summary is in flight", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    const container = mountNode(<AnalyticsOverview />);

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Loading analytics…");
  });
});

describe("System Analytics Registrations on the design system", () => {
  it("gives each chart and its period table a distinct name, so no two tables are announced alike", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(REGISTRATIONS)),
    );

    const container = mountNode(<RegistrationAnalytics />);
    await settle();

    expect(headings(container)).toEqual([
      "By Status",
      "By Attendance Type",
      "Registrations — Weekly (last 12 weeks)",
      "Registrations — Monthly (last 12 months)",
    ]);

    const names = captions(container);
    // The chart emits its own hidden data table; the visible one beside it is
    // named for the panel, so the pair does not read as the same table twice.
    expect(names).toContain("Registrations per week");
    expect(names).toContain("Registrations — Weekly (last 12 weeks)");
    expect(new Set(names).size).toBe(names.length);

    expect(container.querySelector(".pk")).not.toBeNull();
    expect(container.querySelector(".card, .row, [class*='col-md'], .text-muted, .fw-bold")).toBeNull();
  });

  it("reports an unavailable registrations endpoint as an alert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => failure(503)),
    );

    const container = mountNode(<RegistrationAnalytics />);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("The service is temporarily unavailable. Try again in a moment.");
    expect(container.querySelector("table")).toBeNull();
  });

  it("names what is loading rather than spinning anonymously", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    const container = mountNode(<RegistrationAnalytics />);

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Loading registration analytics…");
  });
});
