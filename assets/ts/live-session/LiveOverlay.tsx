import type { LiveOverlayView } from "../../shared/schemas/live-session-room";
import { useLiveRoom, type LiveSocketFactory } from "./useLiveRoom";
import { LiveOverlayPresentation } from "./LiveOverlayPresentation";

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
  /** The layout the source names; an unknown one draws the event's default. */
  layout: string;
  slug: string;
  occurrenceId: string;
  token: string;
  roomId?: string;
  createSocket?: LiveSocketFactory;
}) {
  const room = useLiveRoom({ slug, occurrenceId, overlayToken: token, output: view, createSocket });
  return (
    <main data-live-broadcast-source>
      <LiveOverlayPresentation
        view={view}
        layout={layout}
        projection={room.state}
        status={room.status}
        roomId={roomId}
        broadcast
      />
    </main>
  );
}
