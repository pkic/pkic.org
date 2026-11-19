import { formatClockInZone } from "../../shared/format-date";
import {
  livePauseEndsAt,
  type LiveModerationReason,
  type LiveParticipationAction,
} from "../../shared/live-moderation-policy";
import type { LiveModerationItem } from "../../shared/schemas/live-session-moderation";
import type { LiveRoomClientMessage } from "../../shared/schemas/live-session-room";
import type { MenuItem } from "../ui/Menu";
import { askModerationReason } from "./LiveModerationDialog";

type Send = (message: LiveRoomClientMessage) => boolean;

/** What a post is called in the menu and its dialogs. */
export type LiveModerationNoun = "message" | "question" | "answer";

/** Done: the studio's cleanup flag, never a removal. */
export function liveDoneMenuItem(item: LiveModerationItem, done: boolean, send: Send): MenuItem {
  return done
    ? {
        id: "undone",
        label: "Back to the queue",
        tooltip: "Puts it back in the studio queue.",
        onSelect: () => send({ type: "moderation.done", item, done: false }),
      }
    : {
        id: "done",
        label: "Done",
        tooltip: "Clears it from the studio queue. Attendees still see it.",
        onSelect: () => send({ type: "moderation.done", item, done: true }),
      };
}

/** Hide…: asks why, then hides the post from everyone but its author and moderators. A moderator can show it again. */
export function liveRemoveMenuItem(
  noun: LiveModerationNoun,
  remove: (reason: LiveModerationReason) => void,
  onError: () => void,
): MenuItem {
  return {
    id: "remove",
    label: `Hide ${noun}…`,
    tooltip: "Hides it from everyone and records why. The author sees the reason.",
    danger: true,
    onSelect: () => {
      void askModerationReason({
        title: `Hide this ${noun}?`,
        body: "It's hidden from everyone. The author still sees it, with the reason you choose.",
        confirmLabel: `Hide ${noun}`,
      })
        .then((decision) => {
          if (decision) remove(decision.reason);
        })
        .catch(onError);
    },
  };
}

/** Pause, Block for this session…, Block for this event… and Lift block, as the shared policy grants them. */
export function liveParticipationMenuItems({
  item,
  authorName,
  actions,
  send,
  timeZone,
  onError,
}: {
  item: LiveModerationItem;
  authorName: string;
  /** The granted actions; a wider set, such as a chat message's, is read for these four only. */
  actions: Pick<ReadonlySet<LiveParticipationAction>, "has">;
  send: Send;
  timeZone: string;
  onError: () => void;
}): MenuItem[] {
  const items: MenuItem[] = [];
  const sendOrReport = (message: LiveRoomClientMessage) => {
    if (!send(message)) onError();
  };
  const block = (kind: "session" | "event", title: string, body: string, confirmLabel: string) => () => {
    void askModerationReason({ title, body, confirmLabel, offerRemovePosts: true })
      .then((decision) => {
        if (decision) sendOrReport({ type: "participation.block", item, block: kind, ...decision });
      })
      .catch(onError);
  };
  if (actions.has("pause"))
    items.push({
      id: "pause",
      label: "Pause for 10 minutes",
      tooltip: `${authorName} can't post, vote or react until ${formatClockInZone(livePauseEndsAt(new Date().toISOString()), timeZone)}. They can keep watching.`,
      separatorBefore: true,
      onSelect: () =>
        sendOrReport({ type: "participation.block", item, block: "paused", reason: "conduct", removePosts: false }),
    });
  if (actions.has("block"))
    items.push({
      id: "block",
      label: "Block for this session…",
      tooltip: `${authorName} can't post, vote or react in this session until you lift the block. They can keep watching.`,
      separatorBefore: !actions.has("pause"),
      danger: true,
      onSelect: block(
        "session",
        `Block ${authorName} for this session?`,
        `${authorName} can't post, vote or react in this session until you lift the block. They can keep watching.`,
        "Block for this session",
      ),
    });
  if (actions.has("blockEvent"))
    items.push({
      id: "block-event",
      label: "Block for this event…",
      tooltip: `${authorName} can't post, vote or react in any session of this event until an organizer lifts the block. They can keep watching.`,
      separatorBefore: !actions.has("pause") && !actions.has("block"),
      danger: true,
      onSelect: block(
        "event",
        `Block ${authorName} for this event?`,
        `${authorName} can't post, vote or react in any session of this event until an organizer lifts the block. They can keep watching.`,
        "Block for this event",
      ),
    });
  if (actions.has("lift"))
    items.push({
      id: "lift",
      label: "Lift block",
      tooltip: `${authorName} can post again. Hidden posts stay hidden.`,
      separatorBefore: true,
      onSelect: () => sendOrReport({ type: "participation.lift", item }),
    });
  return items;
}
