// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function mount(initialTab?: string): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(<SystemAnalytics initialTab={initialTab} />, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal System Analytics", () => {
  it("loads only the focused domain endpoint for the selected tab and never calls a legacy API", async () => {
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
        if (url.pathname.endsWith("/donations")) {
          return json({
            generatedAt: "2026-08-28T12:00:00.000Z",
            donations: {
              byStatus: { completed: 1 },
              byCurrency: [],
              totals: { grossUsd: 1_000, netUsd: 900 },
              daily: [],
              weekly: [],
              monthly: [],
            },
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const overview = mount();
    await settle();
    expect(overview.textContent).toContain("Total Registrations");
    expect(paths).toEqual(["/api/v1/analytics/summary"]);

    void act(() => render(null, overview));
    const registrations = mount("registrations");
    await settle();
    expect(registrations.textContent).toContain("2026-W34");
    expect(paths.at(-1)).toBe("/api/v1/analytics/registrations");

    void act(() => render(null, registrations));
    const donations = mount("donations");
    await settle();
    expect(donations.textContent).toContain("Total Gross (USD)");
    expect(paths.at(-1)).toBe("/api/v1/analytics/donations");
    expect(paths.some((path) => path.startsWith("/api/v1/admin/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("/api/v1/system/analytics/"))).toBe(false);
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
