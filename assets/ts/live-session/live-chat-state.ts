import { LIVE_CHAT_POLICY, liveChatReplyExcerpt } from "../../shared/live-chat-policy";
import type { LiveChatChannel, LiveChatMessage } from "../../shared/schemas/live-session-chat";
import type { LiveLocationChatSnapshot, LiveRoomServerMessage } from "../../shared/schemas/live-session-room";

/** What the browser itself keeps about its chat besides what the room sent. */
export interface LiveChatAnswers {
  /** History pages the room answered per channel, so a view sees each answer, even a page that added nothing. */
  chatPages?: Partial<Record<LiveChatChannel, number>>;
  /** Messages moderation took while this browser had them: they stay as a nameless trace until the room says more. */
  chatRemoved?: string[];
}

type ChatState = Pick<LiveLocationChatSnapshot, "chat" | "chatEarlier" | "chatPinned" | "chatReports" | "viewer"> &
  LiveChatAnswers;
type ChatServerMessage = Extract<LiveRoomServerMessage, { type: `chat.${string}` }>;

/** A message awaits a moderator's review while it is reported or flagged, and either shown or held. */
export function liveChatAwaitsReview(message: LiveChatMessage): boolean {
  const moderation = message.moderation;
  return (
    moderation != null &&
    (moderation.reports > 0 || moderation.automaticCheck !== undefined) &&
    (moderation.hidden === null || moderation.held)
  );
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

/**
 * The chat without a message that is gone. One moderation took stays in place as a trace with nothing of its
 * author or words, so the readers who saw it know it was taken; one deleted by its author simply goes.
 */
function withoutMessage(
  state: ChatState,
  messageId: string,
  channel: LiveChatChannel,
  moderated: boolean,
): Pick<ChatState, "chat" | "chatRemoved"> {
  const gone = (entry: LiveChatMessage) => entry.id === messageId && entry.channel === channel;
  if (!moderated || !state.chat.some(gone))
    return { chat: state.chat.filter((entry) => !gone(entry)), chatRemoved: state.chatRemoved };
  return {
    chat: state.chat.map((entry) => (gone(entry) ? liveChatTrace(entry) : entry)),
    chatRemoved: [...new Set([...(state.chatRemoved ?? []), messageId])],
  };
}

/** What a reader keeps of a message moderation took: its place in the chat, and nothing it said or who said it. */
function liveChatTrace(entry: LiveChatMessage): LiveChatMessage {
  return {
    id: entry.id,
    channel: entry.channel,
    authorName: "",
    text: "",
    mine: false,
    sentAt: entry.sentAt,
    ...(entry.occurrenceId ? { occurrenceId: entry.occurrenceId } : {}),
  };
}

/** Applies one chat message from the room to the browser's chat. */
export function applyLiveChatMessage<State extends ChatState>(state: State, message: ChatServerMessage): State {
  switch (message.type) {
    case "chat.message":
      return repin(
        requote(
          upsert(
            state.chatRemoved?.includes(message.message.id)
              ? { ...state, chatRemoved: state.chatRemoved.filter((id) => id !== message.message.id) }
              : state,
            message.message,
          ),
          message.message.id,
          message.message,
        ),
        message.message.id,
        message.message,
      );
    case "chat.removed":
      return repin(
        requote(
          {
            ...state,
            ...withoutMessage(state, message.messageId, message.channel, message.moderated === true),
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
      const pages = { ...state.chatPages, [message.channel]: (state.chatPages?.[message.channel] ?? 0) + 1 };
      return { ...replaceChannel(state, message.channel, merged, message.hasEarlier), chatPages: pages };
    }
  }
}
