import { useCallback, useEffect, useReducer, useRef } from "preact/hooks";
import { youtubePrivacyEmbedUrl } from "../../shared/youtube-video";
import { nextLivestreamHealth, startLivestreamHealth, type LivestreamHealthSignal } from "./livestream-health";
import { LIVESTREAM_AT_LIVE_EDGE, nextLivestreamLiveEdge } from "./livestream-live-edge";
import { LivestreamStallLog, liveLag, livestreamPlayback, livestreamPlayerState } from "./livestream-playback";
import { provideLivestreamPlayback, publishLivestreamPlayerReport } from "./livestream-player-report";
import { loadYouTubeIframeApi, type YouTubePlayer } from "./youtube-iframe-api";

const HEALTH_TICK_MS = 1_000;
/** A player not playing this long after it asked to start with sound was refused it; it starts muted. */
const AUTOPLAY_WITH_SOUND_MS = 5_000;

/**
 * The player stays where it is put: YouTube's privacy-enhanced embed,
 * playing at once, without controls, related videos or keyboard, and a
 * sandbox that allows no pop-ups or navigation away from the page. A player
 * that starts without sound asks YouTube to start muted, which every browser
 * allows without a click.
 */
function createPlayerFrame(videoId: string, title: string, muted: boolean): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.src = youtubePrivacyEmbedUrl(videoId, {
    autoplay: "1",
    ...(muted ? { mute: "1" } : {}),
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

export interface LivestreamPlayerOptions {
  videoId: string;
  /** What the player is called for assistive technology. */
  title: string;
  /** Start with sound, falling back to muted when the browser refuses; false starts muted. */
  sound: boolean;
  /** Seek back to the live edge whenever the player falls behind it. */
  keepLive?: boolean;
  /** Publish the player's health for the page's own report; a venue screen does, a studio monitor does not. */
  report?: boolean;
}

/**
 * A livestream player that plays the room's stream at all times. It depends
 * only on YouTube once it has a video: the page's own server may be down
 * without the player noticing. It is recreated only when it fails or another
 * video arrives; sound changes on the running player.
 */
export function useLivestreamPlayer({
  videoId,
  title,
  sound,
  keepLive = false,
  report = true,
}: LivestreamPlayerOptions) {
  const [health, dispatch] = useReducer(nextLivestreamHealth, videoId, (initial) =>
    startLivestreamHealth(initial, Date.now()),
  );
  const host = useRef<HTMLDivElement>(null);
  const signal = (event: LivestreamHealthSignal) => dispatch({ ...event, at: Date.now() });
  // The title and sound follow the page without recreating the player.
  const label = useRef(title);
  label.current = title;
  const withSound = useRef(sound);
  withSound.current = sound;
  // What the health report and the live edge read of the player: the ready player, its stalls and its last error.
  const ready = useRef<YouTubePlayer | null>(null);
  const stalls = useRef(new LivestreamStallLog());
  const lastError = useRef<number | null>(null);
  const edge = useRef(LIVESTREAM_AT_LIVE_EDGE);
  const playing = useRef(false);
  playing.current = health.status === "playing";

  useEffect(() => {
    lastError.current = null;
    signal({ type: "video", videoId });
  }, [videoId]);

  useEffect(() => {
    if (!report) return;
    return provideLivestreamPlayback(() =>
      livestreamPlayback({
        player: ready.current,
        stalls: stalls.current,
        errorCode: lastError.current,
        now: Date.now(),
      }),
    );
  }, [report]);
  useEffect(() => stalls.current.status(health.status, health.changedAt), [health.status, health.changedAt]);

  useEffect(() => {
    const tick = setInterval(() => {
      signal({ type: "tick" });
      const player = ready.current;
      if (!keepLive || !player) return;
      const next = nextLivestreamLiveEdge(edge.current, {
        lagSeconds: liveLag(player),
        playing: playing.current,
        at: Date.now(),
      });
      edge.current = next.edge;
      const live = next.seek ? player.getDuration?.() : undefined;
      if (live !== undefined && Number.isFinite(live)) player.seekTo?.(live, true);
    }, HEALTH_TICK_MS);
    return () => clearInterval(tick);
  }, [keepLive]);

  useEffect(() => {
    const frame = createPlayerFrame(health.videoId, label.current, !withSound.current);
    host.current?.replaceChildren(frame);
    let stopped = false;
    let player: YouTubePlayer | null = null;
    let played = false;
    let refusal: ReturnType<typeof setTimeout> | undefined;
    edge.current = LIVESTREAM_AT_LIVE_EDGE;
    loadYouTubeIframeApi().then(
      (api) => {
        if (stopped) return;
        player = new api.Player(frame, {
          events: {
            onReady: ({ target }) => {
              if (stopped) return;
              ready.current = target;
              if (!withSound.current) {
                target.mute();
                target.playVideo();
                return;
              }
              target.unMute();
              target.setVolume(100);
              target.playVideo();
              // The browser may refuse to start with sound; muted is better than the reconnecting card.
              refusal = setTimeout(() => {
                if (stopped || played) return;
                target.mute();
                target.playVideo();
                signal({ type: "muted" });
              }, AUTOPLAY_WITH_SOUND_MS);
            },
            onStateChange: ({ data, target }) => {
              if (stopped) return;
              const state = livestreamPlayerState(data);
              if (!state) return;
              if (state === "playing") played = true;
              // Nobody pauses a live monitor; carry on.
              if (state === "paused") target.playVideo();
              signal({ type: "state", state });
            },
            onError: ({ data }) => {
              if (stopped) return;
              lastError.current = Number.isInteger(data) ? data : null;
              signal({ type: "fault" });
            },
          },
        });
      },
      () => {
        if (!stopped) signal({ type: "fault" });
      },
    );
    return () => {
      stopped = true;
      ready.current = null;
      clearTimeout(refusal);
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
    if (!report) return;
    publishLivestreamPlayerReport({
      status: health.status,
      videoId: health.videoId,
      muted: health.muted,
      changedAt: new Date(health.changedAt).toISOString(),
    });
  }, [report, health.status, health.videoId, health.muted, health.changedAt]);
  useEffect(() => (report ? () => publishLivestreamPlayerReport(null) : undefined), [report]);

  /** Turns sound on or off on the running player; someone asked, so it is no longer a refusal. */
  const setSound = useCallback((on: boolean) => {
    const player = ready.current;
    if (!player) return;
    try {
      if (on) {
        player.unMute();
        player.setVolume(100);
        signal({ type: "unmuted" });
      } else player.mute();
    } catch {
      /* A player being replaced takes the sound it is created with. */
    }
  }, []);

  return { host, health, setSound };
}
