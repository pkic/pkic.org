import { LIVE_ROOM_POLICY, liveRoomPurgeAt } from "./live-session-policy";
/** Issue near the event: a program's duration extends the existing day allowance, never its future start date. */
export function liveProgramOverlayAccessHours(firstStartAt: string | null, lastEndAt: string | null): number {
  if (!firstStartAt || !lastEndAt) return LIVE_ROOM_POLICY.overlayAccessHours;
  const first = Date.parse(firstStartAt),
    last = Date.parse(lastEndAt);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return LIVE_ROOM_POLICY.overlayAccessHours;
  return Math.max(LIVE_ROOM_POLICY.overlayAccessHours, (last - first) / 3600000 + LIVE_ROOM_POLICY.overlayAccessHours);
}

/** Publication lifecycle checks run only on the room's own alarm, never browser polling or cached authority. */
export const LIVE_PROGRAM_LIFECYCLE_INTERVAL_MS = 30000;
export function liveProgramPointerPurgeAt(lastEndAt: string | null, createdAt: string): number {
  return liveRoomPurgeAt(lastEndAt && Number.isFinite(Date.parse(lastEndAt)) ? lastEndAt : createdAt);
}
