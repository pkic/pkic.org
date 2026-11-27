import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { liveChatCapacity } from "../../shared/live-chat-policy";
import type { LiveChatMessage } from "../../shared/schemas/live-session-chat";
import type { LiveRoomClientMessage, LiveRoomSnapshot } from "../../shared/schemas/live-session-room";
import { Button } from "../ui/Button";
import { Markdown } from "../ui/Markdown";
import { IconChevron, IconPin, IconRemove } from "../ui/MediaIcons";

/**
 * The message a moderator pinned, on one line above the chat: its author and words, and Unpin for
 * moderators. A message longer than the line shows all of it over the feed while hovered, and stays open
 * once clicked; the chevron does the same from the keyboard.
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
  // Open stays until clicked again; hovered shows the whole message only while the pointer rests on it.
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [cut, setCut] = useState(false);
  const shown = open || (hovered && cut);
  const line = useRef<HTMLDivElement>(null);
  // Show all is offered only when the words run past the line.
  useLayoutEffect(() => {
    const node = line.current;
    // A shown message wraps, so the line is measured only while it is one line.
    if (!node || shown) return;
    const measure = () => {
      setCut(node.scrollWidth > node.clientWidth + 1);
      // The one-line bar's height, which its place keeps while the whole message lies over the feed.
      const bar = node.parentElement;
      bar?.parentElement?.style.setProperty("--pk-pinned-line", `${bar.offsetHeight}px`);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [message.text, shown]);
  const moderator = liveChatCapacity(viewer) !== "participant";
  return (
    <div class="pk-live-chat__pinned-slot" data-open={shown ? "" : undefined}>
      <section
        class="pk-live-chat__pinned"
        data-open={shown ? "" : undefined}
        data-cut={cut ? "" : undefined}
        aria-label="Pinned message"
        onPointerEnter={(event) => setHovered(event.pointerType === "mouse")}
        onPointerLeave={() => setHovered(false)}
      >
        <IconPin class="pk-live-chat__pinned-icon" />
        <div ref={line} class="pk-live-chat__pinned-text">
          <span class="pk-live-chat__pinned-author">{message.authorName}</span>{" "}
          <Markdown markdown={message.text} profile="chat" className="pk-live-chat__text" />
        </div>
        {cut || shown ? (
          // Its hit area spans the bar, so a click on the words keeps them open too.
          <Button
            variant="ghost"
            icon
            class="pk-live-chat__pinned-toggle"
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
    </div>
  );
}
