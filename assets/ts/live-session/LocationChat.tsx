import { Alert } from "../ui/Alert";
import { liveRoomOpenFailure } from "./live-room-copy";
import { LiveChat } from "./LiveChat";
import type { LiveLocationChatConnection } from "./useLocationChat";

/** Why a location's chat is not on screen yet: joining, refused, or out of reach. */
export function LocationChatJoining({ chat }: { chat: LiveLocationChatConnection }) {
  return chat.admissionRefusal || chat.status === "offline" ? (
    <Alert tone="warn">{liveRoomOpenFailure(chat.admissionRefusal, "chat", chat.serverFault)}</Alert>
  ) : (
    <p class="pk-small pk-muted">Joining the chat…</p>
  );
}

/** A location's chat for an attendee, on the chat connection its page already holds. */
export function LiveAttendeeChat({
  chat,
  compact = false,
  note,
}: {
  chat: LiveLocationChatConnection;
  compact?: boolean;
  /** Said under the feed while nothing else is, such as when the chat closes. */
  note?: string;
}) {
  if (!chat.state) return <LocationChatJoining chat={chat} />;
  return (
    <>
      {chat.status !== "live" ? <Alert tone="warn">Chat is reconnecting. Sending is paused.</Alert> : null}
      <LiveChat state={chat.state} disabled={chat.status !== "live"} send={chat.send} compact={compact} note={note} />
    </>
  );
}
