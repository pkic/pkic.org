import type { LiveOverlayView } from "../../shared/schemas/live-session-room";
import { useLiveRoom, type LiveSocketFactory } from "./useLiveRoom";
import { LiveOverlayPresentation } from "./LiveOverlayPresentation";

const KEEPS_TRYING = {};

/** One read-only browser source; its approved room projection is also what the desk previews. */
export function LiveOverlay({
  view,
  layout,
  slug,
  occurrenceId,
  token,
  roomId,
  createSocket,
}: {
  view: LiveOverlayView;
  /** The scene the source names, null for the one on air; an unknown one draws the event's default. */
  layout: string | null;
  slug: string;
  occurrenceId: string;
  token: string;
  roomId?: string;
  createSocket?: LiveSocketFactory;
}) {
  // Nobody reloads a browser source in the streaming software: it keeps trying until the room answers.
  const room = useLiveRoom({
    slug,
    occurrenceId,
    overlayToken: token,
    output: view,
    createSocket,
    persistent: KEEPS_TRYING,
  });
  return (
    <main data-live-broadcast-source>
      <LiveOverlayPresentation
        view={view}
        layout={layout}
        projection={room.state}
        status={room.status}
        roomId={roomId}
        broadcast
        eventSlug={slug}
        playsSounds
      />
    </main>
  );
}
