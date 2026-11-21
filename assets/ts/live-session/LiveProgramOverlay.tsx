import type { LiveOverlayView } from "../../shared/schemas/live-session-room";
import type { LiveOverlayGraphics } from "./live-overlay-graphics";
import { LiveOverlay } from "./LiveOverlay";
import { useLiveRoomProgram } from "./useLiveRoomProgram";
import type { LiveSocketFactory } from "./useLiveSocket";
const KEEPS_TRYING = {};

/** Stable browser source: selection changes replace only the subscribed session, never the browser-source address. */
export function LiveProgramOverlay({
  view,
  layout,
  graphics,
  slug,
  roomId,
  token,
  createSocket,
}: {
  view: LiveOverlayView;
  /** The scene the source names; null to draw the scene its output has on air. */
  layout: string | null;
  /** Which graphics the source draws, and whether it crops to the one left. */
  graphics?: LiveOverlayGraphics;
  slug: string;
  roomId: string;
  token: string;
  createSocket?: LiveSocketFactory;
}) {
  // A browser source in the streaming software has nobody to reload it: it keeps trying, and holds the
  // session it follows through a dropped connection instead of going blank.
  const program = useLiveRoomProgram({ slug, roomId, overlayToken: token, createSocket, persistent: KEEPS_TRYING });
  return program.selection?.occurrenceId ? (
    <LiveOverlay
      key={`${program.selection.occurrenceId}:${program.selection.revision}`}
      view={view}
      layout={layout}
      graphics={graphics}
      slug={slug}
      occurrenceId={program.selection.occurrenceId}
      token={token}
      roomId={roomId}
      createSocket={createSocket}
    />
  ) : null;
}
