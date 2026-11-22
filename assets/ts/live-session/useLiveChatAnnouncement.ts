import { useEffect, useRef, useState } from "preact/hooks";
import { liveChatPlainText } from "../../shared/live-chat-policy";
import type { LiveChatMessage } from "../../shared/schemas/live-session-chat";

/** The shortest time between two things the chat says aloud, so a busy chat never talks over itself. */
export const LIVE_CHAT_ANNOUNCE_MS = 5_000;

function spokenMessage(message: LiveChatMessage): string {
  return `${message.authorName}: ${liveChatPlainText(message.text)}`;
}

/**
 * What the chat's polite live region says. A reader following the latest message hears each new one, at most one
 * every few seconds; what arrives in between is told as a count when the pause ends. A reader further up hears
 * nothing of the feed, and anyone hears a reply to them at once. Nothing is said while the chat is out of view.
 */
export function useLiveChatAnnouncement(
  latest: LiveChatMessage | undefined,
  following: { readonly current: boolean },
  visible: boolean,
): string {
  const [spoken, setSpoken] = useState("");
  const seen = useRef(latest?.id);
  const quietUntil = useRef(0);
  /** What arrived during the pause, told when it ends. */
  const held = useRef<LiveChatMessage[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!latest || seen.current === latest.id) return;
    seen.current = latest.id;
    if (latest.mine || !visible) return;
    const say = (words: string) => {
      setSpoken(words);
      held.current = [];
      quietUntil.current = Date.now() + LIVE_CHAT_ANNOUNCE_MS;
    };
    if (latest.replyTo?.mine) return say(`${latest.authorName} replied to you: ${liveChatPlainText(latest.text)}`);
    if (!following.current) return;
    const wait = quietUntil.current - Date.now();
    if (wait <= 0) return say(spokenMessage(latest));
    held.current.push(latest);
    timer.current ??= setTimeout(() => {
      timer.current = null;
      const waiting = held.current;
      // A reader who moved up meanwhile reads the new messages when they come back down.
      if (!waiting.length || !following.current) {
        held.current = [];
        return;
      }
      say(waiting.length === 1 ? spokenMessage(waiting[0]) : `${waiting.length} new messages`);
    }, wait);
  }, [latest, following, visible]);
  return visible ? spoken : "";
}
