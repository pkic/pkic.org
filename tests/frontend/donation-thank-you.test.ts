// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("donation thank-you page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    document.body.innerHTML = `
      <div data-donation-badge hidden></div>
      <div data-donation-pending-content hidden><p>Pending confirmation.</p></div>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = "";
  });

  it("does not call the promoter endpoint while the donation remains pending", async () => {
    window.history.replaceState({}, "", "/donate/complete/?session_id=cs_test_pending_frontend");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/donations/session?session_id=")) {
        return new Response(JSON.stringify({ pending: true }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await import("../../assets/ts/shared/donation-thank-you");
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([input]) => String(input).includes("/api/v1/donations/session?session_id="))).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/donations/promoter"))).toBe(false);
    expect(
      fetchMock.mock.calls.some((call) => {
        const [, init] = call as unknown as [RequestInfo | URL, RequestInit | undefined];
        return ((init?.method ?? "GET").toUpperCase() !== "GET");
      }),
    ).toBe(false);
  });

  it("shows bank-transfer pending message and continues polling until confirmed", async () => {
    window.history.replaceState({}, "", "/donate/complete/?session_id=cs_test_async_frontend");

    let callCount = 0;
    // First call returns asyncPayment:true; subsequent calls also return it
    // (simulating a payment that hasn't settled within the test window).
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/donations/session?session_id=")) {
        callCount++;
        return new Response(JSON.stringify({ pending: true, asyncPayment: true }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await import("../../assets/ts/shared/donation-thank-you");
    await vi.runAllTimersAsync();

    // Should have polled more than once (phase 1 + at least one phase 2 poll)
    expect(callCount).toBeGreaterThan(1);
    // Promoter endpoint must not be called (no confirmed payment)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v1/donations/promoter"))).toBe(false);
    // Container should be visible with the async-pending message
    const container = document.querySelector<HTMLElement>("[data-donation-badge]");
    expect(container?.hidden).toBe(false);
    expect(container?.innerHTML).toContain("being processed");
  });

  it("shows badge when bank transfer confirms during async polling", async () => {
    window.history.replaceState({}, "", "/donate/complete/?session_id=cs_test_async_confirmed");

    let callCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/donations/session?session_id=")) {
        callCount++;
        if (callCount <= 2) {
          // First two calls: asyncPayment pending (phase 1 + first phase 2 poll)
          return new Response(JSON.stringify({ pending: true, asyncPayment: true }), {
            status: 202,
            headers: { "content-type": "application/json" },
          });
        }
        // Third call: payment confirmed
        return new Response(JSON.stringify({
          grossAmount: 5000,
          currency: "usd",
          donorFirstName: "Alice",
          source: null,
          completedAt: "2026-04-10T10:00:00Z",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Promoter POST — expected after confirmation
      if (url.includes("/api/v1/donations/promoter")) {
        return new Response(JSON.stringify({ code: "abc123", shareUrl: "https://pkic.org/donate/r/abc123", ogImageUrl: "" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await import("../../assets/ts/shared/donation-thank-you");
    await vi.runAllTimersAsync();

    // Container should now show the full badge (amount visible)
    const container = document.querySelector<HTMLElement>("[data-donation-badge]");
    expect(container?.hidden).toBe(false);
    expect(container?.innerHTML).toContain("donation-badge-amount");
  });

  it("does not fetch anything when the session_id is missing or invalid", async () => {
    window.history.replaceState({}, "", "/donate/complete/?session_id=invalid");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await import("../../assets/ts/shared/donation-thank-you");
    await vi.runAllTimersAsync();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});