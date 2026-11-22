/**
 * How long an event's live rooms keep their attendee chat after each session.
 * By default a room erases everything, chat included, a week after its
 * session ends. An organizer may keep the chat longer so they can download it
 * for the event's records; everything else in the room still goes after the
 * week. Only counts ever reach D1, never the messages.
 */
import { z } from "zod";
import { LIVE_ROOM_POLICY } from "./live-session-policy";

const DAY = 24 * 60 * 60 * 1000;

/** The choices an organizer has, in days after each session ends. */
export const LIVE_CHAT_KEEP_DAYS = [LIVE_ROOM_POLICY.storagePurgeAfterEndDays, 90] as const;

/** The event's live chat settings, kept under `liveChat` in its settings. */
export const eventLiveChatSettingsSchema = z
  .object({ keepDays: z.literal(LIVE_CHAT_KEEP_DAYS, { error: "Choose how long to keep the chat." }) })
  .strict();
export type EventLiveChatSettings = z.infer<typeof eventLiveChatSettingsSchema>;

export const DEFAULT_EVENT_LIVE_CHAT_SETTINGS: EventLiveChatSettings = {
  keepDays: LIVE_ROOM_POLICY.storagePurgeAfterEndDays,
};

/** The live chat settings stored in an event's settings, or the defaults when none are stored. */
export function eventLiveChatSettings(settings: Record<string, unknown>): EventLiveChatSettings {
  const parsed = eventLiveChatSettingsSchema.safeParse(settings.liveChat);
  return parsed.success ? parsed.data : DEFAULT_EVENT_LIVE_CHAT_SETTINGS;
}

/** When a session's room erases its attendee chat, as epoch milliseconds. */
export function liveChatKeptUntil(endAt: string, keepDays: number): number {
  return Date.parse(endAt) + keepDays * DAY;
}
