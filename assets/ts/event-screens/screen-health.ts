import type { ScreenBrowserState, ScreenHealth } from "../../shared/schemas/event-screen-monitor";
import type { ScreenOwnView } from "../../shared/schemas/event-screens";
import type { LivestreamPlayerReport } from "./livestream-player-report";
import type { ScreenDisplay } from "./screen-display";

/** The page's own build: its bundle's file name, which changes with every release. */
export function screenPageVersion(moduleUrl: string = import.meta.url): string {
  const path = new URL(moduleUrl, "https://screen.invalid/").pathname;
  return (path.split("/").pop() || path).slice(0, 120) || "unknown";
}

/** How the screen runs: following the studio, holding what it last had, or on its own agenda. */
function runMode(display: ScreenDisplay): ScreenHealth["mode"] {
  if (display.kind === "pairing") return "live";
  const marker = display.marker;
  if (marker?.kind === "auto") return "auto";
  return marker ? "offline" : "live";
}

/** What the screen reports about itself, but the device's metrics, which the monitor connection adds. */
export function screenHealth(input: {
  display: ScreenDisplay;
  assignment: ScreenOwnView["screen"]["assignment"] | null;
  player: LivestreamPlayerReport | null;
  clockOffsetMs: number;
  pageVersion: string;
  /** A browser screen's grants; a device has none. */
  browser?: ScreenBrowserState | null;
  /** The error code the studio's room last turned the screen away with. */
  studioRefusal?: string | null;
}): Omit<ScreenHealth, "metrics"> {
  const { display } = input;
  const mode = runMode(display);
  return {
    pageVersion: input.pageVersion,
    kind: input.browser ? "browser" : "device",
    browser: input.browser ?? null,
    display: display.kind,
    output: display.kind === "pairing" || display.kind === "waiting" ? null : (input.assignment?.output ?? null),
    mode,
    // Only while the screen holds its last state does the reason say why.
    studioRefusal: mode === "offline" ? (input.studioRefusal ?? null) : null,
    player:
      display.kind === "livestream" && input.player
        ? {
            status: input.player.status,
            muted: input.player.muted,
            changedAt: input.player.changedAt,
            // The monitor connection reads the player's own readings when it sends.
            playback: null,
          }
        : null,
    clockOffsetMs: Math.max(-86_400_000, Math.min(86_400_000, Math.round(input.clockOffsetMs))),
  };
}
