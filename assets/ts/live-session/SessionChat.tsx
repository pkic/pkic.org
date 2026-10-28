import { Alert } from "../ui/Alert";
import { liveRoomOpenFailure } from "./live-room-copy";
import { useLiveRoom, type LiveSocketFactory } from "./useLiveRoom";
import { SessionInteractionWindow, type SessionInteractionProps } from "./SessionInteractionWindow";
import { ChatComposer, LiveChat } from "./LiveChat";

/** Chat joins only during the same canonical attendee window as questions. */
export function SessionChat(props: SessionInteractionProps) {
  const { slug, occurrenceId, createSocket, labelledBy } = props;
  return (
    <SessionInteractionWindow
      {...props}
      disabledControls={<ChatComposer channel="attendee" compact={false} disabled send={() => false} refusal={null} />}
    >
      <section aria-labelledby={labelledBy}>
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
  const room = useLiveRoom({ slug, occurrenceId, createSocket });
  if (!room.state)
    return room.admissionRefusal || room.status === "offline" ? (
      <Alert tone="warn">{liveRoomOpenFailure(room.admissionRefusal, "chat")}</Alert>
    ) : (
      <p class="pk-small pk-muted">Joining session chat…</p>
    );
  return (
    <div class="pk-stack pk-stack--snug">
      {room.status !== "live" ? <Alert tone="warn">Chat is reconnecting. Sending is paused.</Alert> : null}
      <LiveChat state={room.state} disabled={room.status !== "live"} send={room.send} />
    </div>
  );
}
