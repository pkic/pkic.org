import { useEffect } from "preact/hooks";
import { useLivestreamPlayer } from "../../../../../../../event-screens/useLivestreamPlayer";
import { studioLivestreamRefused, studioLivestreamSound, useStudioLivestreamTurn } from "./studio-livestream-sound";
import "./StudioLivestreamMonitor.css";

/**
 * The LIVE monitor: the room's stream as online viewers see it, on the venue
 * screens' own player. It starts by itself, muted unless the operator turned
 * the sound on, and keeps to the live edge, so it shows what is on air now.
 */
export function StudioLivestreamMonitor({ videoId, roomName }: { videoId: string; roomName: string }) {
  const turn = useStudioLivestreamTurn();
  const { on, asked } = studioLivestreamSound.value;
  const sound = on && turn;
  const player = useLivestreamPlayer({
    videoId,
    title: `${roomName} livestream`,
    sound,
    keepLive: true,
    report: false,
  });
  const { setSound } = player;
  useEffect(() => setSound(sound), [setSound, sound, asked]);
  const refused = player.health.muted;
  useEffect(() => {
    if (turn) studioLivestreamRefused.value = refused;
  }, [turn, refused]);
  return (
    <div class="pk-studio-livestream">
      <div ref={player.host} class="pk-studio-livestream__host" />
      {player.health.reconnecting ? (
        <p class="pk-studio-monitor__idle" role="status">
          Reconnecting to the livestream…
        </p>
      ) : null}
    </div>
  );
}
