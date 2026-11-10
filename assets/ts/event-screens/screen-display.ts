import type { ScreenOwnView } from "../../shared/schemas/event-screens";
import type { LiveOverlayView } from "../../shared/schemas/live-session-room";
import type { LiveRoomState } from "../live-session/live-room-state";
import { screenAutoState } from "./screen-auto-mode";
import type { ScreenCache, ScreenCachedAgenda } from "./screen-cache";

/** Past this age without word from the server, the dot becomes a badge with the minutes. */
export const SCREEN_OFFLINE_BADGE_AFTER_MS = 2 * 60_000;

/** The one status a screen shows over its picture, in its corner; none while connected. */
export type ScreenMarker =
  | { kind: "offline-dot" }
  | { kind: "offline-badge"; minutes: number }
  | { kind: "auto" }
  | null;

/** A connection's health as the screen judges it: up or not, and when the server last said anything. */
export interface ScreenLink {
  connected: boolean;
  /** On the screen's corrected clock; null before anything arrived. */
  lastUpdateAt: number | null;
}

export function screenOfflineMarker(link: ScreenLink, now: number): ScreenMarker {
  if (link.connected) return null;
  if (link.lastUpdateAt === null || now - link.lastUpdateAt < SCREEN_OFFLINE_BADGE_AFTER_MS)
    return { kind: "offline-dot" };
  return { kind: "offline-badge", minutes: Math.floor((now - link.lastUpdateAt) / 60_000) };
}

export interface ScreenSituation {
  now: number;
  /** The screen must pair: it has no sign-in, or the server refused it. */
  pairingRequired: boolean;
  pairing: { code: string; expiresAt: string } | null;
  /** The last good read, from the server or the device's copy. */
  view: ScreenOwnView | ScreenCache["view"] | null;
  agenda: ScreenCachedAgenda | null;
  /** The screen read's own health, for the screen's status pages. */
  read: ScreenLink;
  /** The room's live connections and the last state they delivered, held while they are down. */
  live: ScreenLink & { state: LiveRoomState | null };
}

export type ScreenDisplay =
  | { kind: "pairing"; pairing: { code: string; expiresAt: string } | null }
  | { kind: "waiting"; name: string; marker: ScreenMarker }
  | { kind: "livestream"; name: string; roomName: string; marker: ScreenMarker }
  | { kind: "idle"; name: string; roomName: string; marker: ScreenMarker }
  | {
      kind: "output";
      output: LiveOverlayView;
      layout: string | null;
      roomId: string;
      state: LiveRoomState;
      marker: ScreenMarker;
    };

/**
 * What the screen shows now. While connected the studio is always in charge.
 * While offline the last state stays, its timers counting. A stage display
 * whose studio session has passed its scheduled end follows its copy of the
 * room's agenda (auto mode) until the studio is back; every other output
 * holds its last frame.
 */
export function screenDisplay(situation: ScreenSituation): ScreenDisplay {
  const { view, now, live } = situation;
  if (situation.pairingRequired || !view) return { kind: "pairing", pairing: situation.pairing };
  const { name, assignment } = view.screen;
  if (!assignment) return { kind: "waiting", name, marker: screenOfflineMarker(situation.read, now) };
  if (assignment.output === "livestream")
    return {
      kind: "livestream",
      name,
      roomName: assignment.roomName,
      marker: screenOfflineMarker(situation.read, now),
    };
  const shown = {
    kind: "output" as const,
    output: assignment.output,
    layout: assignment.layout,
    roomId: assignment.roomId,
  };
  const ended = live.state !== null && Date.parse(live.state.session.endAt) <= now;
  if (assignment.output === "stage-display" && !live.connected && ended && situation.agenda) {
    const auto = screenAutoState(situation.agenda, { id: assignment.roomId, name: assignment.roomName }, now);
    if (auto) return { ...shown, state: auto, marker: { kind: "auto" } };
  }
  if (live.state) return { ...shown, state: live.state, marker: screenOfflineMarker(live, now) };
  return { kind: "idle", name, roomName: assignment.roomName, marker: screenOfflineMarker(live, now) };
}
