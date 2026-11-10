import { SCREEN_POLICY } from "./event-screen-policy";
import { formatDuration } from "./format-date";
import type { ScreenRecord } from "./schemas/event-screens";

/**
 * A screen counts as online while its last-seen time is within two of its
 * updates: the server writes that time only every `lastSeenMinutes`, so one
 * missed write is not yet a screen gone dark.
 */
export const SCREEN_ONLINE_WINDOW_MS = 2 * SCREEN_POLICY.lastSeenMinutes * 60_000;

export type ScreenConnection =
  | { kind: "online" }
  | { kind: "offline"; forMs: number }
  /** Staff approved its pairing code; the screen has not collected its sign-in yet. */
  | { kind: "waiting" }
  | { kind: "signed-out" };

export function screenConnection(session: ScreenRecord["session"], now: number): ScreenConnection {
  if (session.state === "pending") return { kind: "waiting" };
  if (session.state !== "active") return { kind: "signed-out" };
  const seen = session.lastSeenAt ?? session.activatedAt;
  const forMs = seen ? Math.max(0, now - Date.parse(seen)) : 0;
  return forMs <= SCREEN_ONLINE_WINDOW_MS ? { kind: "online" } : { kind: "offline", forMs };
}

/** How a screen's connection reads in the staff list; online is the expected state, so it carries no tone. */
export function screenConnectionDisplay(connection: ScreenConnection): {
  label: string;
  tone: "risk" | "info" | "warn" | null;
} {
  switch (connection.kind) {
    case "online":
      return { label: "Online", tone: null };
    case "offline":
      return { label: `Offline · ${formatDuration(connection.forMs)}`, tone: "risk" };
    case "waiting":
      return { label: "Waiting for the screen", tone: "info" };
    case "signed-out":
      return { label: "Not signed in", tone: "warn" };
  }
}
