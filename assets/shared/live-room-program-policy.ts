import { LIVE_ROOM_POLICY, liveRoomPurgeAt } from "./live-session-policy";
/**
 * When a room's output links stop working: a day after its program's last
 * session ends, so asking again gives the same links until the program
 * changes. A room without a program gets a day from now.
 */
export function liveProgramOverlayExpiresAt(lastEndAt: string | null, now: number): string {
  const end = lastEndAt ? Date.parse(lastEndAt) : Number.NaN;
  const from = Number.isFinite(end) ? end : now;
  return new Date(from + LIVE_ROOM_POLICY.overlayAccessHours * 3_600_000).toISOString();
}

/** Publication lifecycle checks run only on the room's own alarm, never browser polling or cached authority. */
export const LIVE_PROGRAM_LIFECYCLE_INTERVAL_MS = 30000;
export function liveProgramPointerPurgeAt(lastEndAt: string | null, createdAt: string): number {
  return liveRoomPurgeAt(lastEndAt && Number.isFinite(Date.parse(lastEndAt)) ? lastEndAt : createdAt);
}
