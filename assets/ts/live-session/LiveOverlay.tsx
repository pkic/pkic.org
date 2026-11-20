import type { LiveOverlayView } from "../../shared/schemas/live-session-room";
import type { LiveOverlayGraphics } from "./live-overlay-graphics";
import { useLiveRoom } from "./useLiveRoom";
import type { LiveSocketFactory } from "./useLiveSocket";
import { LiveOverlayPresentation } from "./LiveOverlayPresentation";

const KEEPS_TRYING = {};

/** One read-only browser source; its approved room projection is also what the desk previews. */
export function LiveOverlay({
  view,
  layout,
  graphics,
  slug,
  occurrenceId,
  token,
  roomId,
  createSocket,
}: {
  view: LiveOverlayView;
  /** The scene the source names, null for the one on air; an unknown one draws the event's default. */
  layout: string | null;
  /** Which graphics the source draws, and whether it crops to the one left. */
  graphics?: LiveOverlayGraphics;
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
        graphics={graphics}
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
