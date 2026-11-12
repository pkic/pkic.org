import { LiveReactionBar } from "./LiveReactionBar";
import { SessionInteractionWindow, type SessionInteractionProps } from "./SessionInteractionWindow";
import { useLiveRoom } from "./useLiveRoom";

/**
 * A session's reaction bar, wherever attendees watch it: shown only while the
 * room takes reactions, from shortly before the start until after the end.
 * A room that cannot be reached shows no bar; questions and chat say why.
 */
export function SessionReactions(props: Omit<SessionInteractionProps, "closed" | "showClosedControls">) {
  return (
    <SessionInteractionWindow {...props} disabledControls={null}>
      <SessionReactionsRoom {...props} />
    </SessionInteractionWindow>
  );
}

function SessionReactionsRoom({ slug, occurrenceId, createSocket }: SessionInteractionProps) {
  const room = useLiveRoom({ slug, occurrenceId, createSocket });
  if (!room.state) return null;
  return <LiveReactionBar send={room.send} refusal={room.state.refusal} disabled={room.status !== "live"} />;
}
