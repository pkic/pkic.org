// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVE_ROOM_FAULT_CLOSE_CODE } from "../../assets/shared/schemas/live-session-room";
import { liveRoomOpenFailure } from "../../assets/ts/live-session/live-room-copy";
import { labeled, mountClosedDesk, mountDesk, resetDeskStorage, unmountDesks } from "./helpers/live-desk";

beforeEach(resetDeskStorage);
afterEach(unmountDesks);

describe("live control room states", () => {
  it("pauses its controls while the room reconnects", () => {
    const { host, live } = mountDesk();
    void act(() => live.latest().close());
    expect(host.textContent).toContain("Reconnecting to the live room");
    expect(labeled(host, "Prepare Sam Speaker in Preview").disabled).toBe(true);
  });

  it("says what failed when the room refuses the session, and does not retry", () => {
    const { host, live } = mountClosedDesk();
    vi.useFakeTimers();
    try {
      void act(() => live.latest().refuse(4404, "LIVE_SESSION_NOT_FOUND"));
      vi.advanceTimersByTime(60_000);
    } finally {
      vi.useRealTimers();
    }
    expect(host.textContent).toContain("This session has no live room yet.");
    expect(live.sockets).toHaveLength(1);
  });

  it("names missing access only when the room says so", () => {
    expect(liveRoomOpenFailure("LIVE_SESSION_ACCESS_REQUIRED", "operator")).toContain("live moderation access");
    expect(liveRoomOpenFailure(null, "operator")).toContain("can't be reached");
  });

  it("says a fault on our side is ours, with its reference, and keeps trying", () => {
    const { host, live } = mountClosedDesk();
    vi.useFakeTimers();
    try {
      void act(() => live.latest().refuse(LIVE_ROOM_FAULT_CLOSE_CODE, "8f1b2c3d4e5f6a7b-AMS"));
      const alert = host.querySelector(".pk-alert")!;
      expect(alert.textContent).toBe(
        "Something went wrong on our side, so the live room isn't available. Let us know and quote reference 8f1b2c3d4e5f6a7b-AMS.",
      );
      expect(alert.textContent).not.toContain("connection");
      void act(() => {
        vi.advanceTimersByTime(60_000);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(live.sockets.length).toBeGreaterThan(1);
  });
});
