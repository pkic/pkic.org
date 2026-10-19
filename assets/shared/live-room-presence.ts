import { LIVE_AUX_OUTPUTS } from "./live-room-outputs";

/**
 * Operator presence in a live control room: who else is at the desk, which
 * control each of them is on, and where they point on a shared monitor.
 * Presence is ephemeral. The room keeps it in memory only, never stores it,
 * and never sends it to attendees, speakers or overlays.
 *
 * Panel layouts are each operator's own, so presence is anchored to controls
 * (panel kind, item and output target), never to screen pixels. Only the
 * monitors share a canvas, the same 16:9 composition everywhere, so a pointer
 * there travels as normalized 0–1 coordinates.
 */
export const LIVE_PRESENCE_POLICY = {
  /** A client sends at most ten updates a second; the room fans out each operator at the same pace. */
  minIntervalMs: 100,
  /** How long presence updates ride on a socket's last full access check before the room checks again. */
  revalidateMs: 15_000,
  /** How long other operators see who just changed a control. */
  changeFlashMs: 1_500,
} as const;

/** The output buttons a focused control can point at; the aux menu is one target for all aux outputs. */
export const LIVE_PRESENCE_TARGETS = ["preview", "program", "aux"] as const;
export type LivePresenceTarget = (typeof LIVE_PRESENCE_TARGETS)[number];

/** The monitors a pointer can rest on: every composition the room draws, not the livestream video. */
export const LIVE_PRESENCE_OUTPUTS = ["preview", "program", ...LIVE_AUX_OUTPUTS] as const;
export type LivePresenceOutput = (typeof LIVE_PRESENCE_OUTPUTS)[number];

/** How many distinct operator colors the design tokens provide. */
export const LIVE_PRESENCE_COLOR_COUNT = 6;

/** 32-bit FNV-1a, as eight hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (const unit of new TextEncoder().encode(text)) {
    hash ^= unit;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * A person's presence identifier: stable for one person across their control
 * rooms and reconnects, without putting their account id on other screens.
 */
export function livePresenceKey(userId: string): string {
  return fnv1a(`live-presence:${userId}`);
}

/**
 * The operator's color slot, from their name, so the header avatars (which
 * know names only) and every presence mark agree on one color per person.
 * Color is never the only cue: initials and the name travel with it.
 */
export function livePresenceColor(name: string): number {
  return Number.parseInt(fnv1a(name), 16) % LIVE_PRESENCE_COLOR_COUNT;
}
