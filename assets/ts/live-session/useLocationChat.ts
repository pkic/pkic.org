import { applyLocationChatMessage, type LiveLocationChatState } from "./location-chat-state";
import { useLiveSocket, type LiveSocketFactory } from "./useLiveSocket";

export function liveLocationChatSocketUrl(location: Pick<Location, "protocol" | "host">, slug: string, roomId: string) {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/api/v1/events/${encodeURIComponent(slug)}/agenda/rooms/${encodeURIComponent(roomId)}/live/chat`;
}

/** A location's chat as `useLocationChat` hands it out, for components that share one connection. */
export type LiveLocationChatConnection = ReturnType<typeof useLocationChat>;

/**
 * The chat of a location for the event day, over its own socket: the virtual room and the studio hold it beside
 * the session's room, so a change of session never drops the conversation.
 */
export function useLocationChat({
  slug,
  roomId,
  enabled = true,
  createSocket,
}: {
  slug: string;
  roomId: string;
  enabled?: boolean;
  createSocket?: LiveSocketFactory;
}) {
  return useLiveSocket<LiveLocationChatState>({
    url: () => liveLocationChatSocketUrl(window.location, slug, roomId),
    urlKey: `${slug}/${roomId}`,
    enabled: enabled && Boolean(roomId),
    snapshot: "location.chat.snapshot",
    reduce: applyLocationChatMessage,
    createSocket,
  });
}
