import type { LiveAuthorDetails } from "../../shared/schemas/live-session-author";
import type { LiveLocationChatSnapshot, LiveRoomServerMessage } from "../../shared/schemas/live-session-room";
import { applyLiveChatMessage } from "./live-chat-state";

/** What a browser knows about a location's chat: the last snapshot with every pushed change applied. */
export interface LiveLocationChatState extends Omit<LiveLocationChatSnapshot, "type"> {
  /** The latest refused action, numbered so a view can announce it once. */
  refusal: { sequence: number; code: string; message: string } | null;
  /** Author cards the chat answered, by handle; null when a handle resolved to no one. */
  authors?: Readonly<Record<string, LiveAuthorDetails | null>>;
}

/** What the chat views read: the messages, the viewer, and the day's sessions the dividers name. */
export type LiveChatView = Pick<
  LiveLocationChatState,
  "viewer" | "chat" | "chatEarlier" | "chatPinned" | "chatReports" | "refusal" | "authors" | "scope"
>;

/** Applies one message of the location's chat. Changes before the first snapshot are ignored; it carries them. */
export function applyLocationChatMessage(
  state: LiveLocationChatState | null,
  message: LiveRoomServerMessage,
): LiveLocationChatState | null {
  if (message.type === "location.chat.snapshot") {
    const { type: _type, ...snapshot } = message;
    return { ...snapshot, refusal: null };
  }
  if (!state) return null;
  switch (message.type) {
    case "chat.message":
    case "chat.removed":
    case "chat.reactions":
    case "chat.pinned":
    case "chat.history":
      return applyLiveChatMessage(state, message);
    case "participation.access":
      return { ...state, viewer: { ...state.viewer, participation: message.restriction } };
    case "author.details":
      return { ...state, authors: { ...state.authors, [message.handle]: message.author } };
    case "room.opening.changed":
      return { ...state, opening: message.opening };
    case "room.refused":
      return {
        ...state,
        refusal: { sequence: (state.refusal?.sequence ?? 0) + 1, code: message.code, message: message.message },
      };
    default:
      return state;
  }
}
