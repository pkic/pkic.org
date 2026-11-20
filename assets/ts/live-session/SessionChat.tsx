import { Alert } from "../ui/Alert";
import { liveRoomOpenFailure } from "./live-room-copy";
import { useLiveRoom, type LiveRoomConnection, type LiveSocketFactory } from "./useLiveRoom";
import { SessionInteractionWindow, type SessionInteractionProps } from "./SessionInteractionWindow";
import { LiveChat, LiveChatClosed } from "./LiveChat";

/** Chat joins only during the same canonical attendee window as questions. */
export function SessionChat(props: SessionInteractionProps) {
  const { slug, occurrenceId, createSocket, labelledBy } = props;
  return (
    <SessionInteractionWindow {...props} disabledControls={<LiveChatClosed />}>
      <section class="pk-stack pk-stack--snug" aria-labelledby={labelledBy}>
        <SessionChatRoom slug={slug} occurrenceId={occurrenceId} createSocket={createSocket} />
      </section>
    </SessionInteractionWindow>
  );
}
function SessionChatRoom({
  slug,
  occurrenceId,
  createSocket,
}: {
  slug: string;
  occurrenceId: string;
  createSocket?: LiveSocketFactory;
}) {
  return <LiveAttendeeChat room={useLiveRoom({ slug, occurrenceId, createSocket })} />;
}

/** A session's chat for an attendee, on a room connection its page already holds. */
export function LiveAttendeeChat({ room, compact = false }: { room: LiveRoomConnection; compact?: boolean }) {
  if (!room.state)
    return room.admissionRefusal || room.status === "offline" ? (
      <Alert tone="warn">{liveRoomOpenFailure(room.admissionRefusal, "chat", room.serverFault)}</Alert>
    ) : (
      <p class="pk-small pk-muted">Joining session chat…</p>
    );
  return (
    <>
      {room.status !== "live" ? <Alert tone="warn">Chat is reconnecting. Sending is paused.</Alert> : null}
      <LiveChat state={room.state} disabled={room.status !== "live"} send={room.send} compact={compact} />
    </>
  );
}
