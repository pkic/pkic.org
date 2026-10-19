import type { LiveTickerConfig, LiveStage } from "../../../../assets/shared/schemas/live-session-room";
import type { LiveTickerContext } from "../../../../assets/shared/schemas/live-session-ticker";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import type { DatabaseLike } from "../../types";
import { resolveTickerMessages } from "../../../../assets/shared/live-ticker-content";
import { LIVE_CHAT_POLICY, liveChatPlainText } from "../../../../assets/shared/live-chat-policy";
import { readLiveTickerContext } from "./room-ticker-context";
import { readPublishedLiveAgenda } from "./approved-agenda";
import type { LiveRoomChat } from "./room-chat";
export const LIVE_TICKER_REFRESH_MS = 30000;

/**
 * The chat ticker's lines: the latest attendee messages, oldest first, as
 * plain words. Hidden and reported messages, and anything by a muted or
 * banned person, never reach the broadcast.
 */
export function liveChatTickerLines(chat: LiveRoomChat): string[] {
  return chat
    .tickerRows(LIVE_CHAT_POLICY.tickerMessages)
    .reverse()
    .flatMap((row) => {
      const text = liveChatPlainText(row.body);
      if (!text) return [];
      const words =
        text.length > LIVE_CHAT_POLICY.tickerMessageLength
          ? `${text.slice(0, LIVE_CHAT_POLICY.tickerMessageLength - 1).trimEnd()}…`
          : text;
      return [`${row.author_name}: ${words}`];
    });
}

export async function resolveLiveTicker(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  config: LiveTickerConfig | null,
  now = Date.now(),
  context?: LiveTickerContext,
  approved?: AgendaSnapshot | null,
  chat: readonly string[] = [],
): Promise<LiveStage["ticker"]> {
  if (!config) return null;
  const [agenda, publicContext] = await Promise.all([
    approved === undefined ? readPublishedLiveAgenda(db, eventId) : approved,
    context ?? readLiveTickerContext(db, eventId),
  ]);
  return { ...config, segments: resolveTickerMessages(config, agenda, occurrenceId, now, publicContext, chat) };
}
