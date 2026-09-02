// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { useCompanySponsorships } from "../../assets/ts/member-flows/portal/sections/sponsors/management/useCompanySponsorships";
import type { Sponsorship, SponsorshipCompany } from "../../assets/shared/schemas/sponsorship-management";

/**
 * P7-R01 (Phase 7 line-by-line review): the company-detail panel's "Load
 * more" and type/stage-filter fetches shared no request-generation guard, so
 * an earlier "Load more" response could land after a newer filter-change
 * response and stale-append onto the wrong filtered set. This exercises the
 * actual out-of-order scenario against the real hook (not just the pure
 * merge helper, which is already covered by sponsorships-company-detail.test.ts)
 * to prove the guard in useCompanySponsorships.ts closes it.
 */

type HookState = ReturnType<typeof useCompanySponsorships>;

function Harness(props: { onState: (state: HookState) => void }) {
  const state = useCompanySponsorships();
  props.onState(state);
  return null;
}

function sponsorship(id: string): Sponsorship {
  return {
    id,
    sponsorType: "consortium",
    organizationId: null,
    organizationName: null,
    nonMemberName: null,
    nonMemberWebsite: null,
    nonMemberLogoUrl: null,
    contactName: null,
    contactEmail: null,
    eventId: null,
    eventName: null,
    tier: null,
    pipelineStage: "active",
    startDate: null,
    renewalDate: null,
    assignedToUserId: null,
    assignedToName: null,
    notes: null,
    priceAmountCents: null,
    priceCurrency: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const company: SponsorshipCompany = {
  key: "org:abc-123",
  label: "Acme Inc",
  website: null,
  sponsorshipCount: 3,
  stages: "active",
};

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface PendingFetch {
  url: string;
  resolve: (response: Response) => void;
}

describe("useCompanySponsorships out-of-order responses (P7-R01)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ignores a stale 'Load more' response that resolves after a newer filter-change response", async () => {
    const pending: PendingFetch[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        return new Promise<Response>((resolve) => {
          pending.push({ url, resolve });
        });
      }),
    );

    const container = document.createElement("div");
    let latest!: HookState;
    const onState = (state: HookState) => {
      latest = state;
    };

    await act(() => {
      render(h(Harness, { onState }), container);
    });

    // Select the company: fires the initial offset-0 fetch.
    await act(() => {
      latest.selectCompany(company);
    });
    expect(pending).toHaveLength(1);
    await act(async () => {
      pending[0].resolve(
        Response.json({
          sponsorships: [
            sponsorship("00000000-0000-4000-8000-000000000001"),
            sponsorship("00000000-0000-4000-8000-000000000002"),
          ],
          page: { limit: 200, offset: 0, total: 250, hasMore: true },
        }),
      );
      await flush();
    });
    expect(latest.companySponsorships.map((s) => s.id)).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ]);

    // User clicks "Load more" — request A (offset=200, old filters) goes out
    // but does not resolve yet.
    await act(() => {
      latest.loadMore();
    });
    expect(pending).toHaveLength(2);
    expect(latest.companyLoadingMore).toBe(true);

    // Before A resolves, the company is reloaded — request B (offset=0) goes
    // out, issued strictly after A.
    await act(() => {
      latest.reload();
    });
    expect(pending).toHaveLength(3);

    // B resolves first, even though it was issued second.
    await act(async () => {
      pending[2].resolve(
        Response.json({
          sponsorships: [sponsorship("00000000-0000-4000-8000-000000000003")],
          page: { limit: 200, offset: 0, total: 1, hasMore: false },
        }),
      );
      await flush();
    });
    expect(latest.companySponsorships.map((s) => s.id)).toEqual(["00000000-0000-4000-8000-000000000003"]);

    // A finally resolves, arriving after B. Without the request-generation
    // guard this would append A's (now-stale, old-filter) row onto B's
    // current filtered result. It must be dropped instead.
    await act(async () => {
      pending[1].resolve(
        Response.json({
          sponsorships: [sponsorship("00000000-0000-4000-8000-000000000004")],
          page: { limit: 200, offset: 200, total: 250, hasMore: true },
        }),
      );
      await flush();
    });

    expect(latest.companySponsorships.map((s) => s.id)).toEqual(["00000000-0000-4000-8000-000000000003"]);
    expect(latest.companyPage).toEqual({ limit: 200, offset: 0, total: 1, hasMore: false });
    // The superseded "Load more" call must still clear its own loading flag —
    // being ignored for data purposes should not leave the spinner stuck on.
    expect(latest.companyLoadingMore).toBe(false);
  });
});
