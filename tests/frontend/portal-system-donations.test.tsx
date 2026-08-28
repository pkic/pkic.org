// @vitest-environment jsdom
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  donationDetailResponseSchema,
  donationsListResponseSchema,
  donationPromotersListResponseSchema,
} from "../../assets/shared/schemas/donation-management";
import { Donations } from "../../assets/ts/member-flows/portal/sections/system-donations/Donations";
import { DonationDetailPage } from "../../assets/ts/member-flows/portal/sections/system-donations/DonationDetailPage";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/system/donations", vi.fn()] }));

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

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
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

    expect(requests).toEqual([
      expect.objectContaining({
        url: expect.objectContaining({ pathname: "/api/v1/donations/sync" }),
        method: "POST",
        body: {},
      }),
    ]);
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
    expect(container.textContent).toContain("No donations found");
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
});
