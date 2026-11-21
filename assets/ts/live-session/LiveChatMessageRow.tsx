import { memo } from "preact/compat";
import { useState } from "preact/hooks";
import { Alert } from "../ui/Alert";
import { formatClockInZone, formatTimeOfDay } from "../../shared/format-date";
import { formatNumber } from "../../shared/format-number";
import {
  LIVE_CHAT_REACTIONS,
  liveChatActions,
  liveChatCapacity,
  type LiveChatAction,
  type LiveChatReactionId,
} from "../../shared/live-chat-policy";
import type { LiveChatMessage } from "../../shared/schemas/live-session-chat";
import type { LiveRoomClientMessage, LiveRoomSnapshot } from "../../shared/schemas/live-session-room";
import { confirmAction } from "../components/ConfirmDialog";
import { Avatar } from "../ui/Avatar";
import { LiveAuthorName } from "./LiveAuthor";
import { Markdown } from "../ui/Markdown";
import { StrokeIcon } from "../ui/MediaIcons";
import { LiveChatQuote } from "./LiveChatQuote";
import { Menu, type MenuItem } from "../ui/Menu";
import { ReactionPicker } from "./ReactionPicker";
import { LIVE_MODERATION_REASONS } from "../../shared/live-moderation-policy";
import { liveParticipationBlockLabel } from "../../shared/schemas/live-session-moderation";
import { liveDoneMenuItem, liveParticipationMenuItems, liveRemoveMenuItem } from "./live-moderation-menu";
import { LiveRemovedPost, liveRemovalNote } from "./LiveRemovedPost";

type Viewer = LiveRoomSnapshot["viewer"];
type Send = (message: LiveRoomClientMessage) => boolean;

/** What the feed does when a reader replies to, edits, or follows a quote to a message. */
export interface LiveChatRowHandlers {
  reply: (message: LiveChatMessage) => void;
  edit: (message: LiveChatMessage) => void;
  jump: (messageId: string) => void;
}

const EMOJI = Object.fromEntries(LIVE_CHAT_REACTIONS.map((reaction) => [reaction.id, reaction])) as Record<
  LiveChatReactionId,
  (typeof LIVE_CHAT_REACTIONS)[number]
>;

/** What the shared chat policy lets this viewer do with this message. */
export function liveChatMessageActions(message: LiveChatMessage, viewer: Viewer): Set<LiveChatAction> {
  const moderation = message.moderation;
  return liveChatActions(liveChatCapacity(viewer), viewer.participation != null, {
    channel: message.channel,
    mine: message.mine,
    hidden: moderation?.hidden != null,
    held: moderation?.held ?? false,
    reported: (moderation?.reports ?? 0) > 0,
    reportedByMe: message.reportedByMe ?? false,
    converted: moderation?.questionId != null,
    done: moderation?.done != null,
    authorStaff: moderation?.authorStaff ?? false,
    authorRestriction: moderation?.authorRestriction?.block ?? null,
    sentAt: message.sentAt,
    editLocked: message.editLocked ?? false,
  });
}

function keepLabel(message: LiveChatMessage): string {
  if (message.moderation?.held) return "Keep message";
  return message.moderation?.hidden ? "Show message" : "Dismiss reports";
}

/** The message's menu: the other actions the policy grants, each sent as the room's own command. */
function menuItems(
  message: LiveChatMessage,
  actions: Set<LiveChatAction>,
  send: Send,
  timeZone: string,
  onError: () => void,
  onRetry: () => void,
  handlers: LiveChatRowHandlers | null,
): MenuItem[] {
  const messageId = message.id;
  const item = { kind: "chat" as const, messageId };
  const items: MenuItem[] = [];
  if (handlers && actions.has("reply"))
    items.push({ id: "reply", label: "Reply", onSelect: () => handlers.reply(message) });
  if (handlers && actions.has("edit"))
    items.push({ id: "edit", label: "Edit", onSelect: () => handlers.edit(message) });
  if (actions.has("report"))
    items.push({
      id: "report",
      label: "Report",
      separatorBefore: items.length > 0,
      children: LIVE_MODERATION_REASONS.map((reason) => ({
        id: `report-${reason.id}`,
        label: reason.label,
        onSelect: () => send({ type: "chat.report", messageId, reason: reason.id }),
      })),
    });
  if (actions.has("done")) items.push(liveDoneMenuItem(item, false, send));
  if (actions.has("convert"))
    items.push({
      id: "convert",
      label: "Turn into question",
      separatorBefore: items.length > 0 && !actions.has("done"),
      onSelect: () => send({ type: "chat.convert", messageId }),
    });
  if (actions.has("keep"))
    items.push({
      id: "keep",
      label: keepLabel(message),
      onSelect: () => send({ type: "chat.moderate", messageId, decision: "keep" }),
    });
  if (actions.has("remove"))
    items.push(
      liveRemoveMenuItem(
        "message",
        (reason) => {
          if (!send({ type: "chat.moderate", messageId, decision: "remove", reason })) onError();
        },
        onError,
      ),
    );
  items.push(
    ...liveParticipationMenuItems({
      item,
      authorName: message.authorName,
      actions,
      send,
      timeZone,
      onError,
    }),
  );
  if (actions.has("delete"))
    items.push({
      id: "delete",
      label: "Delete message",
      danger: true,
      separatorBefore: items.length > 0,
      onSelect: () => {
        onRetry();
        void confirmAction({
          title: "Delete your message?",
          body: "It's removed for everyone in the session.",
          confirmLabel: "Delete message",
          tone: "danger",
        })
          .then((confirmed) => {
            if (confirmed) send({ type: "chat.delete", messageId });
          })
          .catch(onError);
      },
    });
  return items;
}

/** A smile with a plus: add a reaction. */
function ReactIcon() {
  return (
    <StrokeIcon>
      <path d="M13 7.5A5.5 5.5 0 1 1 8.5 2.1M5.5 9.5s1 1.5 2.5 1.5 2.5-1.5 2.5-1.5M5.75 6.25h.01M9.75 6.25h.01M12.5 1v4M10.5 3h4" />
    </StrokeIcon>
  );
}

/** What replaces a removed or hidden message's words for the people who still see it. */
function removedNote(message: LiveChatMessage): string | null {
  if (message.removal) return liveRemovalNote(message.removal);
  if (message.moderation?.hidden) return `Hidden by ${message.moderation.hidden.operatorName}.`;
  return null;
}

/** Moderators only: what the room knows about the message, in words. */
function ModerationNote({ message }: { message: LiveChatMessage }) {
  const moderation = message.moderation;
  if (!moderation) return null;
  const notes: Array<{ text: string; tone: "warn" | "muted" }> = [];
  if (moderation.held) notes.push({ text: "Held after reports", tone: "warn" });
  if (moderation.reports > 0)
    notes.push({
      text: `${formatNumber(moderation.reports)} ${moderation.reports === 1 ? "report" : "reports"}`,
      tone: "warn",
    });
  if (moderation.questionId) notes.push({ text: "Asked as a question", tone: "muted" });
  if (moderation.done) notes.push({ text: "Done", tone: "muted" });
  if (moderation.authorRestriction)
    notes.push({
      text: `Author ${liveParticipationBlockLabel(moderation.authorRestriction.block).toLowerCase()}`,
      tone: "muted",
    });
  return notes.length ? (
    <span class="pk-live-chat__notes">
      {notes.map((note) => (
        <span key={note.text} class="pk-live-chat__note" data-tone={note.tone}>
          {note.text}
        </span>
      ))}
    </span>
  ) : null;
}

/**
 * One chat message as a dense row: a small portrait, the name and time, the
 * words in the chat subset of Markdown, its reactions, and a menu holding
 * what this viewer may do with it.
 */
export const LiveChatMessageRow = memo(function LiveChatMessageRow({
  message,
  viewer,
  send,
  disabled,
  measure,
  timeZone,
  divider = null,
  handlers = null,
  highlighted = false,
}: {
  message: LiveChatMessage;
  viewer: Viewer;
  send: Send;
  disabled: boolean;
  measure?: (node: HTMLElement | null) => void;
  /** The session's zone: a message reads on the room's own clock, like its agenda. */
  timeZone: string;
  /** Where the session on changes at this message, what to call the part that starts: a title, or the break. */
  divider?: string | null;
  /** Reply, edit and quotes that lead to their message; a list without them shows replies as they are. */
  handlers?: LiveChatRowHandlers | null;
  /** The message a reader just followed a quote to. */
  highlighted?: boolean;
}) {
  const [actionError, setActionError] = useState(false);
  const actions = liveChatMessageActions(message, viewer);
  const items = disabled
    ? []
    : menuItems(
        message,
        actions,
        send,
        timeZone,
        () => setActionError(true),
        () => setActionError(false),
        handlers,
      );
  const canReact = !disabled && actions.has("react");
  const reactions = LIVE_CHAT_REACTIONS.filter((reaction) => (message.reactions?.[reaction.id] ?? 0) > 0);
  const time = formatClockInZone(message.sentAt, timeZone);
  return (
    <li
      ref={measure}
      class="pk-live-chat__row"
      data-mine={message.mine ? "" : undefined}
      data-removed={removedNote(message) ? "" : undefined}
      data-highlighted={highlighted ? "" : undefined}
    >
      {divider !== null ? (
        <p class="pk-live-chat__divider" role="separator">
          {divider}
        </p>
      ) : null}
      <Avatar name={message.authorName} src={message.authorPhotoUrl ?? undefined} size="sm" />
      <div class="pk-live-chat__body">
        {actionError && <Alert tone="danger">Could not complete the action. Please try again.</Alert>}
        <div class="pk-live-chat__byline">
          <LiveAuthorName
            class="pk-live-chat__author"
            name={message.authorName}
            handle={message.authorHandle}
            affiliation={message.authorAffiliation}
            roles={message.authorRoles}
          />
          <time dateTime={message.sentAt} title={formatTimeOfDay(message.sentAt)}>
            {time}
          </time>
          {message.editedAt ? (
            <span class="pk-live-chat__edited" title={`Edited at ${formatTimeOfDay(message.editedAt)}`}>
              Edited
            </span>
          ) : null}
          <ModerationNote message={message} />
        </div>
        {message.replyTo ? <LiveChatQuote quote={message.replyTo} onJump={handlers?.jump} /> : null}
        {removedNote(message) ? (
          <LiveRemovedPost note={removedNote(message)!}>
            <Markdown markdown={message.text} profile="chat" className="pk-live-chat__text" />
          </LiveRemovedPost>
        ) : (
          <Markdown markdown={message.text} profile="chat" className="pk-live-chat__text" />
        )}
        {message.moderation?.originalText && message.moderation.reports > 0 ? (
          <details class="pk-live-chat__original">
            <summary>Show original</summary>
            <Markdown markdown={message.moderation.originalText} profile="chat" className="pk-live-chat__text" />
          </details>
        ) : null}
        {reactions.length ? (
          <div class="pk-live-chat__reactions">
            {reactions.map((reaction) => {
              const count = message.reactions?.[reaction.id] ?? 0;
              const mine = message.myReactions?.includes(reaction.id) ?? false;
              return (
                <button
                  key={reaction.id}
                  type="button"
                  class="pk-live-chat__reaction"
                  aria-pressed={mine ? "true" : "false"}
                  aria-label={`${EMOJI[reaction.id].label}, ${formatNumber(count)}`}
                  title={EMOJI[reaction.id].label}
                  disabled={disabled || !actions.has("react")}
                  onClick={() => send({ type: "chat.react", messageId: message.id, reaction: reaction.id, on: !mine })}
                >
                  <span aria-hidden="true">{reaction.emoji}</span> {formatNumber(count)}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {items.length || canReact ? (
        <span class="pk-live-chat__menu">
          {canReact ? (
            <ReactionPicker
              label={`React to message from ${message.authorName} at ${time}`}
              title="Add a reaction"
              triggerClass="pk-live-chat__react"
              reactions={LIVE_CHAT_REACTIONS}
              pressed={message.myReactions ?? []}
              onReact={(reaction, on) =>
                send({ type: "chat.react", messageId: message.id, reaction: reaction as LiveChatReactionId, on })
              }
            >
              <ReactIcon />
            </ReactionPicker>
          ) : null}
          {items.length ? (
            <Menu label={`Actions for message from ${message.authorName} at ${time}`} items={items} align="end" />
          ) : null}
        </span>
      ) : null}
    </li>
  );
});
