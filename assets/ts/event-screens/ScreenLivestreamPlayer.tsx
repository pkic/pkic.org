import type { ComponentChildren } from "preact";
import { ScreenLivestream } from "./ScreenLivestream";
import { useLivestreamPlayer } from "./useLivestreamPlayer";

/**
 * A livestream screen's player: the room's stream with sound, edge to edge,
 * reporting its health with the screen's. While it fails, the reconnecting
 * card covers it as it keeps trying.
 */
export function ScreenLivestreamPlayer({
  videoId,
  roomName,
  aside,
}: {
  videoId: string;
  roomName: string;
  aside?: ComponentChildren;
}) {
  const { host, health } = useLivestreamPlayer({ videoId, title: `${roomName} livestream`, sound: true });
  return (
    <ScreenLivestream reconnectingRoom={health.reconnecting ? roomName : null} aside={aside}>
      <div ref={host} class="pk-screen-livestream__host" />
    </ScreenLivestream>
  );
}
