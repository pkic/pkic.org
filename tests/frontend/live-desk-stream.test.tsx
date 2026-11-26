// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import {
  LIVE_DESK_STREAM_RETRY_MS,
  LiveDeskStream,
} from "../../assets/ts/member-flows/portal/sections/events/detail/live/LiveDeskStream";

let host: HTMLElement | undefined;
afterEach(async () => {
  if (host) await act(() => render(null, host!));
  host?.remove();
  host = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

it("keeps trying the room's stream after a passing outage, instead of holding the error", async () => {
  vi.useFakeTimers();
  const outage = {
    error: {
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Online data is temporarily unavailable. Your existing view can remain open.",
      details: { capability: "data", reference: crypto.randomUUID(), outcome: "unknown" },
    },
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(reply(503, outage))
    .mockResolvedValue(reply(200, { timeZone: "Asia/Tokyo", locations: [], productionPartners: [] }));
  vi.stubGlobal("fetch", fetch);
  host = document.body.appendChild(document.createElement("div"));
  await act(() =>
    render(<LiveDeskStream slug="sample" roomId="main-hall" startAt="2026-11-25T01:00:00.000Z" />, host!),
  );
  await settle();
  // The monitor says so in its own picture, never the storage error meant for a form.
  expect(host.textContent).toBe("Livestream not reachable. Trying again…");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_DESK_STREAM_RETRY_MS);
  });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(host.textContent).toBe("No livestream for this room");
});
