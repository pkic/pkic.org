import type { LiveOverlayView } from "../../shared/schemas/live-session-room";
import { LiveOverlay } from "./LiveOverlay";
import { useLiveRoomProgram } from "./useLiveRoomProgram";
import type { LiveSocketFactory } from "./useLiveRoom";
const KEEPS_TRYING = {};

/** Stable browser source: selection changes replace only the subscribed session, never the browser-source address. */
export function LiveProgramOverlay({
  view,
  layout,
  slug,
  roomId,
  token,
  createSocket,
}: {
  view: LiveOverlayView;
  /** The layout the source names. */
  layout: string;
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
      slug={slug}
      occurrenceId={program.selection.occurrenceId}
      token={token}
      roomId={roomId}
      createSocket={createSocket}
    />
  ) : null;
}
