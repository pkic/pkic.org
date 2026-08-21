// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { SponsorshipDetail } from "../../assets/ts/admin/sections/Sponsorships/SponsorshipDetail";
import { useSponsorshipEventHistory } from "../../assets/ts/admin/sections/Sponsorships/useSponsorshipEventHistory";

type HistoryState = ReturnType<typeof useSponsorshipEventHistory>;

interface PendingFetch {
  url: string;
  resolve: (response: Response) => void;
}

function Harness(props: { id: string; onState: (state: HistoryState) => void }) {
  const state = useSponsorshipEventHistory(props.id);
  props.onState(state);
  return null;
}

function event(id: string, toStage: "new_inquiry" | "active") {
  return {
    id,
    fromStage: toStage === "active" ? ("new_inquiry" as const) : null,
    toStage,
    actorUserId: null,
    actorName: null,
    note: null,
    createdAt: "2026-08-21T12:00:00.000Z",
  };
}

function historyResponse(events: ReturnType<typeof event>[], total = events.length, offset = 0, limit = 25) {
  return Response.json({ events, page: { limit, offset, total, hasMore: offset + events.length < total } });
}

function sponsorshipResponse(id: string) {
  return Response.json({
    sponsorship: {
      id,
      sponsorType: "consortium",
      organizationId: null,
      organizationName: "Acme Sponsor",
      nonMemberName: null,
      nonMemberWebsite: null,
      nonMemberLogoUrl: null,
      contactName: null,
      contactEmail: null,
      eventId: null,
      eventName: null,
      tier: "Gold",
      pipelineStage: "active",
      startDate: null,
      renewalDate: null,
      assignedToUserId: null,
      assignedToName: null,
      notes: null,
      priceAmountCents: null,
      priceCurrency: null,
      createdAt: "2026-08-21T12:00:00.000Z",
      updatedAt: "2026-08-21T12:00:00.000Z",
    },
  });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("sponsorship event history", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("rejects a stale sponsorship response after the selected sponsorship changes", async () => {
    const pending: PendingFetch[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = input.toString();
        return new Promise<Response>((resolve) => pending.push({ url, resolve }));
      }),
    );
    const container = document.createElement("div");
    let latest!: HistoryState;
    const onState = (state: HistoryState) => {
      latest = state;
    };

    await act(() => render(h(Harness, { id: "sponsor-a", onState }), container));
    await act(() => render(h(Harness, { id: "sponsor-b", onState }), container));
    expect(pending.map(({ url }) => url)).toEqual([
      "/api/v1/admin/sponsorships/sponsor-a/events",
      "/api/v1/admin/sponsorships/sponsor-b/events",
    ]);

    await act(async () => {
      pending[1].resolve(historyResponse([event("00000000000000000000000000000002", "active")]));
      await flush();
    });
    await act(async () => {
      pending[0].resolve(historyResponse([event("00000000000000000000000000000001", "new_inquiry")]));
      await flush();
    });

    expect(latest.events.map(({ toStage }) => toStage)).toEqual(["active"]);
    expect(latest.loading).toBe(false);
    void act(() => render(null, container));
  });

  it("deduplicates synchronous load-more actions and uses the server-owned page size", async () => {
    const pending: PendingFetch[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (input: RequestInfo | URL) =>
          new Promise<Response>((resolve) => pending.push({ url: input.toString(), resolve })),
      ),
    );
    const container = document.createElement("div");
    let latest!: HistoryState;
    const onState = (state: HistoryState) => {
      latest = state;
    };
    await act(() => render(h(Harness, { id: "sponsor", onState }), container));
    await act(async () => {
      pending[0].resolve(historyResponse([event("00000000000000000000000000000002", "active")], 2, 0, 1));
      await flush();
    });

    void act(() => {
      latest.loadMore();
      latest.loadMore();
    });
    expect(pending).toHaveLength(2);
    expect(pending[1].url).toBe("/api/v1/admin/sponsorships/sponsor/events?limit=1&offset=1");
    await act(async () => {
      pending[1].resolve(historyResponse([event("00000000000000000000000000000001", "new_inquiry")], 2, 1, 1));
      await flush();
    });
    expect(latest.events.map(({ toStage }) => toStage)).toEqual(["active", "new_inquiry"]);
    expect(latest.loadingMore).toBe(false);
    void act(() => render(null, container));
  });

  it("runtime-validates the response and exposes a retryable history-only error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          events: [{ ...event("00000000000000000000000000000001", "active"), toStage: "invented" }],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );
    const container = document.createElement("div");
    let latest!: HistoryState;
    await act(() =>
      render(
        h(Harness, {
          id: "sponsor",
          onState: (state) => {
            latest = state;
          },
        }),
        container,
      ),
    );
    await act(flush);
    expect(latest.events).toEqual([]);
    expect(latest.error).toBe("Received an invalid pipeline history response.");
    expect(latest.retry).toBeTypeOf("function");
    void act(() => render(null, container));
  });

  it("keeps sponsorship detail visible when history fails and supports an inline empty-state retry", async () => {
    const id = "000000000000000000000000000000aa";
    let historyRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (!url.endsWith("/events")) return sponsorshipResponse(id);
        historyRequests += 1;
        return historyRequests === 1
          ? Response.json({ error: { code: "HISTORY_FAILED", message: "History unavailable" } }, { status: 500 })
          : historyResponse([]);
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    await act(() => render(h(SponsorshipDetail, { id, onChanged: vi.fn() }), container));
    await act(flush);

    expect(container.textContent).toContain("Acme Sponsor");
    expect(container.textContent).toContain("History unavailable");
    const alert = container.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("Retry history");
    await act(async () => {
      (alert?.querySelector("button") as HTMLButtonElement).click();
      await flush();
    });
    expect(historyRequests).toBe(2);
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(container.textContent).toContain("No pipeline history has been recorded.");
    expect(container.querySelector("section")?.getAttribute("aria-busy")).toBe("false");
    void act(() => render(null, container));
  });

  it("renders history as a labelled chronological list with machine-readable timestamps", async () => {
    const id = "000000000000000000000000000000aa";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        input.toString().endsWith("/events")
          ? historyResponse([event("00000000000000000000000000000002", "active")])
          : sponsorshipResponse(id),
      ),
    );
    const container = document.createElement("div");
    await act(() => render(h(SponsorshipDetail, { id, onChanged: vi.fn() }), container));
    await act(flush);

    const section = container.querySelector("section");
    expect(section?.getAttribute("aria-labelledby")).toBe(`sponsorship-history-heading-${id}`);
    expect(section?.querySelectorAll("ol > li")).toHaveLength(1);
    expect(section?.querySelector("time")?.getAttribute("datetime")).toBe("2026-08-21T12:00:00.000Z");
    expect(section?.querySelector("[aria-live='polite']")?.textContent).toContain("1 history entry loaded");
    void act(() => render(null, container));
  });
});
