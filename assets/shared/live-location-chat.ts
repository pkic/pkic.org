import { LIVE_ROOM_POLICY } from "./live-session-policy";
import type { LiveRoomOpening } from "./schemas/live-room-opening";
import { instantToCalendarDate } from "./timezone";

/**
 * Product policy for a location's chat: one chat per location and event day, so a change of session never
 * cuts a conversation off and people keep talking through the breaks. It opens shortly before the location's
 * first session of the day and closes a while after its last, whatever the studio does: an operator who
 * reloads, leaves or never opens the studio does not stop it. Only an operator ending it, or opening it past
 * its close, overrides the schedule. Each message carries the session on in the location when it was sent.
 */

const MINUTE = 60_000;

/** One session the location holds that day, as the chat dates its messages by. */
export interface LiveLocationChatSession {
  occurrenceId: string;
  startAt: string;
  endAt: string;
}

/** The sessions of one event day in the location, in agenda order. */
export interface LiveLocationChatDay {
  day: string;
  sessions: LiveLocationChatSession[];
}

/** The day's chat window, as epoch milliseconds: around its first and last session, as a session's room is. */
export function liveLocationChatWindow(sessions: readonly LiveLocationChatSession[]) {
  if (!sessions.length) return null;
  return {
    opensAt:
      Math.min(...sessions.map((session) => Date.parse(session.startAt))) -
      LIVE_ROOM_POLICY.opensBeforeStartMinutes * MINUTE,
    closesAt:
      Math.max(...sessions.map((session) => Date.parse(session.endAt))) +
      LIVE_ROOM_POLICY.closesAfterEndMinutes * MINUTE,
  };
}

/** Whether attendees may chat and react at `now`. Operators always may. */
export function liveLocationChatOpen(
  now: number,
  sessions: readonly LiveLocationChatSession[],
  opening: LiveRoomOpening = "scheduled",
): boolean {
  if (opening !== "scheduled") return opening === "open";
  const window = liveLocationChatWindow(sessions);
  return window !== null && now >= window.opensAt && now <= window.closesAt;
}

/** The location's sessions grouped by event day in the event's zone, days in order. */
export function liveLocationChatDays(
  sessions: readonly LiveLocationChatSession[],
  timeZone: string,
): LiveLocationChatDay[] {
  const days = new Map<string, LiveLocationChatSession[]>();
  for (const session of [...sessions].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
    const day = instantToCalendarDate(session.startAt, timeZone);
    days.set(day, [...(days.get(day) ?? []), session]);
  }
  return [...days].map(([day, daySessions]) => ({ day, sessions: daySessions }));
}

/** The day whose chat a viewer joins at `now`: the one open now, else the next, else the last. */
export function liveLocationChatDayAt(days: readonly LiveLocationChatDay[], now: number): LiveLocationChatDay | null {
  const windows = days.map((day) => ({ day, window: liveLocationChatWindow(day.sessions)! }));
  return (
    windows.find(({ window }) => now >= window.opensAt && now <= window.closesAt)?.day ??
    windows.find(({ window }) => window.opensAt > now)?.day ??
    windows.at(-1)?.day ??
    null
  );
}

/**
 * The session a message sent at `now` belongs to: the one the studio has loaded, when it is one of the day's;
 * else the one the agenda has on; else none, in a break or before the first or after the last.
 */
export function liveLocationChatStamp(
  now: number,
  sessions: readonly LiveLocationChatSession[],
  loadedOccurrenceId: string | null,
): string | null {
  if (loadedOccurrenceId && sessions.some((session) => session.occurrenceId === loadedOccurrenceId))
    return loadedOccurrenceId;
  return (
    sessions.find((session) => now >= Date.parse(session.startAt) && now < Date.parse(session.endAt))?.occurrenceId ??
    null
  );
}
