import { LIVE_CHAT_POLICY, liveChatReplyExcerpt } from "../../shared/live-chat-policy";
import type { LiveChatChannel, LiveChatMessage } from "../../shared/schemas/live-session-chat";
import type { LiveLocationChatSnapshot, LiveRoomServerMessage } from "../../shared/schemas/live-session-room";

type ChatState = Pick<LiveLocationChatSnapshot, "chat" | "chatEarlier" | "chatPinned" | "chatReports" | "viewer">;
type ChatServerMessage = Extract<LiveRoomServerMessage, { type: `chat.${string}` }>;

/** A message awaits a moderator's review while it is reported and either shown or held. */
export function liveChatAwaitsReview(message: LiveChatMessage): boolean {
  const moderation = message.moderation;
  return moderation != null && moderation.reports > 0 && (moderation.hidden === null || moderation.held);
}

function byTime(left: LiveChatMessage, right: LiveChatMessage): number {
  return left.sentAt < right.sentAt ? -1 : left.sentAt > right.sentAt ? 1 : 0;
}

/** One channel's messages in the browser's bounded window, oldest first. */
export function liveChatChannel(state: Pick<ChatState, "chat">, channel: LiveChatChannel): LiveChatMessage[] {
  return state.chat.filter((message) => message.channel === channel);
}

function replaceChannel<State extends ChatState>(
  state: State,
  channel: LiveChatChannel,
  messages: LiveChatMessage[],
  earlier?: boolean,
): State {
  const dropped = messages.length > LIVE_CHAT_POLICY.clientWindow;
  return {
    ...state,
    chat: [
      ...state.chat.filter((message) => message.channel !== channel),
      ...(dropped ? messages.slice(-LIVE_CHAT_POLICY.clientWindow) : messages),
    ],
    chatEarlier: { ...state.chatEarlier, [channel]: earlier ?? (dropped || state.chatEarlier?.[channel] === true) },
  };
}

/** A new or changed message: in place when held, appended when new; older history arrives by page. */
function upsert<State extends ChatState>(state: State, message: LiveChatMessage): State {
  const channel = liveChatChannel(state, message.channel);
  const at = channel.findIndex((entry) => entry.id === message.id);
  const latest = channel.at(-1);
  let next = state;
  if (at >= 0)
    next = replaceChannel(
      state,
      message.channel,
      channel.map((entry, index) => (index === at ? message : entry)),
    );
  else if (!latest || byTime(latest, message) <= 0)
    next = replaceChannel(state, message.channel, [...channel, message]);
  const reports = (next.chatReports ?? []).filter((entry) => entry.id !== message.id);
  return {
    ...next,
    chatReports: liveChatAwaitsReview(message)
      ? [message, ...reports].slice(0, LIVE_CHAT_POLICY.reportQueueLimit)
      : reports,
  };
}

function update<State extends ChatState>(
  state: State,
  messageId: string,
  change: (message: LiveChatMessage) => LiveChatMessage,
): State {
  return {
    ...state,
    chat: state.chat.map((message) => (message.id === messageId ? change(message) : message)),
    chatReports: state.chatReports?.map((message) => (message.id === messageId ? change(message) : message)),
  };
}

/** Replies held here quote the message they answer as it reads now, or as removed once it is gone. */
function requote<State extends ChatState>(state: State, answered: string, now: LiveChatMessage | null): State {
  if (!state.chat.some((entry) => entry.replyTo?.messageId === answered)) return state;
  const shown = now !== null && !now.removal && !now.moderation?.hidden;
  return {
    ...state,
    chat: state.chat.map((entry) =>
      entry.replyTo?.messageId === answered
        ? {
            ...entry,
            replyTo: {
              messageId: answered,
              authorName: shown ? now.authorName : null,
              excerpt: shown ? liveChatReplyExcerpt(now.text) : null,
              mine: shown && now.mine,
            },
          }
        : entry,
    ),
  };
}

/** The pinned message follows its edits, and leaves the top of the chat once it is removed or hidden. */
function repin<State extends ChatState>(state: State, messageId: string, now: LiveChatMessage | null): State {
  if (state.chatPinned?.id !== messageId) return state;
  const shown = now !== null && !now.removal && !now.moderation?.hidden;
  return { ...state, chatPinned: shown ? now : null };
}

/** Applies one chat message from the room to the browser's chat. */
export function applyLiveChatMessage<State extends ChatState>(state: State, message: ChatServerMessage): State {
  switch (message.type) {
    case "chat.message":
      return repin(
        requote(upsert(state, message.message), message.message.id, message.message),
        message.message.id,
        message.message,
      );
    case "chat.removed":
      return repin(
        requote(
          {
            ...state,
            chat: state.chat.filter((entry) => entry.id !== message.messageId || entry.channel !== message.channel),
            chatReports: state.chatReports?.filter((entry) => entry.id !== message.messageId),
          },
          message.messageId,
          null,
        ),
        message.messageId,
        null,
      );
    case "chat.pinned":
      return { ...state, chatPinned: message.message };
    case "chat.reactions": {
      const react = (entry: LiveChatMessage) => ({
        ...entry,
        reactions: message.reactions,
        myReactions: message.myReactions ?? entry.myReactions,
      });
      const next = update(state, message.messageId, react);
      return next.chatPinned?.id === message.messageId ? { ...next, chatPinned: react(next.chatPinned) } : next;
    }
    case "chat.history": {
      const held = liveChatChannel(state, message.channel);
      const known = new Set(held.map((entry) => entry.id));
      const merged = [...message.messages.filter((entry) => !known.has(entry.id)), ...held].sort(byTime);
      return replaceChannel(state, message.channel, merged, message.hasEarlier);
    }
  }
}
