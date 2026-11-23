import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  LIVE_CHAT_POLICY,
  liveChatCanSend,
  liveChatCapacity,
  liveChatReplyExcerpt,
} from "../../shared/live-chat-policy";
import {
  liveChatEditSchema,
  liveChatSendSchema,
  type LiveRoomClientMessage,
} from "../../shared/schemas/live-session-room";
import type { LiveChatChannel, LiveChatMessage } from "../../shared/schemas/live-session-chat";
import { liveChatChannel } from "./live-chat-state";
import type { LiveChatView } from "./location-chat-state";
import { LiveChatMessageRow, type LiveChatRowHandlers } from "./LiveChatMessageRow";
import { LiveChatQuote } from "./LiveChatQuote";
import { LiveChatPinned } from "./LiveChatPinned";
import { IconRemove } from "../ui/MediaIcons";
import { LiveAuthorProvider } from "./LiveAuthor";
import { useContractForm } from "../hooks/useContractForm";
import { useWindowedList } from "../hooks/useWindowedList";
import { Field } from "../ui/Field";
import { FieldStatus } from "../ui/FieldStatus";
import { Textarea } from "../ui/TextControl";
import { Button } from "../ui/Button";
import { LiveModerationDialogHost } from "./LiveModerationDialog";
import { LiveParticipationAlert, useLiveParticipation } from "./LiveParticipationAlert";
import { useLiveChatAnnouncement } from "./useLiveChatAnnouncement";
import "./LiveChat.css";

/** How close to the end of the feed still counts as reading the latest message. */
const FOLLOW_SLACK = 48;
/** How long a message a reader followed a quote to stays marked. */
const HIGHLIGHT_MS = 2000;

/** What the composer is writing besides a new message: a reply to one, or new words for the reader's own. */
export interface LiveChatComposing {
  kind: "reply" | "edit";
  message: LiveChatMessage;
}

/** A message or edit the room has not answered yet: its words stay until it arrives or the room refuses it. */
interface LiveChatUnanswered {
  text: string;
  /** The room's refusal count when it went out; a new refusal means it did not arrive. */
  refusal: number;
  /** The edited message and when it was edited before; null for a new message. */
  edit: { id: string; editedAt: string | undefined } | null;
  /** The reader's own messages held when it went out; a new one is this message arriving. */
  mine: ReadonlySet<string>;
  /** The connection dropped meanwhile; if the room's next snapshot does not hold it, it is sent again by hand. */
  dropped: boolean;
}

export function ChatComposer({
  channel,
  compact,
  disabled,
  send,
  refusal,
  refusals = 0,
  messages = [],
  note,
  composing = null,
  onComposed,
}: {
  channel: LiveChatChannel;
  compact: boolean;
  disabled: boolean;
  send: (message: LiveRoomClientMessage) => boolean;
  refusal: string | null;
  /** How many actions the room refused so far, so the composer knows a refusal of what it sent. */
  refusals?: number;
  /** The channel's messages, so the composer sees what it sent arrive. */
  messages?: readonly LiveChatMessage[];
  /** What the status line says while nothing else needs saying, such as when the chat closes. */
  note?: string;
  composing?: LiveChatComposing | null;
  /** The reply or edit was sent or set aside. */
  onComposed?: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const statusId = useId();
  const formNode = useRef<HTMLFormElement>(null);
  // A message half written waits while the reader edits another, and comes back after.
  const draft = useRef("");
  const wasEditing = useRef(false);
  const replying = composing?.kind === "reply" ? composing.message : null;
  const editing = composing?.kind === "edit" ? composing.message : null;
  const sendForm = useContractForm(
    liveChatSendSchema,
    { type: "chat.send", text, channel, ...(replying ? { replyTo: replying.id } : {}) },
    { quietWhenEmpty: true },
  );
  const editForm = useContractForm(
    liveChatEditSchema,
    { type: "chat.edit", messageId: editing?.id ?? "", text },
    { quietWhenEmpty: true },
  );
  const form = editing ? editForm : sendForm;
  const field = form.of("text");
  // Only a new reply or edit sets the words; typing does not.
  const typed = useRef(text);
  typed.current = text;
  useEffect(() => {
    const edited = composing?.kind === "edit" ? composing.message : null;
    if (edited) {
      if (!wasEditing.current) draft.current = typed.current;
      setText(edited.text);
    } else if (wasEditing.current) setText(draft.current);
    wasEditing.current = edited !== null;
    if (composing) formNode.current?.querySelector("textarea")?.focus();
  }, [composing]);
  const unanswered = useRef<LiveChatUnanswered | null>(null);
  /** What was sent arrived: its words leave the composer, unless the reader already typed on. */
  function sent(words: string, edited: boolean) {
    unanswered.current = null;
    if (typed.current === words) setText(edited ? draft.current : "");
    wasEditing.current = false;
    form.reset();
    onComposed?.();
  }
  const settled = useRef(sent);
  settled.current = sent;
  useEffect(() => {
    const waiting = unanswered.current;
    if (!waiting) return;
    if (disabled) {
      waiting.dropped = true;
      return;
    }
    const edit = waiting.edit;
    const arrived = edit
      ? messages.some((message) => message.id === edit.id && message.editedAt !== edit.editedAt)
      : messages.some((message) => message.mine && !waiting.mine.has(message.id));
    if (arrived) settled.current(waiting.text, edit !== null);
    // Refused, or lost with the connection: the words stay, ready to send again.
    else if (refusals !== waiting.refusal || waiting.dropped) unanswered.current = null;
  }, [messages, refusals, disabled]);
  function submit() {
    // Send waits for content, and for the room to answer the last message: an empty composer is at rest, not refused.
    if (!form.valid || unanswered.current) return;
    const checked = form.submit();
    if (!checked.data) return;
    // New words that match the old ones change nothing, and the room answers nothing.
    if (editing && checked.data.text === editing.text) return sent(text, true);
    if (!send(checked.data)) return setError("Chat is reconnecting. Try again once it's connected.");
    setError(null);
    unanswered.current = {
      text,
      refusal: refusals,
      edit: editing ? { id: editing.id, editedAt: editing.editedAt } : null,
      mine: new Set(messages.filter((message) => message.mine).map((message) => message.id)),
      dropped: false,
    };
  }
  return (
    <form
      ref={formNode}
      noValidate
      {...form.handlers}
      class="pk-live-chat__composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {/* The status keeps its line above the composer, so a refusal never moves the field or Send. */}
      <FieldStatus id={statusId} state={field.state} message={field.message}>
        {error ??
          refusal ??
          note ??
          (compact
            ? ""
            : channel === "operator"
              ? "Only operators see this chat."
              : "Everyone in the session sees this chat.")}
      </FieldStatus>
      {composing ? (
        <div class="pk-live-chat__composing">
          {replying ? (
            <LiveChatQuote
              quote={{
                messageId: replying.id,
                authorName: replying.authorName,
                excerpt: liveChatReplyExcerpt(replying.text),
                mine: replying.mine,
              }}
            />
          ) : (
            <p class="pk-live-chat__quote">Editing your message</p>
          )}
          <Button
            variant="ghost"
            icon
            aria-label={replying ? "Cancel reply" : "Cancel edit"}
            title={replying ? "Cancel reply" : "Cancel edit"}
            onClick={() => onComposed?.()}
          >
            <IconRemove />
          </Button>
        </div>
      ) : null}
      <div class="pk-live-chat__input">
        <Field label="Message" labelHidden statusId={statusId} {...field}>
          {(control) => (
            <Textarea
              {...control}
              name="text"
              rows={1}
              placeholder={channel === "operator" ? "Message the operators…" : "Message everyone…"}
              value={text}
              disabled={disabled}
              onInput={(event) => setText(event.currentTarget.value)}
              onKeyDown={(event) => {
                // Enter sends, as in any chat; Shift+Enter starts a new line.
                if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
                  event.preventDefault();
                  submit();
                } else if (event.key === "Escape" && composing) {
                  event.preventDefault();
                  onComposed?.();
                }
              }}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" disabled={disabled || !form.valid}>
          {editing ? "Save" : "Send"}
        </Button>
      </div>
    </form>
  );
}

/** The chat while its room is closed: the feed says why, and the composer waits. */
export function LiveChatClosed({ note = "Chat opens when the session is live." }: { note?: string }) {
  return (
    <div class="pk-live-chat-workspace pk-live-chat-workspace--compact">
      <div class="pk-live-chat">
        <p class="pk-small pk-muted pk-live-chat__empty">{note}</p>
      </div>
      <ChatComposer channel="attendee" compact disabled send={() => false} refusal={null} />
    </div>
  );
}

/** What a reader between sessions sees above the first message there. */
const BETWEEN_SESSIONS = "Between sessions";

/**
 * Where the session on changes in the feed, by the message it changes at: the title of the session that starts,
 * or the break. The feed's first message opens with its session, so a reader always knows which part they read.
 */
export function liveChatDividers(
  messages: readonly LiveChatMessage[],
  sessions: readonly { occurrenceId: string; title: string }[],
): Map<string, string> {
  const titles = new Map(sessions.map((session) => [session.occurrenceId, session.title]));
  const dividers = new Map<string, string>();
  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    if (previous ? previous.occurrenceId === message.occurrenceId : !message.occurrenceId) return;
    dividers.set(message.id, (message.occurrenceId && titles.get(message.occurrenceId)) || BETWEEN_SESSIONS);
  });
  return dividers;
}

/**
 * The live chat for attendees and the control room: dense rows rendered a
 * window at a time, a bounded history that pages back from the room on
 * request, and a composer. One parent owns the room connection.
 */
export function LiveChat({
  state,
  disabled,
  send,
  compact = false,
  channel = "attendee",
  visible = true,
  note,
}: {
  /** The composer's status line while nothing else needs saying. */
  note?: string;
  state: LiveChatView;
  disabled: boolean;
  send: (message: LiveRoomClientMessage) => boolean;
  compact?: boolean;
  channel?: LiveChatChannel;
  visible?: boolean;
}) {
  const restriction = useLiveParticipation(state.viewer.participation);
  // Rows read the block in force, so their actions come back when a pause ends, as the composer does.
  const viewer = useMemo(() => ({ ...state.viewer, participation: restriction }), [state.viewer, restriction]);
  const messages = liveChatChannel(state, channel);
  const dividers = useMemo(() => liveChatDividers(messages, state.scope.sessions), [messages, state.scope.sessions]);
  const list = useWindowedList(messages, (message) => message.id, { estimate: 52, overscan: 400, initial: 40 });
  const following = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const [loading, setLoading] = useState(false);
  const [composing, setComposing] = useState<LiveChatComposing | null>(null);
  /** The message a reader followed a quote to, while earlier pages load until it is held. */
  const [seeking, setSeeking] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  /** The latest reply to the reader that arrived while they read further up. */
  const [replyToMe, setReplyToMe] = useState<string | null>(null);
  const firstId = messages[0]?.id;
  const latest = messages.at(-1);
  const latestId = latest?.id;
  const latestMine = latest?.mine;
  const anchor = useRef<{ firstId: string | undefined; height: number }>({ firstId, height: 0 });
  const sent = useRef(latestId);

  // Keep the reader's place when earlier messages arrive above, and stay on the latest while following it.
  useLayoutEffect(() => {
    const node = list.viewport.current;
    if (!node) return;
    // What the reader sends shows where they look next, even when they replied from further up.
    if (latestMine && sent.current !== latestId) following.current = true;
    sent.current = latestId;
    if (anchor.current.firstId !== firstId && anchor.current.firstId !== undefined && !following.current)
      node.scrollTop += node.scrollHeight - anchor.current.height;
    else if (following.current && visible) node.scrollTop = node.scrollHeight;
    anchor.current = { firstId, height: node.scrollHeight };
  });
  const pages = state.chatPages?.[channel] ?? 0;
  const refusals = state.refusal?.sequence ?? 0;
  /** The first message held when the waiting history request went out; undefined while none waits. */
  const askedBefore = useRef<string | null | undefined>(undefined);
  const heldFirst = useRef(firstId);
  heldFirst.current = firstId;
  const loadEarlier = useCallback(() => {
    if (!send({ type: "chat.history", channel, before: firstId ?? null })) return;
    askedBefore.current = firstId ?? null;
    setLoading(true);
  }, [send, channel, firstId]);
  // Each answer ends the wait: a page, even one that added nothing, or a refusal. An answer that brought nothing
  // earlier also ends the search for a quoted message, rather than asking again.
  useEffect(() => {
    if (askedBefore.current === undefined) return;
    if (askedBefore.current === (heldFirst.current ?? null)) setSeeking(null);
    askedBefore.current = undefined;
    setLoading(false);
  }, [pages, refusals]);
  // Each new latest message counts once, however its quote changes after.
  const latestToMe = latest?.replyTo?.mine === true;
  const counted = useRef(latestId);
  useEffect(() => {
    if (counted.current === latestId) return;
    counted.current = latestId;
    if (following.current || !latestId || latestMine) return;
    setUnseen((count) => count + 1);
    if (latestToMe) setReplyToMe(latestId);
  }, [latestId, latestMine, latestToMe]);

  const canLoadEarlier = state.chatEarlier?.[channel] === true && messages.length < LIVE_CHAT_POLICY.clientWindow;
  /** Scrolls a held message into view and marks it; false when the feed does not hold it. */
  function reveal(messageId: string): boolean {
    const offset = list.offsetOf(messageId);
    const node = list.viewport.current;
    if (offset === null || !node) return false;
    following.current = false;
    node.scrollTop = Math.max(0, offset - node.clientHeight / 3);
    list.onScroll();
    setHighlighted(messageId);
    return true;
  }
  const revealing = useRef(reveal);
  revealing.current = reveal;
  const handlers = useMemo<LiveChatRowHandlers>(
    () => ({
      reply: (message) => setComposing({ kind: "reply", message }),
      edit: (message) => setComposing({ kind: "edit", message }),
      jump: (messageId) => {
        if (revealing.current(messageId)) return;
        following.current = false;
        setSeeking(messageId);
      },
    }),
    [],
  );
  // A quote leads to a message the feed no longer holds: earlier pages load until it is, or none are left;
  // each page that arrives moves the first message.
  useEffect(() => {
    if (!seeking) return;
    if (revealing.current(seeking) || !canLoadEarlier) return setSeeking(null);
    if (!loading) loadEarlier();
  }, [seeking, canLoadEarlier, loading, loadEarlier]);
  useEffect(() => {
    if (!highlighted) return;
    const timer = setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlighted]);
  const canSend = liveChatCanSend(liveChatCapacity(state.viewer), restriction !== null, channel);
  const refusal = state.refusal?.code.startsWith("LIVE_CHAT") ? state.refusal.message : null;
  const spoken = useLiveChatAnnouncement(latest, following, visible);
  return (
    <LiveAuthorProvider authors={state.authors} send={send}>
      <div class={`pk-live-chat-workspace${compact ? " pk-live-chat-workspace--compact" : ""}`}>
        {channel === "attendee" && state.chatPinned ? (
          <LiveChatPinned message={state.chatPinned} viewer={state.viewer} send={send} disabled={disabled} />
        ) : null}
        <div
          ref={(node) => {
            list.viewport.current = node;
          }}
          class="pk-live-chat"
          tabIndex={0}
          role="region"
          aria-label={`${channel === "operator" ? "Operator" : "Attendee"} chat messages`}
          onScroll={(event) => {
            const node = event.currentTarget;
            following.current = node.scrollHeight - node.scrollTop - node.clientHeight < FOLLOW_SLACK;
            if (following.current) {
              setUnseen(0);
              setReplyToMe(null);
            }
            list.onScroll();
          }}
        >
          {canLoadEarlier ? (
            <div class="pk-live-chat__earlier">
              <Button disabled={disabled || loading} onClick={loadEarlier}>
                {loading ? "Loading…" : "Load earlier messages"}
              </Button>
            </div>
          ) : null}
          {messages.length ? (
            <ol class="pk-live-chat__list">
              {list.before ? (
                <li
                  aria-hidden="true"
                  class="pk-live-chat__spacer"
                  ref={(node) => node?.style.setProperty("block-size", `${list.before}px`)}
                />
              ) : null}
              {list.rows.map((message) => (
                <LiveChatMessageRow
                  key={message.id}
                  message={message}
                  viewer={viewer}
                  send={send}
                  disabled={disabled}
                  measure={list.measure(message.id)}
                  timeZone={state.scope.timeZone}
                  divider={dividers.get(message.id) ?? null}
                  handlers={handlers}
                  highlighted={highlighted === message.id}
                  pinned={state.chatPinned?.id === message.id}
                  removed={state.chatRemoved?.includes(message.id) ?? false}
                />
              ))}
              {list.after ? (
                <li
                  aria-hidden="true"
                  class="pk-live-chat__spacer"
                  ref={(node) => node?.style.setProperty("block-size", `${list.after}px`)}
                />
              ) : null}
            </ol>
          ) : (
            <p class="pk-small pk-muted pk-live-chat__empty">No messages yet. Say hello to the room.</p>
          )}
        </div>
        {unseen > 0 ? (
          <div class="pk-live-chat__jump">
            {replyToMe ? (
              <Button
                onClick={() => {
                  handlers.jump(replyToMe);
                  setReplyToMe(null);
                }}
              >
                Reply to you
              </Button>
            ) : null}
            <Button
              onClick={() => {
                const node = list.viewport.current;
                following.current = true;
                setUnseen(0);
                setReplyToMe(null);
                if (node) node.scrollTop = node.scrollHeight;
              }}
            >
              {unseen === 1 ? "1 new message" : `${unseen} new messages`}
            </Button>
          </div>
        ) : null}
        <p class="pk-sr-only" aria-live="polite">
          {spoken}
        </p>
        {canSend ? (
          <ChatComposer
            channel={channel}
            compact={compact}
            disabled={disabled}
            send={send}
            refusal={refusal}
            refusals={refusals}
            messages={messages}
            note={note}
            composing={composing}
            onComposed={() => setComposing(null)}
          />
        ) : restriction && channel === "attendee" ? (
          <LiveParticipationAlert
            restriction={restriction}
            timeZone={state.scope.timeZone}
            eventName={state.scope.eventName}
          />
        ) : (
          <p class="pk-small pk-muted" role="status">
            Only operators can write here.
          </p>
        )}
        <LiveModerationDialogHost />
      </div>
    </LiveAuthorProvider>
  );
}
