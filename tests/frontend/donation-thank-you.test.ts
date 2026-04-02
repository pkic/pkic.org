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
    expect(fetchMock.mock.calls.some((call) => ((call[1] as RequestInit | undefined)?.method ?? "GET").toUpperCase() !== "GET")).toBe(false);
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