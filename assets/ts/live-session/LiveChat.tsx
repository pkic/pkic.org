import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { LIVE_CHAT_POLICY, liveChatCanSend, liveChatCapacity, liveChatPlainText } from "../../shared/live-chat-policy";
import { liveChatSendSchema, type LiveRoomClientMessage } from "../../shared/schemas/live-session-room";
import type { LiveChatChannel } from "../../shared/schemas/live-session-chat";
import type { LiveRoomState } from "./live-room-state";
import { liveChatChannel } from "./live-chat-state";
import { LiveChatMessageRow } from "./LiveChatMessageRow";
import { LiveAuthorProvider } from "./LiveAuthor";
import { useContractForm } from "../hooks/useContractForm";
import { useWindowedList } from "../hooks/useWindowedList";
import { Field } from "../ui/Field";
import { FieldStatus } from "../ui/FieldStatus";
import { Textarea } from "../ui/TextControl";
import { Button } from "../ui/Button";
import "./LiveChat.css";

/** How close to the end of the feed still counts as reading the latest message. */
const FOLLOW_SLACK = 48;

export function ChatComposer({
  channel,
  compact,
  disabled,
  send,
  refusal,
}: {
  channel: LiveChatChannel;
  compact: boolean;
  disabled: boolean;
  send: (message: LiveRoomClientMessage) => boolean;
  refusal: string | null;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const statusId = useId();
  const form = useContractForm(liveChatSendSchema, { type: "chat.send", text, channel }, { quietWhenEmpty: true });
  const field = form.of("text");
  function submit() {
    // Send waits for content: an empty composer is at rest, not refused.
    if (!form.valid) return;
    const checked = form.submit();
    if (!checked.data) return;
    if (!send(checked.data)) return setError("Chat is reconnecting. Try again once it's connected.");
    setText("");
    setError(null);
    form.reset();
  }
  return (
    <form
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
          (compact
            ? ""
            : `${channel === "operator" ? "Only operators see this chat." : "Everyone in the session sees this chat."} Use **bold**, *italic* or \`code\`.`)}
      </FieldStatus>
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
                }
              }}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" disabled={disabled || !form.valid}>
          Send
        </Button>
      </div>
    </form>
  );
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
}: {
  state: LiveRoomState;
  disabled: boolean;
  send: (message: LiveRoomClientMessage) => boolean;
  compact?: boolean;
  channel?: LiveChatChannel;
  visible?: boolean;
}) {
  const restriction = state.viewer.chatRestriction ?? null;
  const messages = liveChatChannel(state, channel);
  const list = useWindowedList(messages, (message) => message.id, { estimate: 52, overscan: 400, initial: 40 });
  const following = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const [loading, setLoading] = useState(false);
  const firstId = messages[0]?.id;
  const latest = messages.at(-1);
  const anchor = useRef<{ firstId: string | undefined; height: number }>({ firstId, height: 0 });

  // Keep the reader's place when earlier messages arrive above, and stay on the latest while following it.
  useLayoutEffect(() => {
    const node = list.viewport.current;
    if (!node) return;
    if (anchor.current.firstId !== firstId && anchor.current.firstId !== undefined && !following.current)
      node.scrollTop += node.scrollHeight - anchor.current.height;
    else if (following.current && visible) node.scrollTop = node.scrollHeight;
    anchor.current = { firstId, height: node.scrollHeight };
  });
  useEffect(() => setLoading(false), [firstId]);
  useEffect(() => {
    if (!following.current && latest && !latest.mine) setUnseen((count) => count + 1);
  }, [latest?.id]);

  // A lifted ban brings the chat back from the room.
  const wasBanned = useRef(restriction === "banned");
  useEffect(() => {
    if (wasBanned.current && restriction !== "banned") send({ type: "chat.history", channel, before: null });
    wasBanned.current = restriction === "banned";
  }, [restriction]);

  if (restriction === "banned")
    return (
      <p class="pk-small pk-muted" role="status">
        An organizer removed you from this session's chat.
      </p>
    );

  const canLoadEarlier = state.chatEarlier?.[channel] === true && messages.length < LIVE_CHAT_POLICY.clientWindow;
  const canSend = liveChatCanSend(liveChatCapacity(state.viewer), restriction, channel);
  const refusal = state.refusal?.code.startsWith("LIVE_CHAT") ? state.refusal.message : null;
  const spoken = latest && !latest.mine ? `${latest.authorName}: ${liveChatPlainText(latest.text)}` : "";
  return (
    <LiveAuthorProvider authors={state.authors} send={send}>
      <div class={`pk-live-chat-workspace${compact ? " pk-live-chat-workspace--compact" : ""}`}>
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
            if (following.current) setUnseen(0);
            list.onScroll();
          }}
        >
          {canLoadEarlier ? (
            <div class="pk-live-chat__earlier">
              <Button
                disabled={disabled || loading}
                onClick={() => {
                  if (send({ type: "chat.history", channel, before: firstId ?? null })) setLoading(true);
                }}
              >
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
                  viewer={state.viewer}
                  send={send}
                  disabled={disabled}
                  measure={list.measure(message.id)}
                  timeZone={state.session.timeZone}
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
            <Button
              onClick={() => {
                const node = list.viewport.current;
                following.current = true;
                setUnseen(0);
                if (node) node.scrollTop = node.scrollHeight;
              }}
            >
              {unseen === 1 ? "1 new message" : `${unseen} new messages`}
            </Button>
          </div>
        ) : null}
        <p class="pk-sr-only" aria-live="polite">
          {visible ? spoken : ""}
        </p>
        {canSend ? (
          <ChatComposer channel={channel} compact={compact} disabled={disabled} send={send} refusal={refusal} />
        ) : (
          <p class="pk-small pk-muted" role="status">
            {restriction === "muted"
              ? "An organizer muted you. You can still read the chat."
              : "Only operators can write here."}
          </p>
        )}
      </div>
    </LiveAuthorProvider>
  );
}
