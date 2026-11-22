import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { liveChatCapacity } from "../../shared/live-chat-policy";
import type { LiveChatMessage } from "../../shared/schemas/live-session-chat";
import type { LiveRoomClientMessage, LiveRoomSnapshot } from "../../shared/schemas/live-session-room";
import { Button } from "../ui/Button";
import { Markdown } from "../ui/Markdown";
import { IconChevron, IconPin, IconRemove } from "../ui/MediaIcons";

/**
 * The message a moderator pinned, on one line above the chat: its author and words, the whole of it on
 * request, and Unpin for moderators.
 */
export function LiveChatPinned({
  message,
  viewer,
  send,
  disabled,
}: {
  message: LiveChatMessage;
  viewer: LiveRoomSnapshot["viewer"];
  send: (message: LiveRoomClientMessage) => boolean;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const line = useRef<HTMLDivElement>(null);
  // Show all is offered only when the words run past the line.
  useLayoutEffect(() => {
    const node = line.current;
    if (!node || open) return;
    const measure = () => setCut(node.scrollWidth > node.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [message.text, open]);
  const moderator = liveChatCapacity(viewer) !== "participant";
  return (
    <section class="pk-live-chat__pinned" data-open={open ? "" : undefined} aria-label="Pinned message">
      <IconPin class="pk-live-chat__pinned-icon" />
      <div ref={line} class="pk-live-chat__pinned-text">
        <span class="pk-live-chat__pinned-author">{message.authorName}</span>{" "}
        <Markdown markdown={message.text} profile="chat" className="pk-live-chat__text" />
      </div>
      {cut || open ? (
        <Button
          variant="ghost"
          icon
          aria-expanded={open ? "true" : "false"}
          aria-label={open ? "Show less" : "Show all"}
          title={open ? "Show less" : "Show all"}
          onClick={() => setOpen(!open)}
        >
          <IconChevron pointing={open ? "up" : "down"} />
        </Button>
      ) : null}
      {moderator ? (
        <Button
          variant="ghost"
          icon
          aria-label="Unpin message"
          title="Unpin message"
          disabled={disabled}
          onClick={() => send({ type: "chat.unpin" })}
        >
          <IconRemove />
        </Button>
      ) : null}
    </section>
  );
}
