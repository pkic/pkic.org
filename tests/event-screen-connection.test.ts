import { describe, expect, it } from "vitest";
import { SCREEN_ONLINE_WINDOW_MS, screenConnection } from "../assets/shared/event-screen-connection";

const NOW = Date.parse("2026-12-01T09:30:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const session = (state: "none" | "pending" | "active", lastSeenAt: string | null = null) => ({
  state,
  activatedAt: state === "active" ? ago(3_600_000) : null,
  lastSeenAt,
  expiresAt: null,
});

describe("screenConnection", () => {
  it("keeps a screen online through one missed last-seen write", () => {
    expect(screenConnection(session("active", ago(SCREEN_ONLINE_WINDOW_MS)), NOW)).toEqual({ kind: "online" });
  });

  it("reports how long a screen past the window has been offline", () => {
    const forMs = SCREEN_ONLINE_WINDOW_MS + 60_000;
    expect(screenConnection(session("active", ago(forMs)), NOW)).toEqual({ kind: "offline", forMs });
  });

  it("tells an approved screen that has not signed in from one with no sign-in", () => {
    expect(screenConnection(session("pending"), NOW).kind).toBe("waiting");
    expect(screenConnection(session("none"), NOW).kind).toBe("signed-out");
  });
});
