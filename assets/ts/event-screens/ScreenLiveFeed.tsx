import { useEffect, useRef } from "preact/hooks";
import type { LiveOverlayView } from "../../shared/schemas/live-session-room";
import type { LiveRoomState } from "../live-session/live-room-state";
import type { LivePersistence } from "../live-session/live-socket-retry";
import { useLiveRoom } from "../live-session/useLiveRoom";
import { useLiveRoomProgram } from "../live-session/useLiveRoomProgram";

/** What the room's connections delivered: a new state, the room showing nothing, or only whether they are up. */
export type ScreenLiveReport = { connected: boolean; state?: LiveRoomState | null };

interface FeedProps {
  slug: string;
  roomId: string;
  output: LiveOverlayView;
  token: string;
  persistence: LivePersistence;
  onReport: (report: ScreenLiveReport) => void;
}

/** One selected session's room, reported upward; a new selection mounts a new feed. */
function ScreenSessionFeed({
  occurrenceId,
  programLive,
  ...props
}: FeedProps & { occurrenceId: string; programLive: boolean }) {
  const room = useLiveRoom({
    slug: props.slug,
    occurrenceId,
    overlayToken: props.token,
    output: props.output,
    persistent: props.persistence,
  });
  const report = useRef(props.onReport);
  report.current = props.onReport;
  // A new session's socket that is still connecting is a switch, not an outage.
  const connected = programLive && room.status !== "offline";
  useEffect(() => {
    // Until the new session's snapshot arrives, the screen keeps the state it has.
    report.current(room.state ? { connected, state: room.state } : { connected });
  }, [room.state, connected]);
  return null;
}

/**
 * The room's live connections, which never give up: the program says which
 * session the studio selected, the session's room sends its state. It
 * renders nothing; the screen holds the last state it reported.
 */
export function ScreenLiveFeed(props: FeedProps) {
  const program = useLiveRoomProgram({
    slug: props.slug,
    roomId: props.roomId,
    overlayToken: props.token,
    persistent: props.persistence,
  });
  const report = useRef(props.onReport);
  report.current = props.onReport;
  const programLive = program.status === "live";
  const occurrenceId = program.selection?.occurrenceId;
  useEffect(() => {
    if (occurrenceId === null && programLive) report.current({ connected: true, state: null });
    else if (!programLive) report.current({ connected: false });
  }, [occurrenceId, programLive]);
  return occurrenceId ? (
    <ScreenSessionFeed key={occurrenceId} {...props} occurrenceId={occurrenceId} programLive={programLive} />
  ) : null;
}
