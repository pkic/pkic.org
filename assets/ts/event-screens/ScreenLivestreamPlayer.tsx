import type { ComponentChildren } from "preact";
import { useEffect, useReducer, useRef } from "preact/hooks";
import { youtubePrivacyEmbedUrl } from "../../shared/youtube-video";
import {
  nextLivestreamHealth,
  startLivestreamHealth,
  type LivestreamHealthSignal,
  type LivestreamPlayerState,
} from "./livestream-health";
import { publishLivestreamPlayerReport } from "./livestream-player-report";
import { ScreenLivestream } from "./ScreenLivestream";
import { loadYouTubeIframeApi, YOUTUBE_PLAYER_STATES, type YouTubePlayer } from "./youtube-iframe-api";

const HEALTH_TICK_MS = 1_000;
/** A player not playing this long after it asked to start with sound was refused it; it starts muted. */
const AUTOPLAY_WITH_SOUND_MS = 5_000;

const PLAYER_STATES = new Map<number, LivestreamPlayerState>(
  Object.entries(YOUTUBE_PLAYER_STATES).map(([name, value]) => [value, name as LivestreamPlayerState]),
);

/**
 * The player stays on the venue's kiosk: YouTube's privacy-enhanced embed,
 * playing with sound, without controls, related videos or keyboard, and a
 * sandbox that allows no pop-ups or navigation away from the screen page.
 */
function createPlayerFrame(videoId: string, title: string): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.src = youtubePrivacyEmbedUrl(videoId, {
    autoplay: "1",
    playsinline: "1",
    controls: "0",
    disablekb: "1",
    fs: "0",
    iv_load_policy: "3",
    enablejsapi: "1",
    origin: window.location.origin,
  });
  frame.title = title;
  frame.allow = "autoplay; encrypted-media";
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
  frame.tabIndex = -1;
  return frame;
}

/**
 * A livestream screen's player. It plays the room's stream at all times and
 * depends only on YouTube once it has a video: the screen's own server may be
 * down without the player noticing. It is recreated only when it fails or
 * another video arrives.
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
  const [health, dispatch] = useReducer(nextLivestreamHealth, videoId, (initial) =>
    startLivestreamHealth(initial, Date.now()),
  );
  const host = useRef<HTMLDivElement>(null);
  const report = (signal: LivestreamHealthSignal) => dispatch({ ...signal, at: Date.now() });
  // The title follows a renamed room without recreating the player.
  const title = useRef(roomName);
  title.current = `${roomName} livestream`;

  useEffect(() => report({ type: "video", videoId }), [videoId]);

  useEffect(() => {
    const tick = setInterval(() => report({ type: "tick" }), HEALTH_TICK_MS);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const frame = createPlayerFrame(health.videoId, title.current);
    host.current?.replaceChildren(frame);
    let stopped = false;
    let player: YouTubePlayer | null = null;
    let played = false;
    let withSound: ReturnType<typeof setTimeout> | undefined;
    loadYouTubeIframeApi().then(
      (api) => {
        if (stopped) return;
        player = new api.Player(frame, {
          events: {
            onReady: ({ target }) => {
              target.unMute();
              target.setVolume(100);
              target.playVideo();
              // The browser may refuse to start with sound; muted is better than the reconnecting card.
              withSound = setTimeout(() => {
                if (stopped || played) return;
                target.mute();
                target.playVideo();
                report({ type: "muted" });
              }, AUTOPLAY_WITH_SOUND_MS);
            },
            onStateChange: ({ data, target }) => {
              if (stopped) return;
              const state = PLAYER_STATES.get(data);
              if (!state) return;
              if (state === "playing") played = true;
              // Nobody pauses a venue screen; carry on.
              if (state === "paused") target.playVideo();
              report({ type: "state", state });
            },
            onError: () => {
              if (!stopped) report({ type: "fault" });
            },
          },
        });
      },
      () => {
        if (!stopped) report({ type: "fault" });
      },
    );
    return () => {
      stopped = true;
      clearTimeout(withSound);
      try {
        player?.destroy();
      } catch {
        /* A player that never finished starting has nothing to stop. */
      }
      frame.remove();
    };
    // Only another video or a retry after a fault creates the player anew.
  }, [health.videoId, health.generation]);

  useEffect(() => {
    publishLivestreamPlayerReport({
      status: health.status,
      videoId: health.videoId,
      muted: health.muted,
      changedAt: new Date(health.changedAt).toISOString(),
    });
  }, [health.status, health.videoId, health.muted, health.changedAt]);
  useEffect(() => () => publishLivestreamPlayerReport(null), []);

  return (
    <ScreenLivestream reconnectingRoom={health.reconnecting ? roomName : null} aside={aside}>
      <div ref={host} class="pk-screen-livestream__host" />
    </ScreenLivestream>
  );
}
